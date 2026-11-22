/**
 * How much chat and voice one phone, and the whole app, may use.
 *
 * There are no accounts, so "one phone" is the random device id the app sends.
 * Two kinds of limit, all counted in one small D1 table (fixed windows, one
 * row per window):
 *
 *   per device   a short window and a day, so one phone cannot run up the bill
 *   per day      a ceiling for the whole app (a device id is easy to change)
 */
import type { D1Like } from '../d1-adapter.js'

/** Created on first use (also migrations/0140_voice.sql), like the community tables. */
export const VOICE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS voice_limits (
     key TEXT PRIMARY KEY,
     n   INTEGER NOT NULL,
     ts  INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_voice_limits_ts ON voice_limits(ts)`,
]

export const VOICE_LIMITS = {
  /** Chat messages (typed or spoken) per device. */
  chat: { burst: 20, burstMs: 10 * 60_000, day: 150 },
  /** Chat answers a day across the app: each one is a paid model call. */
  chatCeiling: 2000,
} as const

let ready: Promise<void> | null = null
let readyFor: D1Like | null = null
export function ensureVoiceSchema(db: D1Like): Promise<void> {
  if (readyFor !== db) { ready = null; readyFor = db }
  ready ??= (async () => {
    for (const sql of VOICE_SCHEMA) await db.prepare(sql).run()
  })().catch((e) => { ready = null; throw e })
  return ready
}

/** The UTC day of a moment ("2026-11-21"). */
export const utcDay = (now: number): string => new Date(now).toISOString().slice(0, 10)

/** Add `by` to each counter in one statement and return the new totals, in the order given. */
async function bump(db: D1Like, keys: string[], by: number, now: number): Promise<number[]> {
  const rows = keys.map(() => '(?, ?, ?)').join(', ')
  const args = keys.flatMap((k) => [k, by, now])
  const out = await db
    .prepare(`INSERT INTO voice_limits (key, n, ts) VALUES ${rows} ON CONFLICT(key) DO UPDATE SET n = n + excluded.n RETURNING key, n`)
    .bind(...args)
    .all<{ key: string; n: number }>()
  const byKey = new Map(out.results.map((r) => [r.key, r.n]))
  return keys.map((k) => byKey.get(k) ?? by)
}

/** Windows older than two days are of no use; a few requests in a hundred tidy up. */
async function tidy(db: D1Like, now: number): Promise<void> {
  if (Math.random() > 0.03) return
  try { await db.prepare('DELETE FROM voice_limits WHERE ts < ?').bind(now - 2 * 86_400_000).run() } catch { /* never in the way of an answer */ }
}

export type Allowance = { ok: true } | { ok: false; why: 'device' | 'ceiling' }

/**
 * Count one chat message for this device and say whether it
 * may go ahead. Counting comes first, so a phone that keeps asking stays over
 * its limit until the window ends.
 */
export async function allow(db: D1Like, device: string, now = Date.now(), ceiling: number = VOICE_LIMITS.chatCeiling): Promise<Allowance> {
  await ensureVoiceSchema(db)
  const rule = VOICE_LIMITS.chat
  const day = utcDay(now)
  const keys = [`chat|${device}|b${Math.floor(now / rule.burstMs)}`, `chat|${device}|${day}`]
  keys.push(`chat|*|${day}`)
  const [burst = 0, daily = 0, all = 0] = await bump(db, keys, 1, now)
  await tidy(db, now)
  if (burst > rule.burst || daily > rule.day) return { ok: false, why: 'device' }
  if (all > ceiling) return { ok: false, why: 'ceiling' }
  return { ok: true }
}
