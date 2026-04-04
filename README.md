# Water Refill Station Finder

Water Refill Station Finder is a full-stack app for discovering, confirming, and contributing water refill locations. The project uses a Fastify API, a Vite-based frontend, PostgreSQL with PostGIS, Neon Serverless SQL access, Upstash Redis caching, and Cloudflare R2 for photo storage.

## Tech Stack

- Frontend: Vite, TypeScript, MapLibre GL, service worker PWA support
- API: Fastify, TypeScript, Better Auth, Zod
- Data: Neon PostgreSQL, PostGIS, Redis, Cloudflare R2
- Deployment: Render for the API, Cloudflare Pages for the frontend

## Local Setup

1. Install dependencies from the repo root.

	```bash
	npm install
	```

2. Copy the example env files and fill in real values.

	```bash
	cp .env.example .env
	cp api/.env.example api/.env
	```

3. Set `VITE_API_URL` in your shell before running the frontend, for example:

	```bash
	export VITE_API_URL=http://localhost:3000
	```

4. Start the API and frontend in separate terminals.

	```bash
	npm run dev:api
	npm run dev:frontend
	```

## OSM Import

The initial seed script lives in [scripts/osm-import.ts](scripts/osm-import.ts). It pulls drinking-water nodes from OpenStreetMap’s Overpass API and upserts them into `stations`.

Run the full database bootstrap from the repo root after `DATABASE_URL` is available:

```bash
npm run db:bootstrap
```

If you only need to refresh the OSM seed data, run:

```bash
npm -w scripts run run-script -- osm-import.ts
```

The bootstrap script applies [api/src/db/schema.sql](api/src/db/schema.sql) first, then seeds stations.

## Deployment

### Render API

1. Create a new Render web service from the repo.
2. Point Render at the `api` folder, or use the included [api/render.yaml](api/render.yaml).
3. Configure the environment variables from the table below.
4. Render will build with `npm ci && npm run build` and start with `node dist/server.js`.

### Cloudflare Pages Frontend

1. Deploy the `frontend` directory as the Pages project.
2. Use the Vite build command and publish `frontend/dist`.
3. Keep [frontend/public/_redirects](frontend/public/_redirects) so direct client-side routes resolve to `index.html`.
4. Set `VITE_API_URL` to the Render API URL in the Pages build environment.

## Environment Variables

### API

| Name | Required | Description | Where to get it |
| --- | --- | --- | --- |
| `DATABASE_URL` | Yes | Neon PostgreSQL connection string | Neon project dashboard |
| `MAPBOX_SECRET_TOKEN` | Yes | Server-side geocoding token | Mapbox dashboard |
| `UPSTASH_REDIS_REST_URL` | Yes | Redis REST endpoint for caching | Upstash dashboard |
| `UPSTASH_REDIS_REST_TOKEN` | Yes | Redis REST auth token | Upstash dashboard |
| `R2_ACCOUNT_ID` | Yes | Cloudflare R2 account identifier | Cloudflare dashboard |
| `R2_ACCESS_KEY_ID` | Yes | R2 access key | Cloudflare dashboard |
| `R2_SECRET_ACCESS_KEY` | Yes | R2 secret key | Cloudflare dashboard |
| `R2_BUCKET_NAME` | Yes | Bucket used for uploaded photos | Cloudflare dashboard |
| `R2_PUBLIC_URL` | Yes | Public base URL for R2 assets | Your Cloudflare R2 public URL |
| `BETTER_AUTH_SECRET` | Yes | Secret used by Better Auth | Generate a strong random secret |
| `BETTER_AUTH_URL` | Yes | Canonical auth URL | Your deployed API URL |
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth client ID | Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth client secret | Google Cloud Console |
| `ADMIN_API_KEY` | Yes | Admin access key for moderation endpoints | Create and store securely |
| `FRONTEND_URL` | Yes | Allowed frontend origin for CORS | Localhost or deployed Pages URL |
| `NODE_ENV` | Yes in production | Runtime environment | Set to `production` in Render |
| `PORT` | No | API listen port | Render or local shell |

### Frontend

| Name | Required | Description | Where to get it |
| --- | --- | --- | --- |
| `VITE_API_URL` | Yes | Base URL for the API used at build time | Render API URL or `http://localhost:3000` |

## Database Setup

1. Create a Neon project and copy the PostgreSQL connection string.
2. Enable PostGIS in the database. The schema file does this automatically with `CREATE EXTENSION IF NOT EXISTS postgis;`.
3. Apply the schema from [api/src/db/schema.sql](api/src/db/schema.sql).

	```bash
	psql "$DATABASE_URL" -f api/src/db/schema.sql
	```

4. Confirm the required tables exist: `users`, `stations`, `saved_stations`, `confirmations`, `flags`, `station_submissions`, and `station_moderation_notes`.
5. Run the OSM import script after the schema is in place if you want seeded stations.

## Helpful Commands

```bash
npm run dev:api
npm run dev:frontend
npm run build:api
npm run build:frontend
npm run build
npm run db:bootstrap
```