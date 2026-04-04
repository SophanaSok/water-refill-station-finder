import type { FastifyPluginAsync } from "fastify";
import crypto from "node:crypto";
import { redis } from "../cache/redis.js";

type ConfirmBody = {
  station_id: string;
  is_working: boolean;
};

type ConfirmHeaders = {
  "x-forwarded-for"?: string;
};

type StationExistenceRow = {
  id: string;
  latitude: number;
  longitude: number;
};

type CountRow = {
  count: number;
};

type ConfirmationTotalsRow = {
  working_count: number;
  not_working_count: number;
};

const confirmBodySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    station_id: {
      type: "string",
      pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
    },
    is_working: { type: "boolean" },
  },
  required: ["station_id", "is_working"],
} as const;

const confirmHeadersSchema = {
  type: "object",
  properties: {
    "x-forwarded-for": { type: "string" },
  },
} as const;

const stationNotFoundSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    error: { type: "string" },
  },
  required: ["error"],
} as const;

const confirmRateLimitSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    error: { type: "string" },
  },
  required: ["error"],
} as const;

const confirmSuccessSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    success: { type: "boolean" },
    working_count: { type: "integer" },
    not_working_count: { type: "integer" },
  },
  required: ["success", "working_count", "not_working_count"],
} as const;

function truncateTo2Decimals(value: number): number {
  return Math.trunc(value * 100) / 100;
}

function extractClientIp(forwardedFor: string | undefined, fallbackIp: string): string {
  if (!forwardedFor || forwardedFor.trim().length === 0) {
    return fallbackIp;
  }

  const [firstIp] = forwardedFor.split(",");
  return firstIp?.trim() || fallbackIp;
}

async function invalidateAreaCache(latitude: number, longitude: number): Promise<void> {
  const lat2dp = truncateTo2Decimals(latitude).toFixed(2);
  const lng2dp = truncateTo2Decimals(longitude).toFixed(2);
  const prefix = `stations:${lat2dp},${lng2dp},`;

  try {
    const keys = await redis.keys(`${prefix}*`);
    if (Array.isArray(keys) && keys.length > 0) {
      await Promise.all(keys.map(async (key) => redis.del(key)));
    }
  } catch {
    return;
  }
}

const confirmRoutes: FastifyPluginAsync = async (server) => {
  server.post<{ Body: ConfirmBody; Headers: ConfirmHeaders }>(
    "/",
    {
      schema: {
        body: confirmBodySchema,
        headers: confirmHeadersSchema,
        response: {
          200: confirmSuccessSchema,
          404: stationNotFoundSchema,
          429: confirmRateLimitSchema,
        },
      },
    },
    async (request, reply) => {
      const { station_id: stationId, is_working: isWorking } = request.body;

      const [station] = (await server.db(
        `
          SELECT
            id,
            ST_Y(location::geometry) AS latitude,
            ST_X(location::geometry) AS longitude
          FROM stations
          WHERE id = $1
          LIMIT 1
        `,
        [stationId],
      )) as StationExistenceRow[];

      if (!station) {
        return reply.code(404).send({ error: "Station not found" });
      }

      const clientIp = extractClientIp(request.headers["x-forwarded-for"], request.ip);
      const ipHash = crypto.createHash("sha256").update(clientIp).digest("hex");

      const [recentExisting] = (await server.db(
        `
          SELECT 1 AS count
          FROM confirmations
          WHERE station_id = $1
            AND ip_hash = $2
            AND confirmed_at >= now() - interval '24 hours'
          LIMIT 1
        `,
        [stationId, ipHash],
      )) as CountRow[];

      if (recentExisting) {
        return reply.code(429).send({ error: "Already confirmed recently" });
      }

      await server.db(
        `
          INSERT INTO confirmations (station_id, user_id, ip_hash, is_working)
          VALUES ($1, NULL, $2, $3)
        `,
        [stationId, ipHash, isWorking],
      );

      const [recentNotWorking] = (await server.db(
        `
          SELECT COUNT(*)::int AS count
          FROM confirmations
          WHERE station_id = $1
            AND is_working = false
            AND confirmed_at >= now() - interval '7 days'
        `,
        [stationId],
      )) as CountRow[];

      if ((recentNotWorking?.count ?? 0) >= 3) {
        await server.db(
          `
            UPDATE stations
            SET status = 'pending'
            WHERE id = $1
          `,
          [stationId],
        );
      }

      const [totals] = (await server.db(
        `
          SELECT
            COUNT(*) FILTER (WHERE is_working IS TRUE)::int AS working_count,
            COUNT(*) FILTER (WHERE is_working IS FALSE)::int AS not_working_count
          FROM confirmations
          WHERE station_id = $1
        `,
        [stationId],
      )) as ConfirmationTotalsRow[];

      await invalidateAreaCache(station.latitude, station.longitude);

      return {
        success: true,
        working_count: totals?.working_count ?? 0,
        not_working_count: totals?.not_working_count ?? 0,
      };
    },
  );
};

export default confirmRoutes;