/** Small request helpers for the discover routes, the same shapes the main router uses. */
import type { D1Like } from '../d1-adapter.js'
import { userLanguage, type Lang } from '../voice/index.js'

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, x-device, x-team, x-lang',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
}

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
export const fail = (status: number, code: string, message: string) => json({ error: { code, message } }, status)

/** No accounts: the app sends its random device id, the team flag and its language as headers. */
export interface Viewer { device: string | null; team: boolean; lang: Lang }

export function viewerOf(req: Request, url?: URL): Viewer {
  const d = req.headers.get('x-device')
  return {
    device: d && /^[A-Za-z0-9-]{8,64}$/.test(d) ? d : null,
    team: req.headers.get('x-team') === '1',
    lang: userLanguage({ saved: url?.searchParams.get('lang'), locale: req.headers.get('x-lang'), acceptLanguage: req.headers.get('accept-language') }),
  }
}

export const num = (v: unknown, min: number, max: number): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max ? n : null
}

export const PLACE_ID = /^[nwr]\d{1,15}$/

/** Analytics must never break a request. Same table and shape as the main router's events. */
export async function logEvent(db: D1Like, type: string, v: Viewer, props: Record<string, unknown>): Promise<void> {
  try {
    await db.prepare('INSERT INTO events (ts, type, device, team, props) VALUES (?, ?, ?, ?, ?)')
      .bind(Date.now(), type.slice(0, 40), v.device?.slice(0, 64) ?? null, v.team ? 1 : 0, JSON.stringify(props).slice(0, 2000)).run()
  } catch { /* the events table is optional here */ }
}
