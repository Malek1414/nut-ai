import type { D1Like } from '../d1-adapter.js'
import { ensureSocialSchema } from './schema.js'
import type { SocialNumbers } from './types.js'

export async function socialNumbers(db: D1Like): Promise<SocialNumbers> {
  await ensureSocialSchema(db)
  const one = async (sql: string) => (await db.prepare(sql).first<{ c: number }>())?.c ?? 0
  const all = async <T>(sql: string) => (await db.prepare(sql).all<T>()).results
  const [shareLinks, shareOpens, total, estimated, saved, blocked, signups, installs] = await Promise.all([
    one("SELECT COUNT(*) c FROM events WHERE type='share_link' AND team=0"),
    one("SELECT COUNT(*) c FROM events WHERE type='share_open' AND team=0"),
    one("SELECT COUNT(*) c FROM events WHERE type='import' AND team=0"),
    one("SELECT COUNT(*) c FROM events WHERE type='import' AND team=0 AND json_extract(props,'$.status')='ok'"),
    one("SELECT COUNT(*) c FROM events WHERE type='import_save' AND team=0"),
    one("SELECT COUNT(*) c FROM events WHERE type='import' AND team=0 AND json_extract(props,'$.status')='blocked'"),
    one('SELECT COUNT(*) c FROM premium_interest WHERE team=0'),
    one("SELECT COUNT(*) c FROM events WHERE type='pwa_install' AND team=0"),
  ])
  const byPlatform = await all<{ v: string | null; c: number }>("SELECT json_extract(props,'$.platform') v, COUNT(*) c FROM events WHERE type='import' AND team=0 GROUP BY v ORDER BY c DESC, v ASC")
  const wants = await all<{ v: string | null; c: number }>('SELECT j.value v, COUNT(*) c FROM premium_interest p, json_each(p.wants) j WHERE p.team=0 GROUP BY j.value ORDER BY c DESC, j.value ASC')
  const sources = await all<{ v: string | null; visitors: number; scanned: number }>(
    `SELECT json_extract(l.props,'$.source') v, COUNT(DISTINCT l.device) visitors,
            COUNT(DISTINCT CASE WHEN EXISTS (SELECT 1 FROM events s WHERE s.type='scan' AND s.device = l.device) THEN l.device END) scanned
     FROM events l WHERE l.type='landing' AND l.team=0 AND l.device IS NOT NULL AND json_extract(l.props,'$.source') IS NOT NULL
     GROUP BY v ORDER BY visitors DESC, v ASC LIMIT 8`,
  )
  return { shareLinks, shareOpens, imports: { total, estimated, saved, blocked, byPlatform }, premium: { signups, wants }, installs, sources }
}

export type { SocialNumbers }
