import "dotenv/config";
import { neon } from "@neondatabase/serverless";

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
];
const OVERPASS_QUERY = `[out:json][timeout:60];
area["ISO3166-1"="US"][admin_level=2]->.usa;
node(area.usa)["amenity"="drinking_water"];
out body;`;

const BATCH_SIZE = 500;

type OverpassResponse = {
  elements: OverpassNode[];
};

type OverpassNode = {
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
};

type SeedStation = {
  osmId: string;
  name: string;
  type: "fountain";
  latitude: number;
  longitude: number;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  costDescription: string | null;
  photoUrl: string | null;
};

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run the OSM import");
}

const sql = neon(databaseUrl);

function normalizeText(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildAddress(tags: Record<string, string> | undefined): string | null {
  if (!tags) {
    return null;
  }

  const parts = [tags["addr:housenumber"], tags["addr:street"], tags["addr:unit"]]
    .map(normalizeText)
    .filter((part): part is string => part !== null);

  return parts.length > 0 ? parts.join(" ") : null;
}

function pickName(tags: Record<string, string> | undefined): string {
  if (!tags) {
    return "Drinking water";
  }

  return (
    normalizeText(tags.name) ??
    normalizeText(tags.brand) ??
    normalizeText(tags.operator) ??
    "Drinking water"
  );
}

function parseCostDescription(tags: Record<string, string> | undefined): string | null {
  if (!tags) {
    return null;
  }

  return normalizeText(tags["payment:cash"] === "no" ? "Free" : tags["fee"]);
}

function mapNodeToStation(node: OverpassNode): SeedStation {
  const tags = node.tags;

  return {
    osmId: node.id.toString(),
    name: pickName(tags),
    type: "fountain",
    latitude: node.lat,
    longitude: node.lon,
    address: buildAddress(tags),
    city: normalizeText(tags?.["addr:city"]),
    state: normalizeText(tags?.["addr:state"]),
    zip: normalizeText(tags?.["addr:postcode"]),
    costDescription: parseCostDescription(tags),
    photoUrl: normalizeText(tags?.image),
  };
}

async function fetchOverpassStations(): Promise<OverpassNode[]> {
  let payload: OverpassResponse | null = null;
  let lastError: unknown = null;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
        },
        body: new URLSearchParams({ data: OVERPASS_QUERY }),
      });

      if (!response.ok) {
        throw new Error(`Overpass request failed with status ${response.status}`);
      }

      payload = (await response.json()) as OverpassResponse;
      break;
    } catch (error) {
      lastError = error;
      console.warn(`Overpass endpoint failed: ${endpoint}`);
    }
  }

  if (!payload) {
    throw new Error(`All Overpass endpoints failed. Last error: ${String(lastError)}`);
  }

  if (!Array.isArray(payload.elements)) {
    throw new Error("Unexpected Overpass response shape");
  }

  return payload.elements.filter((element): element is OverpassNode => {
    return (
      typeof element.id === "number" &&
      typeof element.lat === "number" &&
      typeof element.lon === "number"
    );
  });
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function buildUpsertQuery(stations: SeedStation[]): { text: string; values: unknown[] } {
  const values: unknown[] = [];
  const rows = stations.map((station, index) => {
    const offset = index * 11;

    values.push(
      station.name,
      station.type,
      station.longitude,
      station.latitude,
      station.address,
      station.city,
      station.state,
      station.zip,
      station.costDescription,
      station.photoUrl,
      station.osmId,
    );

    return `(
      $${offset + 1},
      $${offset + 2},
      ST_SetSRID(ST_MakePoint($${offset + 3}, $${offset + 4}), 4326)::geography,
      $${offset + 5},
      $${offset + 6},
      $${offset + 7},
      $${offset + 8},
      true,
      $${offset + 9},
      true,
      'approved',
      'osm',
      $${offset + 10},
      $${offset + 11},
      NULL,
      NULL,
      false
    )`;
  });

  return {
    text: `
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
        is_verified,
        status,
        source,
        osm_id,
        photo_url,
        added_by,
        owner_id,
        is_featured
      )
      VALUES ${rows.join(",\n")}
      ON CONFLICT (osm_id) DO UPDATE SET
        name = EXCLUDED.name,
        type = EXCLUDED.type,
        location = EXCLUDED.location,
        address = EXCLUDED.address,
        city = EXCLUDED.city,
        state = EXCLUDED.state,
        zip = EXCLUDED.zip,
        is_free = EXCLUDED.is_free,
        cost_description = EXCLUDED.cost_description,
        is_verified = EXCLUDED.is_verified,
        status = EXCLUDED.status,
        source = EXCLUDED.source,
        photo_url = EXCLUDED.photo_url,
        updated_at = now();
    `,
    values,
  };
}

async function seedStations(): Promise<void> {
  console.log("Fetching drinking water stations from Overpass...");
  const overpassNodes = await fetchOverpassStations();
  const stations = overpassNodes.map(mapNodeToStation);

  console.log(`Fetched ${stations.length} candidate station(s).`);

  let insertedOrUpdated = 0;

  for (const stationsChunk of chunk(stations, BATCH_SIZE)) {
    const { text, values } = buildUpsertQuery(stationsChunk);
    await sql(text, values);
    insertedOrUpdated += stationsChunk.length;
    console.log(`Processed ${insertedOrUpdated}/${stations.length} station(s)...`);
  }

  console.log(`Import complete. Processed ${insertedOrUpdated} station(s).`);
}

seedStations().catch((error: unknown) => {
  console.error("OSM import failed:", error);
  process.exitCode = 1;
});