-- Sharing, link imports and the Premium list. Generated from src/social/schema.ts (kept equal by a test).
CREATE TABLE IF NOT EXISTS shares (
  id      TEXT PRIMARY KEY,
  ts      INTEGER NOT NULL,
  device  TEXT,
  team    INTEGER NOT NULL DEFAULT 0,
  kind    TEXT NOT NULL,
  title   TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload TEXT NOT NULL,
  image   TEXT
);
CREATE TABLE IF NOT EXISTS import_cache (
  key      TEXT PRIMARY KEY,
  ts       INTEGER NOT NULL,
  platform TEXT NOT NULL,
  meta     TEXT,
  read     TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS premium_interest (
  id      TEXT PRIMARY KEY,
  ts      INTEGER NOT NULL,
  device  TEXT,
  team    INTEGER NOT NULL DEFAULT 0,
  email   TEXT NOT NULL,
  name    TEXT,
  wants   TEXT NOT NULL DEFAULT '[]',
  note    TEXT,
  consent TEXT NOT NULL,
  source  TEXT,
  lang    TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_premium_email ON premium_interest(email);
CREATE INDEX IF NOT EXISTS idx_premium_device ON premium_interest(device);
