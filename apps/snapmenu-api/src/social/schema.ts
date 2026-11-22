import type { D1Like } from '../d1-adapter.js'

/**
 * The tables of sharing, link imports and the Premium list. The same
 * statements are in migrations/0130_social.sql (a test keeps the two equal);
 * they also run on first use, like the community tables, so a fresh local D1
 * works without a migration step.
 */
export const SOCIAL_SCHEMA = [
  // One row per shared link. `payload` is the snapshot the link opens to; `image` is its preview picture (a data URL).
  `CREATE TABLE IF NOT EXISTS shares (
  id      TEXT PRIMARY KEY,
  ts      INTEGER NOT NULL,
  device  TEXT,
  team    INTEGER NOT NULL DEFAULT 0,
  kind    TEXT NOT NULL,
  title   TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload TEXT NOT NULL,
  image   TEXT
)`,
  // What a link's public preview said and what the model read from it, per link and language, so a popular link is read once.
  `CREATE TABLE IF NOT EXISTS import_cache (
  key      TEXT PRIMARY KEY,
  ts       INTEGER NOT NULL,
  platform TEXT NOT NULL,
  meta     TEXT,
  read     TEXT NOT NULL
)`,
  // People who asked to hear about Premium first. `consent` is the exact sentence they agreed to.
  `CREATE TABLE IF NOT EXISTS premium_interest (
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
)`,
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_premium_email ON premium_interest(email)',
  'CREATE INDEX IF NOT EXISTS idx_premium_device ON premium_interest(device)',
] as const

/** The events table of migration 0001, for a database that never ran it (tests, a fresh local D1). Not part of this feature's migration. */
const EVENTS_TABLE = `CREATE TABLE IF NOT EXISTS events (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  ts     INTEGER NOT NULL,
  type   TEXT NOT NULL,
  device TEXT,
  team   INTEGER NOT NULL DEFAULT 0,
  props  TEXT
)`

/** The statements as one migration file. */
export const socialMigrationSql = (): string =>
  `-- Sharing, link imports and the Premium list. Generated from src/social/schema.ts (kept equal by a test).\n${SOCIAL_SCHEMA.map((s) => `${s};`).join('\n')}\n`

let ready: Promise<void> | null = null
let readyFor: D1Like | null = null

export function ensureSocialSchema(db: D1Like): Promise<void> {
  if (readyFor !== db) { ready = null; readyFor = db }
  ready ??= (async () => {
    for (const sql of [...SOCIAL_SCHEMA, EVENTS_TABLE]) await db.prepare(sql).run()
  })().catch((e) => { ready = null; throw e })
  return ready
}

/** An analytics row. Never breaks the request it belongs to. */
export async function logSocial(db: D1Like, type: string, device: string | null, team: boolean, props: Record<string, unknown>): Promise<void> {
  try {
    await db.prepare('INSERT INTO events (ts, type, device, team, props) VALUES (?, ?, ?, ?, ?)')
      .bind(Date.now(), type.slice(0, 40), device?.slice(0, 64) ?? null, team ? 1 : 0, JSON.stringify(props).slice(0, 2000))
      .run()
  } catch {
    // Analytics must never break a share or an import.
  }
}

/** How many events of one kind a device logged since `since`. The base of every rate limit here. */
export async function recentCount(db: D1Like, type: string, device: string | null, since: number): Promise<number> {
  if (!device) return 0
  const row = await db.prepare('SELECT COUNT(*) c FROM events WHERE type = ? AND device = ? AND ts > ?').bind(type, device, since).first<{ c: number }>()
  return row?.c ?? 0
}

export const SOCIAL_LIMITS = {
  share: { max: 20, windowMs: 10 * 60_000 },
  import: { max: 12, windowMs: 10 * 60_000 },
  premium: { max: 5, windowMs: 60 * 60_000 },
} as const

export type Out<T> = { ok: true; data: T } | { ok: false; status: number; code: string; message: string }
export const bad = (status: number, code: string, message: string): Out<never> => ({ ok: false, status, code, message })
