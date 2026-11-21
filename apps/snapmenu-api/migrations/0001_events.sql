CREATE TABLE IF NOT EXISTS events (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  ts     INTEGER NOT NULL,
  type   TEXT NOT NULL,
  device TEXT,
  team   INTEGER NOT NULL DEFAULT 0,
  props  TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type, team);
