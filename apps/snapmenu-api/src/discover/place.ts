/**
 * One restaurant in full: what OpenStreetMap says (address, opening hours, website, phone), the dishes the
 * community scanned there, the delivery votes and the seed-oil status. "Open now" is worked out on the phone
 * from the hours (opening-hours.ts), because the phone knows the local time.
 */
import type { D1Like } from '../d1-adapter.js'
import { parseOverpass } from '../overpass.js'
import { handlePlace, OSM_ATTRIBUTION } from '../places.js'
import { claimSlot, GEOCODE_USER_AGENT } from './geocode.js'
import { PLACE_ID, num, type Viewer } from './http.js'
import { hasDetails, type PlaceDetails } from './osm-tags.js'
import { checkWebsite, seedOilFor, seedOilView, websiteDue } from './seed-oil.js'
import type { DetailsResponse } from './types.js'

export type { DetailsResponse }

/** The newest cached copy of a restaurant, preferring one that carries the detail tags. */
export async function findPlace(db: D1Like, id: string, at: { lat: number; lng: number } | null): Promise<PlaceDetails | null> {
  const pick = `json_each(c.body) j WHERE json_extract(j.value, '$.id') = ? ORDER BY (json_type(j.value, '$.hours') IS NOT NULL) DESC, c.ts DESC LIMIT 1`
  const row = at
    // Every cached area whose box holds this point (boxes reach 0.012° / 0.018° from their centre).
    ? await db.prepare(`SELECT j.value v FROM (SELECT ts, body FROM overpass_cache WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?) c, ${pick}`)
        .bind(at.lat - 0.0125, at.lat + 0.0125, at.lng - 0.0185, at.lng + 0.0185, id).first<{ v: string }>()
    : await db.prepare(`SELECT j.value v FROM (SELECT ts, body FROM overpass_cache ORDER BY ts DESC LIMIT 60) c, ${pick}`).bind(id).first<{ v: string }>()
  if (!row) return null
  try { return JSON.parse(row.v) as PlaceDetails } catch { return null }
}

export const OSM_ELEMENT_URL = 'https://www.openstreetmap.org/api/0.6'
const ELEMENT_KEEP_MS = 7 * 24 * 60 * 60_000

/**
 * One restaurant's own tags from the OpenStreetMap API, for a restaurant whose cached list copy has no
 * details yet (cached before this feature, or found by name far from any cached area). The map's lists
 * come from Overpass, which is often busy; a single element from the main API answers in a blink.
 * Kept a week in D1, one request a second at most for the whole app, and only when a person opens the
 * restaurant: this is a lookup, never a crawl. Ways come without a position, so the caller's is used.
 */
export async function loadElement(db: D1Like, id: string, at: { lat: number; lng: number }, allowFetch: boolean, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<PlaceDetails | null> {
  const row = await db.prepare('SELECT ts, body FROM osm_element_cache WHERE id = ?').bind(id).first<{ ts: number; body: string }>()
  const cached = row ? (JSON.parse(row.body) as PlaceDetails | null) : null
  if (row && (now - row.ts < ELEMENT_KEEP_MS || !allowFetch)) return cached
  if (!allowFetch || !(await claimSlot(db, 'osm-api', now))) return cached
  try {
    const kind = id[0] === 'w' ? 'way' : id[0] === 'r' ? 'relation' : 'node'
    const res = await fetchImpl(`${OSM_ELEMENT_URL}/${kind}/${id.slice(1)}.json`, { headers: { 'user-agent': GEOCODE_USER_AGENT, accept: 'application/json' }, signal: AbortSignal.timeout(6000) })
    if (!res.ok && res.status !== 404 && res.status !== 410) return cached
    const elements = res.ok ? ((await res.json()) as { elements?: Array<Record<string, unknown>> }).elements ?? [] : []
    const place = (parseOverpass({ elements: elements.map((e) => (typeof e['lat'] === 'number' ? e : { ...e, center: { lat: at.lat, lon: at.lng } })) })[0] ?? null) as PlaceDetails | null
    await db.prepare('INSERT OR REPLACE INTO osm_element_cache (id, ts, body) VALUES (?, ?, ?)').bind(id, now, JSON.stringify(place)).run()
    await db.prepare('DELETE FROM osm_element_cache WHERE ts < ?').bind(now - 4 * ELEMENT_KEEP_MS).run()
    return place
  } catch {
    return cached
  }
}

export interface DetailsDeps { fetchImpl?: typeof fetch; waitUntil?: (p: Promise<unknown>) => void }

export async function placeDetails(db: D1Like, url: URL, v: Viewer, deps: DetailsDeps = {}): Promise<DetailsResponse | null> {
  const id = url.searchParams.get('id') ?? ''
  if (!PLACE_ID.test(id)) return null
  const lat = num(url.searchParams.get('lat'), -85, 85)
  const lng = num(url.searchParams.get('lng'), -180, 180)
  const at = lat !== null && lng !== null ? { lat, lng } : null

  let place = await findPlace(db, id, at)
  // Not in a cached list (a search hit from elsewhere), or cached before the details were read: ask for this one restaurant.
  if (at && (!place || !hasDetails(place))) {
    place = (await loadElement(db, id, at, url.searchParams.get('load') === '1', deps.fetchImpl)) ?? place
  }

  const scans = await handlePlace(url, db, v.device)
  let webPending = false
  const where = place ?? (at ? { id, ...at, website: null } : null)
  if (place?.website && where && (await websiteDue(db, id))) {
    const check = checkWebsite(db, { id, lat: where.lat, lng: where.lng, website: place.website }, deps.fetchImpl)
    if (deps.waitUntil) { deps.waitUntil(check.catch(() => null)); webPending = true } else await check.catch(() => null)
  }
  const seedOil = (await seedOilFor(db, [id], v.device, true)).get(id) ?? seedOilView({})
  return { place, dishes: scans?.dishes ?? [], votes: scans?.votes ?? { yes: 0, no: 0, myVote: 0 }, seedOil, webPending, attribution: OSM_ATTRIBUTION }
}
