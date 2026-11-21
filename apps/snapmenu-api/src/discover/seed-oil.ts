/**
 * "Reported seed-oil free": a filter that never claims more than it knows.
 *
 * Two sources, both named on screen:
 *   - community reports: one tap per device and restaurant ("seed-oil free? yes / no"), with an optional link;
 *   - the restaurant's own website, where we fetched it: one polite request for the home page, kept 14 days.
 *
 * Three states, never a fact of our own:
 *   verified  the restaurant's own website says so (and the community does not say otherwise);
 *   reported  more people reported it than disagreed;
 *   unknown   everything else, with the reason.
 */
import type { D1Like } from '../d1-adapter.js'
import { say } from '../voice/index.js'
import { PLACE_ID, num, type Viewer } from './http.js'
import { webUrl } from './osm-tags.js'
import { findSeedOilMention, htmlToText } from './seed-oil-text.js'
import type { SeedOilStatus, SeedOilView, SeedOilWeb } from './types.js'

export type { SeedOilStatus, SeedOilView, SeedOilWeb }

/** The filter, and the badge for community reports. */
export const SEED_OIL_LABEL = 'Reported seed-oil free'
/** The badge when the restaurant's own website says so. Still not our claim: it names who says it. */
export const SEED_OIL_WEB_LABEL = 'Website says seed-oil free'
const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`

/** The status from the reports and the website. Pure. */
export function seedOilView(input: { yes?: number; no?: number; myReport?: -1 | 0 | 1; links?: string[]; web?: SeedOilWeb | null }): SeedOilView {
  const yes = Math.max(0, Math.floor(input.yes ?? 0))
  const no = Math.max(0, Math.floor(input.no ?? 0))
  const web = input.web ?? null
  const base = { yes, no, myReport: input.myReport ?? 0, links: (input.links ?? []).slice(0, 3), web }
  const net = yes - no
  if (web?.claim === 'free' && net >= 0) {
    return { ...base, status: 'verified', label: SEED_OIL_WEB_LABEL, source: `Its own website says so${yes ? `, and ${people(yes)} reported it` : ''}.` }
  }
  if (net >= 1 && web?.claim !== 'uses') {
    return { ...base, status: 'reported', label: SEED_OIL_LABEL, source: `${people(yes)} reported it${no ? `, ${no} disagreed` : ''}. Not verified.` }
  }
  const source =
    web?.claim === 'uses' ? 'Its own website mentions cooking with seed oil.'
    : web?.claim === 'free' ? 'Its website says seed-oil free, but more people disagree.'
    : yes > 0 && no > 0 ? `Reports disagree: ${yes} yes, ${no} no.`
    : no > 0 ? `${people(no)} reported seed oils here.`
    : web ? 'No reports yet. Its website does not mention it.'
    : 'No reports yet.'
  return { ...base, status: 'unknown', label: '', source }
}

export { reportedSeedOilFree } from './confidence.js'

/** A link from a report: http(s), a real host, no credentials, not too long. */
export function sourceLink(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim().length > 300) return null
  return webUrl(raw.trim())
}

interface ReportRow { place_id: string; yes: number | null; no: number | null; mine: number | null }
interface WebRow { place_id: string; url: string; ts: number; ok: number; claim: string | null; quote: string | null }

const webOf = (r: WebRow | undefined): SeedOilWeb | null =>
  r && r.ok === 1 ? { url: r.url, claim: r.claim === 'free' || r.claim === 'uses' ? r.claim : null, quote: r.quote, checkedAt: r.ts } : null

/** The seed-oil status of some restaurants in one go. Places nobody reported are left out unless `all`. */
export async function seedOilFor(db: D1Like, ids: string[], device: string | null, all = false): Promise<Map<string, SeedOilView>> {
  const out = new Map<string, SeedOilView>()
  const wanted = [...new Set(ids.filter((id) => PLACE_ID.test(id)))].slice(0, 80)
  if (wanted.length === 0) return out
  const marks = wanted.map(() => '?').join(',')
  const reports = (await db.prepare(`SELECT place_id, SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END) yes, SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END) no,
      SUM(CASE WHEN device = ? THEN value ELSE 0 END) mine FROM seed_oil_reports WHERE place_id IN (${marks}) GROUP BY place_id`)
    .bind(device ?? '', ...wanted).all<ReportRow>()).results
  const links = (await db.prepare(`SELECT place_id, source_url FROM seed_oil_reports WHERE place_id IN (${marks}) AND source_url IS NOT NULL AND value = 1 ORDER BY ts DESC LIMIT 200`)
    .bind(...wanted).all<{ place_id: string; source_url: string }>()).results
  const webs = (await db.prepare(`SELECT place_id, url, ts, ok, claim, quote FROM seed_oil_web WHERE place_id IN (${marks})`).bind(...wanted).all<WebRow>()).results
  const byId = new Map(reports.map((r) => [r.place_id, r]))
  const webById = new Map(webs.map((w) => [w.place_id, w]))
  for (const id of wanted) {
    const r = byId.get(id)
    const web = webOf(webById.get(id))
    if (!all && !r && !web) continue
    const mine = r?.mine ?? 0
    out.set(id, seedOilView({
      yes: r?.yes ?? 0, no: r?.no ?? 0, myReport: mine === 1 ? 1 : mine === -1 ? -1 : 0, web,
      links: [...new Set(links.filter((l) => l.place_id === id).map((l) => l.source_url))],
    }))
  }
  return out
}

/** Every restaurant in a box that has a report or a website statement, for the "seed-oil free" filter of a list. */
export async function seedOilInBox(db: D1Like, box: { south: number; west: number; north: number; east: number }, device: string | null): Promise<Record<string, SeedOilView>> {
  const args = [box.south, box.north, box.west, box.east]
  const a = (await db.prepare('SELECT DISTINCT place_id FROM seed_oil_reports WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ? LIMIT 80').bind(...args).all<{ place_id: string }>()).results
  const b = (await db.prepare('SELECT place_id FROM seed_oil_web WHERE ok = 1 AND claim IS NOT NULL AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ? LIMIT 80').bind(...args).all<{ place_id: string }>()).results
  return Object.fromEntries(await seedOilFor(db, [...a, ...b].map((r) => r.place_id), device))
}

export const SEED_OIL_REPORT_LIMIT = { max: 30, windowMs: 10 * 60_000 } as const

export type ReportResult = { ok: true; data: SeedOilView } | { ok: false; status: number; code: string; message: string }

/**
 * One device, one report per restaurant: 1 = "seed-oil free", -1 = "uses seed oils", 0 takes it back.
 * `sourceUrl` is optional: where the person read it (a menu page, a post by the restaurant).
 */
export async function reportSeedOil(db: D1Like, body: Record<string, unknown>, v: Viewer): Promise<ReportResult> {
  if (!v.device) return { ok: false, status: 400, code: 'no_device', message: 'Missing device id.' }
  const placeId = typeof body['placeId'] === 'string' ? body['placeId'] : ''
  const value = body['value']
  const lat = num(body['lat'], -85, 85)
  const lng = num(body['lng'], -180, 180)
  if (!PLACE_ID.test(placeId) || (value !== 1 && value !== -1 && value !== 0) || lat === null || lng === null) {
    return { ok: false, status: 400, code: 'bad_report', message: say(v.lang, 'community.failed') }
  }
  const raw = body['sourceUrl']
  const link = raw === undefined || raw === null || raw === '' ? null : sourceLink(raw)
  if (raw && !link) return { ok: false, status: 400, code: 'bad_link', message: 'That link does not look right. Paste a full web address.' }
  const n = await db.prepare('SELECT COUNT(*) c FROM seed_oil_reports WHERE device = ? AND ts > ?').bind(v.device, Date.now() - SEED_OIL_REPORT_LIMIT.windowMs).first<{ c: number }>()
  if ((n?.c ?? 0) >= SEED_OIL_REPORT_LIMIT.max) return { ok: false, status: 429, code: 'rate_limited', message: say(v.lang, 'community.slow_answers') }
  if (value === 0) await db.prepare('DELETE FROM seed_oil_reports WHERE place_id = ? AND device = ?').bind(placeId, v.device).run()
  else {
    await db.prepare('INSERT OR REPLACE INTO seed_oil_reports (place_id, device, value, source_url, lat, lng, ts, team) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(placeId, v.device.slice(0, 64), value, value === 1 ? link : null, +lat.toFixed(6), +lng.toFixed(6), Date.now(), v.team ? 1 : 0).run()
  }
  const view = (await seedOilFor(db, [placeId], v.device, true)).get(placeId)!
  return { ok: true, data: view }
}

// ---------- The restaurant's own website ----------

export const WEB_KEEP_MS = 14 * 24 * 60 * 60_000
const WEB_RETRY_MS = 24 * 60 * 60_000
const WEB_MAX_BYTES = 400_000
export const WEB_USER_AGENT = 'open-menu-helper/0.1 (open-source restaurant finder)'

/** Only public web hosts: a name with a dot, never an address literal or a local name. */
export function publicUrl(raw: string | null | undefined): URL | null {
  const clean = webUrl(raw)
  if (!clean) return null
  const u = new URL(clean)
  const host = u.hostname.toLowerCase()
  if (u.port && u.port !== '80' && u.port !== '443') return null
  if (/^[\d.]+$/.test(host) || host.includes(':') || host.startsWith('[')) return null
  if (host === 'localhost' || /\.(local|localhost|internal|lan|home|test|invalid)$/.test(host)) return null
  return u
}

/** Whether the website of a place is due for a look. */
export async function websiteDue(db: D1Like, placeId: string, now = Date.now()): Promise<boolean> {
  const row = await db.prepare('SELECT ts, ok FROM seed_oil_web WHERE place_id = ?').bind(placeId).first<{ ts: number; ok: number }>()
  return !row || now - row.ts > (row.ok === 1 ? WEB_KEEP_MS : WEB_RETRY_MS)
}

async function readPage(start: URL, fetchImpl: typeof fetch): Promise<string | null> {
  let url = start
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetchImpl(url.toString(), {
      headers: { 'user-agent': WEB_USER_AGENT, accept: 'text/html,application/xhtml+xml' }, redirect: 'manual', signal: AbortSignal.timeout(7000),
    })
    if (res.status >= 300 && res.status < 400) {
      const next = publicUrl(new URL(res.headers.get('location') ?? '', url).toString())
      if (!next) return null
      url = next
      continue
    }
    if (!res.ok || !/html/i.test(res.headers.get('content-type') ?? '')) return null
    // Read at most the first part of the page: a statement like this sits in the visible text near the top.
    const reader = res.body?.getReader()
    if (!reader) return (await res.text()).slice(0, WEB_MAX_BYTES)
    const dec = new TextDecoder()
    let html = ''
    while (html.length < WEB_MAX_BYTES) {
      const { done, value } = await reader.read()
      if (done) break
      html += dec.decode(value, { stream: true })
    }
    void reader.cancel().catch(() => {})
    return html
  }
  return null
}

/**
 * Read a restaurant's home page once and keep what it says about seed oils, with the sentence itself.
 * One request, no crawling. A page we could not read is remembered for a day so it is not asked again.
 */
export async function checkWebsite(db: D1Like, place: { id: string; lat: number; lng: number; website?: string | null }, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<SeedOilWeb | null> {
  const url = publicUrl(place.website)
  if (!url || !PLACE_ID.test(place.id)) return null
  let html: string | null = null
  try { html = await readPage(url, fetchImpl) } catch { html = null }
  let mention: ReturnType<typeof findSeedOilMention> = null
  // A page we cannot make sense of says nothing: it must never break the details of a restaurant.
  try { mention = html === null ? null : findSeedOilMention(htmlToText(html)) } catch { mention = null }
  await db.prepare('INSERT OR REPLACE INTO seed_oil_web (place_id, url, ts, ok, claim, quote, lat, lng) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(place.id, url.toString().slice(0, 300), now, html === null ? 0 : 1, mention?.claim ?? null, mention?.quote ?? null, +place.lat.toFixed(6), +place.lng.toFixed(6)).run()
  return html === null ? null : { url: url.toString(), claim: mention?.claim ?? null, quote: mention?.quote ?? null, checkedAt: now }
}
