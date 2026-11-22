import type { D1Like } from './d1-adapter.js'

/** Reserve attempts atomically, including failures. Spoofed device IDs cannot bypass the shared ceiling. */
export async function takeScan(db: D1Like, device: string, ip: string, ceiling = 100, now = Date.now()): Promise<boolean> {
  await db.prepare('CREATE TABLE IF NOT EXISTS scan_limits (key TEXT PRIMARY KEY, n INTEGER NOT NULL, ts INTEGER NOT NULL)').run()
  const day = new Date(now).toISOString().slice(0, 10)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${day}|${ip}`))
  const hash = Array.from(new Uint8Array(digest)).slice(0, 8).map(x => x.toString(16).padStart(2, '0')).join('')
  const hour = Math.floor(now / 3_600_000)
  const quotas: Array<[string, number]> = [[`all|${day}`, ceiling], [`device|${device}|${hour}`, 12], [`ip|${hash}|${hour}`, 30]]
  // Materialize the guard before any write. One SQLite statement reserves all quotas or none.
  const out = await db.prepare(`WITH quotas(key,lim) AS (VALUES (?,?),(?,?),(?,?)),
    permitted AS MATERIALIZED (SELECT COUNT(*)=0 ok FROM scan_limits s JOIN quotas q ON s.key=q.key WHERE s.n>=q.lim)
    INSERT INTO scan_limits (key,n,ts) SELECT key,1,? FROM quotas WHERE (SELECT ok FROM permitted)
    ON CONFLICT(key) DO UPDATE SET n=n+1`).bind(...quotas.flat(), now).run()
  return out.meta.changes === 3
}
