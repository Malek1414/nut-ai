-- Eating together: groups (friends plan a meal out) and tables (one scanned menu, a pick per person).
-- The Worker also creates these on first use (src/group/api.ts GROUP_SCHEMA), so a fresh local D1 needs no migration step.
CREATE TABLE IF NOT EXISTS grp_groups (
  id         TEXT PRIMARY KEY,           -- the link code
  kind       TEXT NOT NULL,              -- 'group' | 'table'
  name       TEXT NOT NULL,
  lat        REAL,
  lng        REAL,
  device     TEXT,                       -- the phone that opened it
  team       INTEGER NOT NULL DEFAULT 0,
  ts         INTEGER NOT NULL,
  updated    INTEGER NOT NULL,           -- moves forward on every change (polling)
  restaurant TEXT,
  scan_id    TEXT,
  menu       TEXT                        -- JSON: the dishes of one scanned menu (table mode)
);
CREATE TABLE IF NOT EXISTS grp_members (
  id       TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  name     TEXT NOT NULL,                -- a first name
  device   TEXT,                         -- the phone that added this person
  needs    TEXT NOT NULL,                -- JSON: diet, allergies, goal, budget
  lat      REAL,
  lng      REAL,
  ts       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_grp_members_group ON grp_members(group_id);
CREATE TABLE IF NOT EXISTS grp_votes (
  group_id  TEXT NOT NULL,
  member_id TEXT NOT NULL,
  place_id  TEXT NOT NULL,
  ts        INTEGER NOT NULL,
  PRIMARY KEY (group_id, member_id)
);
