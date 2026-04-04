import type { FastifyPluginAsync } from "fastify";
import { consumeRateLimit } from "../lib/rateLimit.js";

type FlagReason = "doesnt_exist" | "wrong_location" | "not_safe" | "duplicate" | "other";

type FlagsBody = {
  station_id: string;
  reason: FlagReason;
  note?: string;
};

type StationExistsRow = {
  id: string;
};

type UnresolvedFlagsRow = {
  unresolved_count: number;
};

const flagsBodySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    station_id: {
      type: "string",
      pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
    },
    reason: {
      type: "string",
      enum: ["doesnt_exist", "wrong_location", "not_safe", "duplicate", "other"],
    },
    note: {
      type: "string",
      maxLength: 500,
    },
  },
  required: ["station_id", "reason"],
} as const;

const flagsSuccessSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    success: { type: "boolean" },
  },
  required: ["success"],
} as const;

const flagsNotFoundSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    error: { type: "string" },
  },
  required: ["error"],
} as const;

const flagsRoutes: FastifyPluginAsync = async (server) => {
  server.post<{ Body: FlagsBody }>(
    "/",
    {
      preHandler: async (request, reply) => {
        const result = await consumeRateLimit(`flags:${request.ip}`, 20, 60_000);
        reply.header("x-ratelimit-limit", "20");
        reply.header("x-ratelimit-remaining", String(result.remaining));
        reply.header("x-ratelimit-reset", String(Math.ceil(result.resetAt / 1000)));

        if (!result.allowed) {
          return reply.code(429).send({ error: "Too many requests" });
        }
      },
      schema: {
        body: flagsBodySchema,
        response: {
          200: flagsSuccessSchema,
          404: flagsNotFoundSchema,
        },
      },
    },
    async (request, reply) => {
      const { station_id: stationId, reason, note } = request.body;

      const [station] = (await server.db(
        `
          SELECT id
          FROM stations
          WHERE id = $1
          LIMIT 1
        `,
        [stationId],
      )) as StationExistsRow[];

      if (!station) {
        return reply.code(404).send({ error: "Station not found" });
      }

      await server.db(
        `
          INSERT INTO flags (station_id, user_id, reason, note)
          VALUES ($1, NULL, $2, $3)
        `,
        [stationId, reason, note ?? null],
      );

      const [unresolved] = (await server.db(
        `
          SELECT COUNT(*)::int AS unresolved_count
          FROM flags
          WHERE station_id = $1
            AND resolved = false
        `,
        [stationId],
      )) as UnresolvedFlagsRow[];

      if ((unresolved?.unresolved_count ?? 0) >= 5) {
        await server.db(
          `
            UPDATE stations
            SET status = 'pending'
            WHERE id = $1
          `,
          [stationId],
        );
      }

      return { success: true };
    },
  );
};

export default flagsRoutes;