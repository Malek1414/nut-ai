-- Menu chat and voice messages: per-device limits and the day's speech-to-text budget.
-- One row per counter and window, e.g. "chat|<device>|2026-11-22" or "stt-seconds|*|2026-11-22".
-- The Worker also creates this on first use (src/voice/limits.ts VOICE_SCHEMA).
CREATE TABLE IF NOT EXISTS voice_limits (
  key TEXT PRIMARY KEY,
  n   INTEGER NOT NULL,
  ts  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_voice_limits_ts ON voice_limits(ts);
