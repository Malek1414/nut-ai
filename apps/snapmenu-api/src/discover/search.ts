/**
 * Restaurant search by name or by area.
 *
 *   by name  the OpenStreetMap lists the map already cached in D1 (overpass_cache), searched in place with
 *            SQLite's json_each: no extra request to anyone, nothing copied into a second table;
 *   by area  a few Berlin districts we know by heart, then Nominatim (geocode.ts) when the person submits
 *            the search. An area is a point: the app then lists the restaurants around it with /api/places.
 */
import { distanceM } from '../community.js'
import type { D1Like } from '../d1-adapter.js'
import { BERLIN_AREAS } from './areas.js'
import { foldText, geocode, type AreaHit, type GeoDeps } from './geocode.js'
import type { Viewer } from './http.js'
import { hasDetails, type PlaceDetails } from './osm-tags.js'
import { withKnown } from './place.js'
import { seedOilFor } from './seed-oil.js'
import type { SearchPlace, SearchResponse } from './types.js'

export type { SearchPlace, SearchResponse }

export { BERLIN_AREAS }
export const SEARCH_ATTRIBUTION = 'Places and names © OpenStreetMap contributors, ODbL'

// SQLite lowercases ASCII only, so the letters restaurant names use most are folded by hand.
const FOLD_PAIRS: Array<[string, string]> = [
  ['ä', 'a'], ['ö', 'o'], ['ü', 'u'], ['ß', 'ss'], ['é', 'e'], ['è', 'e'], ['ê', 'e'], ['á', 'a'], ['à', 'a'], ['â', 'a'], ['í', 'i'], ['ó', 'o'], ['ô', 'o'],
  ['ú', 'u'], ['ñ', 'n'], ['ç', 'c'], ['ş', 's'], ['ğ', 'g'], ['ı', 'i'], ['Ä', 'a'], ['Ö', 'o'], ['Ü', 'u'], ['É', 'e'], ['Ç', 'c'], ['Ş', 's'], ['İ', 'i'],
]
const foldSql = (expr: string) => FOLD_PAIRS.reduce((e, [from, to]) => `replace(${e}, '${from}', '${to}')`, `lower(${expr})`)
/** D1 refuses a LIKE pattern over 50 bytes, so a very long query is matched by its beginning. */
export const LIKE_MAX_BYTES = 50
const bytes = (s: string) => new TextEncoder().encode(s).length
export function likePattern(s: string): string {
  let body = ''
  for (const ch of s) {
    const next = /[\\%_]/.test(ch) ? `\\${ch}` : ch
    if (bytes(body) + bytes(next) > LIKE_MAX_BYTES - 2) break
    body += next
  }
  return `%${body}%`
}

const NAME_SQL = `SELECT j.value v, c.ts ts
  FROM (SELECT ts, body FROM overpass_cache ORDER BY ((lat - ?) * (lat - ?) + (lng - ?) * (lng - ?) * 0.37) LIMIT 40) c, json_each(c.body) j
  WHERE ${foldSql("json_extract(j.value, '$.name')")} LIKE ? ESCAPE '\\'
     OR lower(json_extract(j.value, '$.name')) LIKE ? ESCAPE '\\'
     OR ${foldSql("COALESCE(json_extract(j.value, '$.cuisine'), '')")} LIKE ? ESCAPE '\\'
  LIMIT 240`

/** How well a name answers the query: 0 starts with it, 1 a word starts with it, 2 contains it, 3 only the cuisine matches. */
export function matchRank(name: string, folded: string): number {
  const n = foldText(name)
  if (n.startsWith(folded)) return 0
  if (n.split(/[^\p{L}\p{N}]+/u).some((w) => w.startsWith(folded))) return 1
  return n.includes(folded) ? 2 : 3
}

/** Restaurants whose name (or cuisine) matches, from the cached lists around `near`: best match first, then nearest. */
export async function searchByName(db: D1Like, q: string, near: { lat: number; lng: number }, limit = 30): Promise<PlaceDetails[]> {
  const folded = foldText(q)
  if (folded.length < 2) return []
  const rows = (await db.prepare(NAME_SQL)
    .bind(near.lat, near.lat, near.lng, near.lng, likePattern(folded), likePattern(q.trim().toLowerCase()), likePattern(folded)).all<{ v: string; ts: number }>()).results
  // Areas overlap, so a restaurant can come back twice: keep the copy with details, else the newest.
  const best = new Map<string, { p: PlaceDetails; ts: number }>()
  for (const row of rows) {
    let p: PlaceDetails
    try { p = JSON.parse(row.v) as PlaceDetails } catch { continue }
    if (!p || typeof p.id !== 'string' || typeof p.name !== 'string') continue
    const prev = best.get(p.id)
    if (!prev || (hasDetails(p) && !hasDetails(prev.p)) || (hasDetails(p) === hasDetails(prev.p) && row.ts > prev.ts)) best.set(p.id, { p, ts: row.ts })
  }
  return [...best.values()]
    .map(({ p }) => ({ p, rank: matchRank(p.name, folded), d: distanceM(near.lat, near.lng, p.lat, p.lng) }))
    .sort((a, b) => a.rank - b.rank || a.d - b.d)
    .slice(0, limit)
    .map((x) => x.p)
}

/** Scan counts and seed-oil status for a list of restaurants. */
export async function decorate(db: D1Like, places: PlaceDetails[], device: string | null): Promise<SearchPlace[]> {
  if (places.length === 0) return []
  const ids = places.map((p) => p.id)
  const scans = (await db.prepare(`SELECT place_id, COUNT(DISTINCT lower(name)) n FROM place_dishes WHERE (seed = 1 OR osm_verified = 1) AND place_id IN (${ids.map(() => '?').join(',')}) GROUP BY place_id`)
    .bind(...ids).all<{ place_id: string; n: number }>()).results
  const scanned = new Map(scans.map((s) => [s.place_id, s.n]))
  const oil = await seedOilFor(db, ids, device)
  // No hours in the list copy: fill in what a details page already looked up for that restaurant.
  const bare = places.filter((p) => !p.hours).map((p) => p.id)
  const known = new Map<string, PlaceDetails>()
  if (bare.length > 0) {
    const rows = (await db.prepare(`SELECT id, body FROM osm_element_cache WHERE id IN (${bare.map(() => '?').join(',')})`).bind(...bare).all<{ id: string; body: string }>()).results
    for (const r of rows) { const p = JSON.parse(r.body) as PlaceDetails | null; if (p) known.set(r.id, p) }
  }
  return places.map((p) => ({ ...withKnown(p, known.get(p.id) ?? null)!, scanned: scanned.get(p.id) ?? 0, seedOil: oil.get(p.id) ?? null }))
}

export const GEO_LIMIT = { max: 20, windowMs: 10 * 60_000 } as const

export async function search(db: D1Like, url: URL, v: Viewer, deps: GeoDeps = {}): Promise<SearchResponse | null> {
  const q = (url.searchParams.get('q') ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)
  const folded = foldText(q)
  if (folded.length < 2) return null
  const lat = Number(url.searchParams.get('lat') ?? 52.5235)
  const lng = Number(url.searchParams.get('lng') ?? 13.404)
  const near = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 85 && Math.abs(lng) <= 180 ? { lat, lng } : { lat: 52.5235, lng: 13.404 }

  const named = await searchByName(db, q, near)
  const local = BERLIN_AREAS.filter((a) => foldText(a.name).includes(folded)).sort((a, b) => Number(foldText(b.name).startsWith(folded)) - Number(foldText(a.name).startsWith(folded)))

  // Nominatim is only asked for a submitted search (never while typing), and a device only so often.
  let allowFetch = url.searchParams.get('geo') === '1'
  if (allowFetch && v.device) {
    const n = await db.prepare("SELECT COUNT(*) c FROM events WHERE type = 'discover_geo' AND device = ? AND ts > ?").bind(v.device, Date.now() - GEO_LIMIT.windowMs).first<{ c: number }>().catch(() => null)
    if ((n?.c ?? 0) >= GEO_LIMIT.max) allowFetch = false
  }
  const geo = await geocode(db, q, near, v.lang, allowFetch, deps)
  const areas = [...local]
  const places = [...named]
  if (geo.ok) {
    for (const a of geo.result.areas) {
      if (!areas.some((x) => foldText(x.name) === foldText(a.name) && distanceM(x.lat, x.lng, a.lat, a.lng) < 3000)) areas.push(a)
    }
    const known = new Set(places.map((p) => p.id))
    for (const p of geo.result.places) if (!known.has(p.id)) places.push(p)
  }
  return {
    q,
    places: await decorate(db, places.slice(0, 30), v.device),
    areas: areas.slice(0, 6),
    geo: geo.ok ? geo.from : geo.reason === 'not_cached' ? 'local' : geo.reason,
    attribution: SEARCH_ATTRIBUTION,
  }
}
