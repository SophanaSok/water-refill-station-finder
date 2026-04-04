import type { FeatureCollection } from "geojson";

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Station properties returned by API list endpoints
 */
export interface Station {
  id: string;
  name: string;
  type: string;
  is_free: boolean;
  address: string;
  city: string;
  state: string;
  is_verified: boolean;
  last_confirmed_days: number;
  last_confirmed_at?: string;
}

/**
 * Extended station details returned by GET /api/stations/:id
 */
export interface StationDetail extends Station {
  latitude: number;
  longitude: number;
  photo_url?: string | null;
  working_count: number;
  not_working_count: number;
  created_at: string;
  updated_at: string;
}

/**
 * Geocoding result from Mapbox
 */
export interface GeocodeResult {
  place_name: string;
  center: [number, number];
  bbox?: [number, number, number, number];
}

/**
 * Confirmation/flag submission result
 */
export interface ConfirmationResult {
  success: boolean;
  working_count: number;
  not_working_count: number;
}

/**
 * Submit station response
 */
export interface SubmitStationResponse {
  success: boolean;
  id: string;
  message: string;
}

/**
 * GeoJSON Feature Collection type for stations
 */
export type StationsGeoJSON = FeatureCollection<
  GeoJSON.Point,
  Station
>;

/**
 * Generic API error class
 */
export class ApiErrorResponse extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiErrorResponse";
  }
}

// ============================================================================
// Base Fetch Wrapper
// ============================================================================

// @ts-expect-error Vite defines this at build time
const baseUrl: string = import.meta.env.VITE_API_URL;

if (!baseUrl) {
  throw new Error("VITE_API_URL is required");
}

/**
 * Fetch wrapper with error handling and JSON parsing
 */
async function apiFetch<T>(
  endpoint: string,
  options?: RequestInit & { params?: Record<string, string | number | boolean> },
): Promise<T> {
  const url = new URL(endpoint, baseUrl);

  if (options?.params) {
    Object.entries(options.params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    });
    delete options.params;
  }

  const response = await fetch(url.toString(), options);

  if (!response.ok) {
    let errorMessage = `API error: ${response.status}`;
    let details: unknown;

    try {
      const data = (await response.json()) as unknown;
      if (data && typeof data === "object" && "error" in data) {
        errorMessage = String((data as Record<string, unknown>).error) || errorMessage;
      }
      details = data;
    } catch {
      // Fail silently, keep default error message
    }

    throw new ApiErrorResponse(errorMessage, response.status, details);
  }

  return (await response.json()) as T;
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Fetch stations within a radius with optional filters
 */
export async function fetchStations(params: {
  lat: number;
  lng: number;
  radius?: number;
  type?: string;
  is_free?: boolean;
  geojson?: boolean;
}): Promise<StationsGeoJSON> {
  return apiFetch<StationsGeoJSON>("/api/stations", {
    params: {
      lat: params.lat,
      lng: params.lng,
      ...(params.radius && { radius: params.radius }),
      ...(params.type && { type: params.type }),
      ...(params.is_free !== undefined && { is_free: params.is_free }),
      geojson: params.geojson ?? true,
    },
  });
}

/**
 * Fetch single station detail by ID
 */
export async function fetchStationById(id: string): Promise<StationDetail> {
  return apiFetch<StationDetail>(`/api/stations/${id}`);
}

/**
 * Geocode an address string to coordinates
 */
export async function geocodeSearch(query: string): Promise<GeocodeResult[]> {
  return apiFetch<GeocodeResult[]>("/api/geocode", {
    params: { q: query },
  });
}

/**
 * Submit a new station with photo
 */
export async function submitStation(formData: FormData): Promise<SubmitStationResponse> {
  const response = await fetch(new URL("/api/submit", baseUrl).toString(), {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    let errorMessage = `Submit failed: ${response.status}`;
    let details: unknown;

    try {
      const data = (await response.json()) as unknown;
      if (data && typeof data === "object" && "error" in data) {
        errorMessage = String((data as Record<string, unknown>).error) || errorMessage;
      }
      details = data;
    } catch {
      // Fail silently, keep default error message
    }

    throw new ApiErrorResponse(errorMessage, response.status, details);
  }

  return (await response.json()) as SubmitStationResponse;
}

/**
 * Confirm a station's working status
 */
export async function confirmStation(
  stationId: string,
  isWorking: boolean,
): Promise<ConfirmationResult> {
  return apiFetch<ConfirmationResult>("/api/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ station_id: stationId, is_working: isWorking }),
  });
}

/**
 * Flag a station for moderation (incorrect info, doesn't exist, etc.)
 */
export async function flagStation(body: {
  station_id: string;
  reason: string;
  note?: string;
}): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>("/api/flags", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
