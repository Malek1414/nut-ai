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
import type { PlaceDetails } from './osm-tags.js'
import { checkWebsite, seedOilFor, seedOilView, websiteDue } from './seed-oil.js'
import type { DetailsResponse } from './types.js'

export type { DetailsResponse }

/** A cached copy of a restaurant: one that has opening hours first, then one with the detail tags, then the newest. */
export async function findPlace(db: D1Like, id: string, at: { lat: number; lng: number } | null): Promise<PlaceDetails | null> {
  const pick = `json_each(c.body) j WHERE json_extract(j.value, '$.id') = ? ORDER BY (json_type(j.value, '$.hours') = 'text') DESC, (json_type(j.value, '$.hours') IS NOT NULL) DESC, c.ts DESC LIMIT 1`
  const row = at
    // Every cached area whose box holds this point (boxes reach 0.012° / 0.018° from their centre).
    ? await db.prepare(`SELECT j.value v FROM (SELECT ts, body FROM overpass_cache WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?) c, ${pick}`)
        .bind(at.lat - 0.0125, at.lat + 0.0125, at.lng - 0.0185, at.lng + 0.0185, id).first<{ v: string }>()
    : await db.prepare(`SELECT j.value v FROM (SELECT ts, body FROM overpass_cache ORDER BY ts DESC LIMIT 60) c, ${pick}`).bind(id).first<{ v: string }>()
  if (!row) return null
  try { return JSON.parse(row.v) as PlaceDetails } catch { return null }
}

export const NOMINATIM_LOOKUP_URL = 'https://nominatim.openstreetmap.org/lookup'
const ELEMENT_KEEP_MS = 7 * 24 * 60 * 60_000

interface LookupItem { lat?: string; lon?: string; type?: string; name?: string; address?: Record<string, string>; extratags?: Record<string, string> | null }

/** A Nominatim lookup answer as a map place, through the same parser as the map's lists. */
function elementPlace(id: string, item: LookupItem, at: { lat: number; lng: number }): PlaceDetails | null {
  const a = item.address ?? {}
  const tags: Record<string, string> = { ...(item.extratags ?? {}) }
  const put = (k: string, v: unknown) => { if (typeof v === 'string' && v.trim()) tags[k] = v }
  put('amenity', item.type)
  put('name', item.name)
  put('addr:street', a['road'] ?? a['pedestrian'])
  put('addr:housenumber', a['house_number'])
  put('addr:postcode', a['postcode'])
  put('addr:city', a['city'] ?? a['town'] ?? a['village'])
  const lat = Number(item.lat), lon = Number(item.lon)
  const el = {
    type: id[0] === 'w' ? 'way' : id[0] === 'r' ? 'relation' : 'node', id: Number(id.slice(1)), tags,
    ...(Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : { center: { lat: at.lat, lon: at.lng } }),
  }
  return (parseOverpass({ elements: [el] })[0] ?? null) as PlaceDetails | null
}

/**
 * One restaurant's own tags from Nominatim's lookup, for a restaurant whose cached list copy has no hours:
 * cached before this feature, found by name far from any cached area, or read from an Overpass server that
 * lags behind. Same rules as every Nominatim request here (geocode.ts): one request a second for the whole
 * app, a generic User-Agent, and the answer kept in D1 (a week), so a restaurant is asked once. It only
 * happens when a person opens that restaurant: a lookup, never a crawl.
 */
export async function loadElement(db: D1Like, id: string, at: { lat: number; lng: number }, allowFetch: boolean, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<PlaceDetails | null> {
  const row = await db.prepare('SELECT ts, body FROM osm_element_cache WHERE id = ?').bind(id).first<{ ts: number; body: string }>()
  const cached = row ? (JSON.parse(row.body) as PlaceDetails | null) : null
  if (row && (now - row.ts < ELEMENT_KEEP_MS || !allowFetch)) return cached
  if (!allowFetch || !(await claimSlot(db, 'nominatim', now))) return cached
  try {
    const url = `${NOMINATIM_LOOKUP_URL}?osm_ids=${id[0]!.toUpperCase()}${id.slice(1)}&format=jsonv2&extratags=1&addressdetails=1`
    const res = await fetchImpl(url, { headers: { 'user-agent': GEOCODE_USER_AGENT, accept: 'application/json' }, signal: AbortSignal.timeout(6000) })
    if (!res.ok) return cached
    const items = (await res.json()) as LookupItem[]
    // An empty answer: the restaurant is gone from OpenStreetMap. That is remembered too.
    const place = Array.isArray(items) && items[0] ? elementPlace(id, items[0], at) : null
    await db.prepare('INSERT OR REPLACE INTO osm_element_cache (id, ts, body) VALUES (?, ?, ?)').bind(id, now, JSON.stringify(place)).run()
    await db.prepare('DELETE FROM osm_element_cache WHERE ts < ?').bind(now - 4 * ELEMENT_KEEP_MS).run()
    return place
  } catch {
    return cached
  }
}

/** What a lookup knows fills the gaps of a list copy; a list value is never replaced by nothing. */
export function withKnown(base: PlaceDetails | null, extra: PlaceDetails | null): PlaceDetails | null {
  if (!base || !extra) return base ?? extra
  return { ...base, ...(Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== null && v !== undefined)) as Partial<PlaceDetails>) }
}

export interface DetailsDeps { fetchImpl?: typeof fetch; waitUntil?: (p: Promise<unknown>) => void }

export async function placeDetails(db: D1Like, url: URL, v: Viewer, deps: DetailsDeps = {}): Promise<DetailsResponse | null> {
  const id = url.searchParams.get('id') ?? ''
  if (!PLACE_ID.test(id)) return null
  const lat = num(url.searchParams.get('lat'), -85, 85)
  const lng = num(url.searchParams.get('lng'), -180, 180)
  const at = lat !== null && lng !== null ? { lat, lng } : null

  let place = await findPlace(db, id, at)
  // No hours in the list copy (not cached here, cached before the details were read, or a lagging server): ask for this one restaurant.
  if (at && !place?.hours) place = withKnown(place, await loadElement(db, id, at, url.searchParams.get('load') === '1', deps.fetchImpl))

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
