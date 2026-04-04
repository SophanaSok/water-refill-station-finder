import { env } from "../env.js";

type GeocodeResult = {
  lng: number;
  lat: number;
};

type MapboxFeature = {
  center?: unknown;
};

type MapboxResponse = {
  features?: MapboxFeature[];
};

function isCenter(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number" &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  );
}

export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  const encodedAddress = encodeURIComponent(address.trim());

  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodedAddress}.json` +
    `?access_token=${encodeURIComponent(env.MAPBOX_SECRET_TOKEN)}` +
    "&bbox=-171.79,18.91,-66.96,71.38" +
    "&country=us" +
    "&types=place,address,neighborhood,locality" +
    "&limit=5";

  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    return null;
  }

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as MapboxResponse;
  const firstFeature = payload.features?.[0];

  if (!firstFeature || !isCenter(firstFeature.center)) {
    return null;
  }

  return { lng: firstFeature.center[0], lat: firstFeature.center[1] };
}