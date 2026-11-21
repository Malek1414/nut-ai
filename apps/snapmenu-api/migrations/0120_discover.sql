-- Discover: seed-oil reports, what restaurant websites say, the geocoding and element caches and the request throttle.
-- The Worker also creates these on first use (src/discover/schema.ts), so this file is for a manual setup.
CREATE TABLE IF NOT EXISTS seed_oil_reports (
  place_id   TEXT NOT NULL,
  device     TEXT NOT NULL,
  value      INTEGER NOT NULL,
  source_url TEXT,
  lat        REAL NOT NULL,
  lng        REAL NOT NULL,
  ts         INTEGER NOT NULL,
  team       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (place_id, device)
);
CREATE INDEX IF NOT EXISTS idx_sor_geo ON seed_oil_reports(lat, lng);

CREATE TABLE IF NOT EXISTS seed_oil_web (
  place_id TEXT PRIMARY KEY,
  url      TEXT NOT NULL,
  ts       INTEGER NOT NULL,
  ok       INTEGER NOT NULL DEFAULT 1,
  claim    TEXT,
  quote    TEXT,
  lat      REAL NOT NULL,
  lng      REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sow_geo ON seed_oil_web(lat, lng);

CREATE TABLE IF NOT EXISTS geocode_cache (
  key  TEXT PRIMARY KEY,
  ts   INTEGER NOT NULL,
  body TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS osm_element_cache (
  id   TEXT PRIMARY KEY,
  ts   INTEGER NOT NULL,
  body TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS discover_throttle (
  name TEXT PRIMARY KEY,
  ts   INTEGER NOT NULL
);
