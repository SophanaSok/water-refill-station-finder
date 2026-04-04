import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { geocodeAddress } from "../lib/geocodeAddress.js";
import { uploadToR2 } from "../lib/r2.js";
import { consumeRateLimit } from "../lib/rateLimit.js";

type StationType = "fountain" | "bottle_filler" | "store_refill" | "tap";

type FieldErrors = Record<string, string>;

type FileUpload = {
  filename: string;
  mimetype: string;
  buffer: Buffer;
};

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const ALLOWED_TYPES = new Set<StationType>(["fountain", "bottle_filler", "store_refill", "tap"]);

function normalizeBoolean(value: string): boolean | null {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return null;
}

function normalizeOptional(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function validateFields(fields: Record<string, string | undefined>): {
  errors: FieldErrors;
  data: {
    name: string;
    type: StationType;
    address: string;
    city: string;
    state: string;
    zip: string | null;
    is_free: boolean;
    cost_description: string | null;
    submitter_email: string;
  } | null;
} {
  const errors: FieldErrors = {};

  const name = normalizeOptional(fields.name);
  if (!name) {
    errors.name = "Name is required.";
  } else if (name.length > 100) {
    errors.name = "Name must be 100 characters or fewer.";
  }

  const type = normalizeOptional(fields.type);
  if (!type) {
    errors.type = "Type is required.";
  } else if (!ALLOWED_TYPES.has(type as StationType)) {
    errors.type = "Type is invalid.";
  }

  const address = normalizeOptional(fields.address);
  if (!address) {
    errors.address = "Address is required.";
  } else if (address.length > 200) {
    errors.address = "Address must be 200 characters or fewer.";
  }

  const city = normalizeOptional(fields.city);
  if (!city) {
    errors.city = "City is required.";
  }

  const state = normalizeOptional(fields.state)?.toUpperCase() ?? null;
  if (!state) {
    errors.state = "State is required.";
  } else if (state.length !== 2) {
    errors.state = "State must be exactly 2 characters.";
  }

  const zip = normalizeOptional(fields.zip);

  const rawIsFree = normalizeOptional(fields.is_free);
  if (!rawIsFree) {
    errors.is_free = "is_free is required.";
  }

  const isFree = rawIsFree ? normalizeBoolean(rawIsFree.toLowerCase()) : null;
  if (rawIsFree && isFree === null) {
    errors.is_free = "is_free must be true or false.";
  }

  const costDescription = normalizeOptional(fields.cost_description);
  if (costDescription && costDescription.length > 100) {
    errors.cost_description = "Cost description must be 100 characters or fewer.";
  }

  const submitterEmail = normalizeOptional(fields.submitter_email);
  if (!submitterEmail) {
    errors.submitter_email = "Submitter email is required.";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(submitterEmail)) {
    errors.submitter_email = "Submitter email must be a valid email address.";
  }

  if (Object.keys(errors).length > 0) {
    return { errors, data: null };
  }

  return {
    errors,
    data: {
      name: name as string,
      type: type as StationType,
      address: address as string,
      city: city as string,
      state: state as string,
      zip,
      is_free: isFree as boolean,
      cost_description: costDescription,
      submitter_email: submitterEmail as string,
    },
  };
}

async function parseMultipart(request: FastifyRequest): Promise<{
  fields: Record<string, string | undefined>;
  photo: FileUpload | null;
}> {
  const fields: Record<string, string | undefined> = {};
  let photo: FileUpload | null = null;

  for await (const part of request.parts()) {
    if (part.type === "file") {
      if (part.fieldname !== "photo") {
        continue;
      }

      const buffer = await part.toBuffer();
      photo = {
        filename: part.filename,
        mimetype: part.mimetype,
        buffer,
      };
      continue;
    }

    fields[part.fieldname] = typeof part.value === "string" ? part.value : String(part.value);
  }

  return { fields, photo };
}

const submitRoutes: FastifyPluginAsync = async (server) => {
  server.post(
    "/",
    {
      preHandler: async (request, reply) => {
        const result = await consumeRateLimit(`submit:${request.ip}`, 10, 60_000);
        reply.header("x-ratelimit-limit", "10");
        reply.header("x-ratelimit-remaining", String(result.remaining));
        reply.header("x-ratelimit-reset", String(Math.ceil(result.resetAt / 1000)));

        if (!result.allowed) {
          return reply.code(429).send({ error: "Too many requests" });
        }
      },
    },
    async (request, reply) => {
    const { fields, photo } = await parseMultipart(request);
    const { errors, data } = validateFields(fields);

    if (photo) {
      if (!ALLOWED_MIME_TYPES.has(photo.mimetype)) {
        errors.photo = "Photo must be a JPG, PNG, or WebP image.";
      }

      if (photo.buffer.byteLength > MAX_PHOTO_BYTES) {
        errors.photo = "Photo must be 5MB or smaller.";
      }
    }

    if (!data || Object.keys(errors).length > 0) {
      return reply.code(400).send({ error: "Validation failed", fields: errors });
    }

    const geocodeInput = `${data.address}, ${data.city}, ${data.state}`;
    const coordinates = await geocodeAddress(geocodeInput);

    if (!coordinates) {
      return reply
        .code(422)
        .send({ error: "Address not found. Please check and try again." });
    }

    let photoUrl: string | null = null;

    if (photo) {
      const transformed = await sharp(photo.buffer)
        .resize({ width: 1200, withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();

      const key = `stations/${randomUUID()}-${Date.now()}.webp`;
      photoUrl = await uploadToR2(transformed, key, "image/webp");
    }

    const [inserted] = (await server.db(
      `
        WITH inserted_station AS (
          INSERT INTO stations (
            name,
            type,
            location,
            address,
            city,
            state,
            zip,
            is_free,
            cost_description,
            photo_url,
            status,
            source,
            is_verified,
            added_by,
            owner_id,
            is_featured
          ) VALUES (
            $1,
            $2,
            ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography,
            $5,
            $6,
            $7,
            $8,
            $9,
            $10,
            $11,
            'pending',
            'crowdsource',
            false,
            NULL,
            NULL,
            false
          )
          RETURNING id
        ),
        inserted_submission AS (
          INSERT INTO station_submissions (station_id, submitter_email)
          SELECT id, $12
          FROM inserted_station
          RETURNING station_id
        )
        SELECT station_id AS id
        FROM inserted_submission
      `,
      [
        data.name,
        data.type,
        coordinates.lng,
        coordinates.lat,
        data.address,
        data.city,
        data.state,
        data.zip,
        data.is_free,
        data.cost_description,
        photoUrl,
        data.submitter_email,
      ],
    )) as Array<{ id: string }>;

    return reply.code(201).send({
      success: true,
      id: inserted.id,
      message: "Thank you! Your submission is under review.",
    });
    },
  );
};

export default submitRoutes;