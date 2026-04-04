import type { FastifyPluginAsync } from "fastify";
import { getCached, setCached } from "../cache/redis.js";

type StationType = "fountain" | "bottle_filler" | "store_refill" | "tap";

type StationListRow = {
  id: string;
  name: string;
  type: StationType | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  is_free: boolean | null;
  cost_description: string | null;
  is_verified: boolean | null;
  status: string | null;
  source: string | null;
  osm_id: string | null;
  photo_url: string | null;
  added_by: string | null;
  owner_id: string | null;
  is_featured: boolean | null;
  created_at: string | null;
  updated_at: string | null;
  latitude: number;
  longitude: number;
  working_confirmations: number;
  not_working_confirmations: number;
  last_confirmation_at: string | null;
};

type StationDetailRow = StationListRow;

type StationListQuery = {
  lat?: number;
  lng?: number;
  radius?: number;
  type?: StationType;
  is_free?: boolean;
  geojson?: boolean;
};

const stationListQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    lat: { type: "number", default: 39.5 },
    lng: { type: "number", default: -98.5 },
    radius: { type: "integer", minimum: 1, maximum: 40000, default: 8047 },
    type: { type: "string", enum: ["fountain", "bottle_filler", "store_refill", "tap"] },
    is_free: { type: "boolean" },
    geojson: { type: "boolean", default: true },
  },
} as const;

const stationParamsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: {
      type: "string",
      pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
    },
  },
  required: ["id"],
} as const;

const MAX_LIST_RESULTS = 300;
const LIST_CACHE_TTL_SECONDS = 300;

function truncateTo2Decimals(value: number): number {
  return Math.trunc(value * 100) / 100;
}

function buildCacheKey(query: Required<Pick<StationListQuery, "lat" | "lng" | "radius" | "geojson">> & Pick<StationListQuery, "type" | "is_free">): string {
  const typePart = query.type ?? "all";
  const freePart = query.is_free === undefined ? "all" : String(query.is_free);
  return `stations:${truncateTo2Decimals(query.lat).toFixed(2)},${truncateTo2Decimals(query.lng).toFixed(2)},${query.radius},${typePart},${freePart}`;
}

function buildStationSelectColumns(tableAlias: string): string {
  return `
    ${tableAlias}.id,
    ${tableAlias}.name,
    ${tableAlias}.type,
    ${tableAlias}.address,
    ${tableAlias}.city,
    ${tableAlias}.state,
    ${tableAlias}.zip,
    ${tableAlias}.is_free,
    ${tableAlias}.cost_description,
    ${tableAlias}.is_verified,
    ${tableAlias}.status,
    ${tableAlias}.source,
    ${tableAlias}.osm_id::text AS osm_id,
    ${tableAlias}.photo_url,
    ${tableAlias}.added_by::text AS added_by,
    ${tableAlias}.owner_id::text AS owner_id,
    ${tableAlias}.is_featured,
    ${tableAlias}.created_at::text AS created_at,
    ${tableAlias}.updated_at::text AS updated_at,
    ST_Y(${tableAlias}.location::geometry) AS latitude,
    ST_X(${tableAlias}.location::geometry) AS longitude,
    COALESCE(conf.working_confirmations, 0) AS working_confirmations,
    COALESCE(conf.not_working_confirmations, 0) AS not_working_confirmations,
    conf.last_confirmation_at::text AS last_confirmation_at
  `;
}

function toFeatureCollection(rows: StationListRow[]) {
  return {
    type: "FeatureCollection",
    features: rows.map((station) => {
      const { latitude, longitude, ...properties } = station;

      return {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [longitude, latitude],
        },
        properties,
      };
    }),
  };
}

function buildStationListSql(query: Required<Pick<StationListQuery, "lat" | "lng" | "radius">> & Pick<StationListQuery, "type" | "is_free">): { text: string; values: unknown[] } {
  const values: unknown[] = [query.lng, query.lat, query.radius];
  const whereClauses = [
    "s.status = 'approved'",
    "ST_DWithin(s.location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)",
  ];

  if (query.type !== undefined) {
    values.push(query.type);
    whereClauses.push(`s.type = $${values.length}`);
  }

  if (query.is_free !== undefined) {
    values.push(query.is_free);
    whereClauses.push(`s.is_free = $${values.length}`);
  }

  const text = `
    SELECT
      ${buildStationSelectColumns("s")}
    FROM stations s
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) FILTER (WHERE c.is_working IS TRUE) AS working_confirmations,
        COUNT(*) FILTER (WHERE c.is_working IS FALSE) AS not_working_confirmations,
        MAX(c.confirmed_at) AS last_confirmation_at
      FROM confirmations c
      WHERE c.station_id = s.id
    ) conf ON TRUE
    WHERE ${whereClauses.join(" AND ")}
    ORDER BY ST_Distance(
      s.location,
      ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
    ) ASC
    LIMIT ${MAX_LIST_RESULTS}
  `;

  return { text, values };
}

function buildStationDetailSql(id: string): { text: string; values: unknown[] } {
  return {
    text: `
      SELECT
        ${buildStationSelectColumns("s")}
      FROM stations s
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) FILTER (WHERE c.is_working IS TRUE) AS working_confirmations,
          COUNT(*) FILTER (WHERE c.is_working IS FALSE) AS not_working_confirmations,
          MAX(c.confirmed_at) AS last_confirmation_at
        FROM confirmations c
        WHERE c.station_id = s.id
      ) conf ON TRUE
      WHERE s.id = $1
      LIMIT 1
    `,
    values: [id],
  };
}

const stationsRoutes: FastifyPluginAsync = async (server) => {
  server.get(
    "/",
    {
      schema: {
        querystring: stationListQuerySchema,
      },
    },
    async (request) => {
      const query = request.query as StationListQuery;
      const lat = query.lat ?? 39.5;
      const lng = query.lng ?? -98.5;
      const radius = Math.min(query.radius ?? 8047, 40000);
      const geojson = query.geojson ?? true;

      const cacheKey = buildCacheKey({ lat, lng, radius, geojson, type: query.type, is_free: query.is_free });
      const cached = await getCached<StationListRow[]>(cacheKey);

      let rows: StationListRow[];

      if (cached !== null) {
        rows = cached;
      } else {
        const stationListSql = buildStationListSql({
          lat,
          lng,
          radius,
          type: query.type,
          is_free: query.is_free,
        });
        rows = (await server.db(stationListSql.text, stationListSql.values)) as StationListRow[];
        await setCached(cacheKey, rows, LIST_CACHE_TTL_SECONDS);
      }

      if (geojson) {
        return toFeatureCollection(rows);
      }

      return rows;
    },
  );

  server.get<{ Params: { id: string } }>(
    "/:id",
    {
      schema: {
        params: stationParamsSchema,
      },
    },
    async (request, reply) => {
      const stationSql = buildStationDetailSql(request.params.id);
      const [station] = (await server.db(stationSql.text, stationSql.values)) as StationDetailRow[];

      if (!station) {
        return reply.code(404).send({ error: "Station not found" });
      }

      return station;
    },
  );

  // Save a station (requires authentication)
  server.post<{ Params: { id: string } }>(
    "/:id/save",
    {
      schema: {
        params: stationParamsSchema,
      },
    },
    async (request, reply) => {
      // Extract user ID from BetterAuth session (via Authorization header or cookies)
      const authHeader = request.headers.authorization?.replace("Bearer ", "");
      if (!authHeader) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      // For now, we'll extract user_id from a custom header since BetterAuth integration is simplified
      // In production, this would verify the session token with BetterAuth
      const userId = request.headers["x-user-id"] as string;
      if (!userId) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      const stationId = request.params.id;

      // Verify station exists
      const [station] = (await server.db(
        "SELECT id FROM stations WHERE id = $1 LIMIT 1",
        [stationId],
      )) as Array<{ id: string }>;

      if (!station) {
        return reply.code(404).send({ error: "Station not found" });
      }

      // Insert into saved_stations (ON CONFLICT DO NOTHING for idempotency)
      await server.db(
        `
          INSERT INTO saved_stations (user_id, station_id)
          VALUES ($1, $2)
          ON CONFLICT DO NOTHING
        `,
        [userId, stationId],
      );

      return { saved: true };
    },
  );

  // Unsave a station (requires authentication)
  server.delete<{ Params: { id: string } }>(
    "/:id/save",
    {
      schema: {
        params: stationParamsSchema,
      },
    },
    async (request, reply) => {
      const authHeader = request.headers.authorization?.replace("Bearer ", "");
      if (!authHeader) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      const userId = request.headers["x-user-id"] as string;
      if (!userId) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      const stationId = request.params.id;

      await server.db(
        `
          DELETE FROM saved_stations
          WHERE user_id = $1 AND station_id = $2
        `,
        [userId, stationId],
      );

      return { saved: false };
    },
  );

  // Get all saved stations for current user (requires authentication)
  server.get<{ Querystring: { lat?: number; lng?: number } }>(
    "/saved",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            lat: { type: "number" },
            lng: { type: "number" },
          },
        },
      },
    },
    async (request, reply) => {
      const authHeader = request.headers.authorization?.replace("Bearer ", "");
      if (!authHeader) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      const userId = request.headers["x-user-id"] as string;
      if (!userId) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      const { lat, lng } = request.query as { lat?: number; lng?: number };

      interface SavedStationRow extends StationListRow {
        distance_km?: number;
      }

      let sql: string;
      const params: (string | number)[] = [userId];

      if (lat !== undefined && lng !== undefined) {
        // Calculate distance if lat/lng provided
        sql = `
          SELECT
            ${buildStationSelectColumns("s")},
            ST_Distance(
              s.location,
              ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography
            ) / 1000 AS distance_km
          FROM saved_stations ss
          JOIN stations s ON ss.station_id = s.id
          WHERE ss.user_id = $1
          ORDER BY distance_km ASC
          LIMIT ${MAX_LIST_RESULTS}
        `;
        params.push(lng, lat);
      } else {
        // Without distance calculation
        sql = `
          SELECT
            ${buildStationSelectColumns("s")}
          FROM saved_stations ss
          JOIN stations s ON ss.station_id = s.id
          WHERE ss.user_id = $1
          ORDER BY ss.saved_at DESC
          LIMIT ${MAX_LIST_RESULTS}
        `;
      }

      const rows = (await server.db(sql, params)) as SavedStationRow[];
      return rows;
    },
  );
};

export default stationsRoutes;