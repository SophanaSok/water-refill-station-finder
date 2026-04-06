import type { FastifyPluginAsync } from "fastify";
import { env } from "../env.js";
import { getCached, setCached } from "../cache/redis.js";
import { consumeRateLimit } from "../lib/rateLimit.js";

type GeocodeQuery = {
  q: string;
};

type MapboxFeature = {
  id?: unknown;
  text?: unknown;
  place_name?: unknown;
  place_type?: unknown;
  center?: unknown;
  bbox?: unknown;
};

type MapboxResponse = {
  features?: MapboxFeature[];
};

type SimplifiedGeocodeResult = {
  place_name: string;
  center: [number, number];
  bbox?: [number, number, number, number];
};

const geocodeQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    q: {
      type: "string",
      minLength: 2,
      maxLength: 200,
    },
  },
  required: ["q"],
} as const;

const geocodeResultSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    place_name: { type: "string" },
    center: {
      type: "array",
      items: { type: "number" },
      minItems: 2,
      maxItems: 2,
    },
    bbox: {
      type: "array",
      items: { type: "number" },
      minItems: 4,
      maxItems: 4,
    },
  },
  required: ["place_name", "center"],
} as const;

const geocodeUnavailableSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    error: { type: "string" },
  },
  required: ["error"],
} as const;

function toCacheKey(rawQuery: string): string {
  return `geocode:v2:${rawQuery.toLowerCase().trim()}`;
}

function isLngLatPair(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1])
  );
}

function isBbox4(value: unknown): value is [number, number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((part) => typeof part === "number" && Number.isFinite(part))
  );
}

function simplifyFeatures(features: MapboxFeature[]): SimplifiedGeocodeResult[] {
  return features
    .filter((feature) => {
      return typeof feature.place_name === "string" && isLngLatPair(feature.center);
    })
    .map((feature) => {
      const result: SimplifiedGeocodeResult = {
        place_name: feature.place_name as string,
        center: feature.center as [number, number],
      };

      if (isBbox4(feature.bbox)) {
        result.bbox = feature.bbox;
      }

      return result;
    });
}

function isZipLikeQuery(query: string): boolean {
  return /^\d{5}(?:-\d{4})?$/.test(query);
}

function rankFeatures(features: MapboxFeature[], query: string): MapboxFeature[] {
  if (!isZipLikeQuery(query)) {
    return features;
  }

  const normalizedQuery = query.trim();

  return [...features].sort((a, b) => {
    const aTypes = Array.isArray(a.place_type) ? a.place_type.filter((t) => typeof t === "string") : [];
    const bTypes = Array.isArray(b.place_type) ? b.place_type.filter((t) => typeof t === "string") : [];

    const aIsPostcode = aTypes.includes("postcode");
    const bIsPostcode = bTypes.includes("postcode");
    if (aIsPostcode !== bIsPostcode) {
      return aIsPostcode ? -1 : 1;
    }

    const aText = typeof a.text === "string" ? a.text : "";
    const bText = typeof b.text === "string" ? b.text : "";
    const aExact = aText === normalizedQuery;
    const bExact = bText === normalizedQuery;
    if (aExact !== bExact) {
      return aExact ? -1 : 1;
    }

    return 0;
  });
}

const geocodeRoutes: FastifyPluginAsync = async (server) => {
  server.get<{ Querystring: GeocodeQuery }>(
    "/",
    {
      preHandler: async (request, reply) => {
        const result = await consumeRateLimit(`geocode:${request.ip}`, 30, 60_000);
        reply.header("x-ratelimit-limit", "30");
        reply.header("x-ratelimit-remaining", String(result.remaining));
        reply.header("x-ratelimit-reset", String(Math.ceil(result.resetAt / 1000)));

        if (!result.allowed) {
          return reply.code(429).send({ error: "Too many requests" });
        }
      },
      schema: {
        querystring: geocodeQuerySchema,
        response: {
          200: {
            type: "array",
            items: geocodeResultSchema,
          },
          502: geocodeUnavailableSchema,
        },
      },
    },
    async (request, reply) => {
      const normalizedQuery = request.query.q.trim();
      const cacheKey = toCacheKey(normalizedQuery);

      const cached = await getCached<SimplifiedGeocodeResult[]>(cacheKey);
      if (cached !== null) {
        return cached;
      }

      const encodedQuery = encodeURIComponent(normalizedQuery);
      const mapboxUrl =
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodedQuery}.json` +
        `?access_token=${encodeURIComponent(env.MAPBOX_SECRET_TOKEN)}` +
        "&bbox=-171.79,18.91,-66.96,71.38" +
        "&country=us" +
        "&types=postcode,address,place,neighborhood,locality" +
        "&limit=5";

      let response: Response;
      try {
        response = await fetch(mapboxUrl);
      } catch {
        return reply.code(502).send({ error: "Geocoding service unavailable" });
      }

      if (!response.ok) {
        return reply.code(502).send({ error: "Geocoding service unavailable" });
      }

      const payload = (await response.json()) as MapboxResponse;
      const rankedFeatures = rankFeatures(payload.features ?? [], normalizedQuery);
      const simplified = simplifyFeatures(rankedFeatures);

      await setCached(cacheKey, simplified, 3600);
      return simplified;
    },
  );
};

export default geocodeRoutes;