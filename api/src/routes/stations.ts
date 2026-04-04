import type { FastifyPluginAsync } from "fastify";

type StationRow = {
  id: string;
  name: string;
  type: string | null;
  location: string;
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
};

const stationsRoutes: FastifyPluginAsync = async (server) => {
  server.get("/", async (request, reply) => {
    const query = request.query as {
      lat?: string;
      lng?: string;
      radius?: string;
      limit?: string;
    };

    const limit = Math.min(Math.max(Number.parseInt(query.limit ?? "100", 10) || 100, 1), 500);
    const lat = query.lat !== undefined ? Number.parseFloat(query.lat) : undefined;
    const lng = query.lng !== undefined ? Number.parseFloat(query.lng) : undefined;
    const radius = query.radius !== undefined ? Number.parseInt(query.radius, 10) || 5000 : 5000;

    if ((lat === undefined) !== (lng === undefined)) {
      return reply.code(400).send({
        error: "Bad Request",
        message: "lat and lng must be provided together",
      });
    }

    if (lat !== undefined && Number.isNaN(lat)) {
      return reply.code(400).send({
        error: "Bad Request",
        message: "lat must be a valid number",
      });
    }

    if (lng !== undefined && Number.isNaN(lng)) {
      return reply.code(400).send({
        error: "Bad Request",
        message: "lng must be a valid number",
      });
    }

    if (Number.isNaN(radius) || radius < 1) {
      return reply.code(400).send({
        error: "Bad Request",
        message: "radius must be a positive integer",
      });
    }

    const nearbyFilter = lat !== undefined && lng !== undefined;

    const rows = (nearbyFilter
      ? await server.db(
          `
            SELECT
              id,
              name,
              type,
              ST_AsGeoJSON(location)::text AS location,
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
            FROM stations
            WHERE ST_DWithin(
              location,
              ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
              $3
            )
            ORDER BY ST_Distance(
              location,
              ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
            ) ASC
            LIMIT $4
          `,
          [lng, lat, radius, limit],
        )
      : await server.db(
          `
            SELECT
              id,
              name,
              type,
              ST_AsGeoJSON(location)::text AS location,
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
            FROM stations
            ORDER BY created_at DESC
            LIMIT $1
          `,
          [limit],
        )) as StationRow[];

    return rows;
  });

  server.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const [station] = (await server.db(
      `
        SELECT
          id,
          name,
          type,
          ST_AsGeoJSON(location)::text AS location,
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
        FROM stations
        WHERE id = $1
        LIMIT 1
      `,
      [request.params.id],
    )) as StationRow[];

    if (!station) {
      return reply.code(404).send({ error: "Not Found", message: "Station not found" });
    }

    return station;
  });
};

export default stationsRoutes;