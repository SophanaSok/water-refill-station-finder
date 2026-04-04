import assert from "node:assert/strict";
import test, { beforeEach, afterEach } from "node:test";

const requiredEnv: Record<string, string> = {
  DATABASE_URL: "postgresql://user:password@host.tld/dbname?sslmode=require",
  MAPBOX_SECRET_TOKEN: "test-mapbox-token",
  UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "test-upstash-token",
  R2_ACCOUNT_ID: "test-r2-account",
  R2_ACCESS_KEY_ID: "test-r2-access-key",
  R2_SECRET_ACCESS_KEY: "test-r2-secret-key",
  R2_BUCKET_NAME: "test-bucket",
  R2_PUBLIC_URL: "https://example.com",
  BETTER_AUTH_SECRET: "test-secret",
  BETTER_AUTH_URL: "http://localhost:3000",
  GOOGLE_CLIENT_ID: "test-google-client-id",
  GOOGLE_CLIENT_SECRET: "test-google-client-secret",
  ADMIN_API_KEY: "test-admin-key",
  FRONTEND_URL: "http://localhost:5173",
  NODE_ENV: "test",
  PORT: "3000",
};

for (const [key, value] of Object.entries(requiredEnv)) {
  process.env[key] = value;
}

const { clearRateLimitBuckets } = await import("../src/lib/rateLimit.js");

const fakeRows = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Test Station",
    type: "fountain",
    address: "1 Main St",
    city: "Test City",
    state: "CA",
    zip: "12345",
    is_free: true,
    cost_description: null,
    is_verified: true,
    status: "approved",
    source: "osm",
    osm_id: "123",
    photo_url: null,
    added_by: null,
    owner_id: null,
    is_featured: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    latitude: 38.5,
    longitude: -121.5,
    working_confirmations: 2,
    not_working_confirmations: 0,
    last_confirmation_at: new Date().toISOString(),
  },
];

const fakeDb = async (query: string) => {
  if (query.includes("SELECT 1")) {
    return [{ "?column?": 1 }];
  }

  if (query.includes("WHERE s.id = $1")) {
    return fakeRows;
  }

  if (query.includes("FROM stations s")) {
    return fakeRows;
  }

  return [];
};

async function loadApp() {
  const { buildApp } = await import("../src/app.js");
  return buildApp({ db: fakeDb as never });
}

beforeEach(() => {
  clearRateLimitBuckets();
});

afterEach(() => {
  clearRateLimitBuckets();
});

test("health and readiness endpoints respond", async () => {
  const app = await loadApp();
  await app.ready();

  const health = await app.inject({ method: "GET", url: "/health" });
  assert.equal(health.statusCode, 200);

  const ready = await app.inject({ method: "GET", url: "/ready" });
  assert.equal(ready.statusCode, 200);

  await app.close();
});

test("stations list and detail endpoints respond", async () => {
  const app = await loadApp();
  await app.ready();

  const list = await app.inject({ method: "GET", url: "/api/stations?lat=38.5&lng=-121.5&geojson=true" });
  assert.equal(list.statusCode, 200);

  const payload = list.json() as { features: Array<{ properties: { id: string } }> };
  assert.ok(payload.features.length > 0);

  const detail = await app.inject({ method: "GET", url: `/api/stations/${payload.features[0].properties.id}` });
  assert.equal(detail.statusCode, 200);

  await app.close();
});

test("geocode route is rate limited", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => ({ features: [] }),
  })) as typeof fetch;

  const app = await loadApp();
  await app.ready();

  let lastResponseStatus = 0;
  for (let index = 0; index < 31; index += 1) {
    const response = await app.inject({ method: "GET", url: "/api/geocode?q=test" });
    lastResponseStatus = response.statusCode;
  }

  assert.equal(lastResponseStatus, 429);
  await app.close();
  globalThis.fetch = originalFetch;
});