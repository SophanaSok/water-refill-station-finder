import { neon } from "@neondatabase/serverless";
import { env } from "../env.js";

export const sql = neon(env.DATABASE_URL);

export type StationType = "fountain" | "bottle_filler" | "store_refill" | "tap";
export type StationStatus = "pending" | "approved" | "rejected";
export type StationSource = "osm" | "crowdsource" | "partner";
export type UserRole = "user" | "admin" | "business";
export type FlagReason = "doesnt_exist" | "wrong_location" | "not_safe" | "duplicate" | "other";

export interface Station {
  id: string;
  name: string;
  type: StationType | null;
  location: string;
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
}

export interface User {
  id: string;
  email: string;
  display_name: string | null;
  role: UserRole | null;
  created_at: string | null;
}

export interface SavedStation {
  user_id: string;
  station_id: string;
  saved_at: string | null;
}

export interface Confirmation {
  id: string;
  station_id: string | null;
  user_id: string | null;
  ip_hash: string | null;
  is_working: boolean;
  confirmed_at: string | null;
}

export interface Flag {
  id: string;
  station_id: string | null;
  user_id: string | null;
  reason: FlagReason | null;
  note: string | null;
  resolved: boolean | null;
  flagged_at: string | null;
}

export interface StationSubmission {
  id: string;
  station_id: string;
  submitter_email: string;
  submitted_at: string | null;
}

export interface StationModerationNote {
  id: string;
  station_id: string;
  status: "approved" | "rejected";
  note: string;
  created_at: string | null;
}