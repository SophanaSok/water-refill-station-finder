CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  display_name TEXT,
  role TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin', 'business')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT CHECK (type IN ('fountain', 'bottle_filler', 'store_refill', 'tap')),
  location GEOGRAPHY(POINT, 4326) NOT NULL,
  address TEXT,
  city TEXT,
  state CHAR(2),
  zip TEXT,
  is_free BOOLEAN DEFAULT true,
  cost_description TEXT,
  is_verified BOOLEAN DEFAULT false,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  source TEXT DEFAULT 'crowdsource' CHECK (source IN ('osm', 'crowdsource', 'partner')),
  osm_id BIGINT UNIQUE,
  photo_url TEXT,
  added_by UUID REFERENCES users(id) ON DELETE SET NULL,
  owner_id UUID,
  is_featured BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS saved_stations (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  station_id UUID REFERENCES stations(id) ON DELETE CASCADE,
  saved_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, station_id)
);

CREATE TABLE IF NOT EXISTS confirmations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id UUID REFERENCES stations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ip_hash TEXT,
  is_working BOOLEAN NOT NULL,
  confirmed_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id UUID REFERENCES stations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT CHECK (reason IN ('doesnt_exist', 'wrong_location', 'not_safe', 'duplicate', 'other')),
  note TEXT,
  resolved BOOLEAN DEFAULT false,
  flagged_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stations_location_gist
  ON stations USING GIST (location);

CREATE INDEX IF NOT EXISTS idx_stations_status
  ON stations USING btree (status);

CREATE INDEX IF NOT EXISTS idx_stations_source
  ON stations USING btree (source);

CREATE INDEX IF NOT EXISTS idx_confirmations_station_id
  ON confirmations USING btree (station_id);

CREATE INDEX IF NOT EXISTS idx_flags_station_id_unresolved
  ON flags USING btree (station_id)
  WHERE resolved = false;

CREATE OR REPLACE FUNCTION set_stations_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stations_set_updated_at ON stations;

CREATE TRIGGER trg_stations_set_updated_at
BEFORE UPDATE ON stations
FOR EACH ROW
EXECUTE FUNCTION set_stations_updated_at();