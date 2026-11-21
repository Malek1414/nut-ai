-- Typed meals ("What did you eat today?"): what the reading model made of a text, kept so the
-- same text is not sent to the model twice. One row per typed text and language; no device id.
--   key   SHA-256 of version | language | folded text
--   read  the model's dishes as JSON: names and components, never a calorie figure
-- The Worker also creates this table on first use (src/me/estimate.ts, ME_READS_SQL).
CREATE TABLE IF NOT EXISTS me_reads (
  key  TEXT PRIMARY KEY,
  lang TEXT NOT NULL,
  read TEXT NOT NULL,
  ts   INTEGER NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0
);
