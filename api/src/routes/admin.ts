import type { FastifyPluginAsync } from "fastify";
import { env } from "../env.js";

type StationType = "fountain" | "bottle_filler" | "store_refill" | "tap";
type StationStatus = "pending" | "approved" | "rejected";
type StationSource = "osm" | "crowdsource" | "partner";

type UnauthorizedResponse = { error: "Unauthorized" };
type NotFoundResponse = { error: "Not found" };

type AdminQueueQuery = {
  status?: "pending" | "rejected";
  page?: number;
  limit?: number;
};

type AdminQueueItem = {
  id: string;
  name: string;
  type: StationType | null;
  latitude: number;
  longitude: number;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  is_free: boolean | null;
  cost_description: string | null;
  is_verified: boolean | null;
  status: StationStatus | null;
  source: StationSource | null;
  osm_id: string | null;
  photo_url: string | null;
  added_by: string | null;
  owner_id: string | null;
  is_featured: boolean | null;
  created_at: string | null;
  updated_at: string | null;
  submitter_email: string | null;
  flag_count: number;
  working_confirmations: number;
  not_working_confirmations: number;
};

type AdminQueueCountRow = { total: number };

type QueueResponse = {
  page: number;
  limit: number;
  total: number;
  items: AdminQueueItem[];
};

type UpdateStationParams = { id: string };
type UpdateStationBody = { status: "approved" | "rejected"; note?: string };

type UpdateStationResponse = {
  id: string;
  name: string;
  type: StationType | null;
  latitude: number;
  longitude: number;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  is_free: boolean | null;
  cost_description: string | null;
  is_verified: boolean | null;
  status: StationStatus | null;
  source: StationSource | null;
  osm_id: string | null;
  photo_url: string | null;
  added_by: string | null;
  owner_id: string | null;
  is_featured: boolean | null;
  created_at: string | null;
  updated_at: string | null;
};

type GroupedFlagItem = {
  station_id: string;
  station_name: string;
  flag_count: number;
  reasons_breakdown: Record<string, number>;
  most_recent_flag_date: string | null;
};

type UpdateFlagParams = { id: string };
type UpdateFlagBody = { resolved: boolean };

type UpdateFlagResponse = {
  id: string;
  station_id: string | null;
  user_id: string | null;
  reason: string | null;
  note: string | null;
  resolved: boolean | null;
  flagged_at: string | null;
};

type StatusStat = { status: StationStatus; count: number };
type SourceStat = { source: StationSource; count: number };
type TypeStat = { type: StationType | null; count: number };
type Confirmations7Day = { working: number; not_working: number };
type NewSubmissions7Day = { count: number };
type TopCity = { city: string; count: number };

type AdminStatsResponse = {
  stations_by_status: StatusStat[];
  stations_by_source: SourceStat[];
  stations_by_type: TypeStat[];
  confirmations_last_7_days: Confirmations7Day;
  new_submissions_last_7_days: number;
  top_cities: TopCity[];
};

const adminHeaderSchema = {
  type: "object",
  properties: {
    "x-admin-key": { type: "string" },
  },
} as const;

const uuidSchema = {
  type: "string",
  pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
} as const;

const queueQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", enum: ["pending", "rejected"], default: "pending" },
    page: { type: "integer", minimum: 1, default: 1 },
    limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
  },
} as const;

const updateStationParamsSchema = {
  type: "object",
  additionalProperties: false,
  properties: { id: uuidSchema },
  required: ["id"],
} as const;

const updateStationBodySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", enum: ["approved", "rejected"] },
    note: { type: "string", maxLength: 1000 },
  },
  required: ["status"],
} as const;

const updateFlagParamsSchema = {
  type: "object",
  additionalProperties: false,
  properties: { id: uuidSchema },
  required: ["id"],
} as const;

const updateFlagBodySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    resolved: { type: "boolean" },
  },
  required: ["resolved"],
} as const;

const unauthorizedSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    error: { type: "string" },
  },
  required: ["error"],
} as const;

const notFoundSchema = unauthorizedSchema;

const adminRoutes: FastifyPluginAsync = async (server) => {
  server.addHook("preHandler", async (request, reply) => {
    const adminKey = request.headers["x-admin-key"];
    if (typeof adminKey !== "string" || adminKey !== env.ADMIN_API_KEY) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });

  server.get<{ Querystring: AdminQueueQuery; Reply: QueueResponse | UnauthorizedResponse }>(
    "/queue",
    {
      schema: {
        headers: adminHeaderSchema,
        querystring: queueQuerySchema,
        response: {
          200: {
            type: "object",
            properties: {
              page: { type: "integer" },
              limit: { type: "integer" },
              total: { type: "integer" },
              items: { type: "array", items: { type: "object" } },
            },
            required: ["page", "limit", "total", "items"],
          },
          401: unauthorizedSchema,
        },
      },
    },
    async (request) => {
      const status = request.query.status ?? "pending";
      const page = request.query.page ?? 1;
      const limit = request.query.limit ?? 20;
      const offset = (page - 1) * limit;

      const [countRow] = (await server.db(
        `
          SELECT COUNT(*)::int AS total
          FROM stations s
          WHERE s.status = $1
        `,
        [status],
      )) as AdminQueueCountRow[];

      const items = (await server.db(
        `
          SELECT
            s.id,
            s.name,
            s.type,
            ST_Y(s.location::geometry) AS latitude,
            ST_X(s.location::geometry) AS longitude,
            s.address,
            s.city,
            s.state,
            s.zip,
            s.is_free,
            s.cost_description,
            s.is_verified,
            s.status,
            s.source,
            s.osm_id::text AS osm_id,
            s.photo_url,
            s.added_by::text AS added_by,
            s.owner_id::text AS owner_id,
            s.is_featured,
            s.created_at::text AS created_at,
            s.updated_at::text AS updated_at,
            submission.submitter_email,
            COALESCE(flag_stats.flag_count, 0)::int AS flag_count,
            COALESCE(conf_stats.working_confirmations, 0)::int AS working_confirmations,
            COALESCE(conf_stats.not_working_confirmations, 0)::int AS not_working_confirmations
          FROM stations s
          LEFT JOIN LATERAL (
            SELECT ss.submitter_email
            FROM station_submissions ss
            WHERE ss.station_id = s.id
            ORDER BY ss.submitted_at DESC
            LIMIT 1
          ) submission ON TRUE
          LEFT JOIN LATERAL (
            SELECT COUNT(*) AS flag_count
            FROM flags f
            WHERE f.station_id = s.id
          ) flag_stats ON TRUE
          LEFT JOIN LATERAL (
            SELECT
              COUNT(*) FILTER (WHERE c.is_working IS TRUE) AS working_confirmations,
              COUNT(*) FILTER (WHERE c.is_working IS FALSE) AS not_working_confirmations
            FROM confirmations c
            WHERE c.station_id = s.id
          ) conf_stats ON TRUE
          WHERE s.status = $1
          ORDER BY s.created_at DESC
          LIMIT $2
          OFFSET $3
        `,
        [status, limit, offset],
      )) as AdminQueueItem[];

      return {
        page,
        limit,
        total: countRow?.total ?? 0,
        items,
      };
    },
  );

  server.patch<{
    Params: UpdateStationParams;
    Body: UpdateStationBody;
    Reply: UpdateStationResponse | NotFoundResponse | UnauthorizedResponse;
  }>(
    "/stations/:id",
    {
      schema: {
        headers: adminHeaderSchema,
        params: updateStationParamsSchema,
        body: updateStationBodySchema,
        response: {
          200: { type: "object" },
          401: unauthorizedSchema,
          404: notFoundSchema,
        },
      },
    },
    async (request, reply) => {
      const moderationNote = request.body.note?.trim() || null;

      const [updated] = (await server.db(
        `
          WITH updated_station AS (
            UPDATE stations
            SET status = $2
            WHERE id = $1
            RETURNING
              id,
              name,
              type,
              ST_Y(location::geometry) AS latitude,
              ST_X(location::geometry) AS longitude,
              address,
              city,
              state,
              zip,
              is_free,
              cost_description,
              is_verified,
              status,
              source,
              osm_id::text AS osm_id,
              photo_url,
              added_by::text AS added_by,
              owner_id::text AS owner_id,
              is_featured,
              created_at::text AS created_at,
              updated_at::text AS updated_at
          ),
          inserted_note AS (
            INSERT INTO station_moderation_notes (station_id, status, note)
            SELECT id, $2, $3
            FROM updated_station
            WHERE $3 IS NOT NULL
          )
          SELECT *
          FROM updated_station
        `,
        [request.params.id, request.body.status, moderationNote],
      )) as UpdateStationResponse[];

      if (!updated) {
        return reply.code(404).send({ error: "Not found" });
      }

      return updated;
    },
  );

  server.get<{ Reply: GroupedFlagItem[] | UnauthorizedResponse }>(
    "/flags",
    {
      schema: {
        headers: adminHeaderSchema,
        response: {
          200: { type: "array", items: { type: "object" } },
          401: unauthorizedSchema,
        },
      },
    },
    async () => {
      const rows = (await server.db(
        `
          SELECT
            s.id::text AS station_id,
            s.name AS station_name,
            COUNT(f.id)::int AS flag_count,
            jsonb_build_object(
              'doesnt_exist', COUNT(*) FILTER (WHERE f.reason = 'doesnt_exist'),
              'wrong_location', COUNT(*) FILTER (WHERE f.reason = 'wrong_location'),
              'not_safe', COUNT(*) FILTER (WHERE f.reason = 'not_safe'),
              'duplicate', COUNT(*) FILTER (WHERE f.reason = 'duplicate'),
              'other', COUNT(*) FILTER (WHERE f.reason = 'other')
            )::text AS reasons_breakdown,
            MAX(f.flagged_at)::text AS most_recent_flag_date
          FROM flags f
          JOIN stations s ON s.id = f.station_id
          WHERE f.resolved = false
          GROUP BY s.id, s.name
          ORDER BY flag_count DESC, MAX(f.flagged_at) DESC
        `,
      )) as Array<{
        station_id: string;
        station_name: string;
        flag_count: number;
        reasons_breakdown: string;
        most_recent_flag_date: string | null;
      }>;

      return rows.map((row) => ({
        station_id: row.station_id,
        station_name: row.station_name,
        flag_count: row.flag_count,
        reasons_breakdown: JSON.parse(row.reasons_breakdown) as Record<string, number>,
        most_recent_flag_date: row.most_recent_flag_date,
      }));
    },
  );

  server.patch<{
    Params: UpdateFlagParams;
    Body: UpdateFlagBody;
    Reply: UpdateFlagResponse | NotFoundResponse | UnauthorizedResponse;
  }>(
    "/flags/:id",
    {
      schema: {
        headers: adminHeaderSchema,
        params: updateFlagParamsSchema,
        body: updateFlagBodySchema,
        response: {
          200: { type: "object" },
          401: unauthorizedSchema,
          404: notFoundSchema,
        },
      },
    },
    async (request, reply) => {
      const [updated] = (await server.db(
        `
          UPDATE flags
          SET resolved = $2
          WHERE id = $1
          RETURNING
            id::text AS id,
            station_id::text AS station_id,
            user_id::text AS user_id,
            reason,
            note,
            resolved,
            flagged_at::text AS flagged_at
        `,
        [request.params.id, request.body.resolved],
      )) as UpdateFlagResponse[];

      if (!updated) {
        return reply.code(404).send({ error: "Not found" });
      }

      return updated;
    },
  );

  server.get<{ Reply: AdminStatsResponse | UnauthorizedResponse }>(
    "/stats",
    {
      schema: {
        headers: adminHeaderSchema,
        response: {
          200: { type: "object" },
          401: unauthorizedSchema,
        },
      },
    },
    async () => {
      const stationsByStatus = (await server.db(
        `
          SELECT status, COUNT(*)::int AS count
          FROM stations
          GROUP BY status
          ORDER BY status
        `,
      )) as StatusStat[];

      const stationsBySource = (await server.db(
        `
          SELECT source, COUNT(*)::int AS count
          FROM stations
          GROUP BY source
          ORDER BY source
        `,
      )) as SourceStat[];

      const stationsByType = (await server.db(
        `
          SELECT type, COUNT(*)::int AS count
          FROM stations
          GROUP BY type
          ORDER BY type
        `,
      )) as TypeStat[];

      const [confirmationsLast7Days] = (await server.db(
        `
          SELECT
            COUNT(*) FILTER (WHERE is_working IS TRUE)::int AS working,
            COUNT(*) FILTER (WHERE is_working IS FALSE)::int AS not_working
          FROM confirmations
          WHERE confirmed_at >= now() - interval '7 days'
        `,
      )) as Confirmations7Day[];

      const [newSubmissionsLast7Days] = (await server.db(
        `
          SELECT COUNT(*)::int AS count
          FROM station_submissions
          WHERE submitted_at >= now() - interval '7 days'
        `,
      )) as NewSubmissions7Day[];

      const topCities = (await server.db(
        `
          SELECT city, COUNT(*)::int AS count
          FROM stations
          WHERE city IS NOT NULL AND city <> ''
          GROUP BY city
          ORDER BY count DESC, city ASC
          LIMIT 10
        `,
      )) as TopCity[];

      return {
        stations_by_status: stationsByStatus,
        stations_by_source: stationsBySource,
        stations_by_type: stationsByType,
        confirmations_last_7_days: confirmationsLast7Days ?? { working: 0, not_working: 0 },
        new_submissions_last_7_days: newSubmissionsLast7Days?.count ?? 0,
        top_cities: topCities,
      };
    },
  );
};

export default adminRoutes;