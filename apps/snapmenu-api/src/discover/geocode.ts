/**
 * Place names to positions with Nominatim (https://nominatim.org), the geocoder of OpenStreetMap.
 * Data © OpenStreetMap contributors, ODbL 1.0.
 *
 * Its usage policy (https://operations.osmfoundation.org/policies/nominatim/) is followed to the letter:
 *   - at most one request per second for the whole app: a slot is claimed in D1 before every request,
 *     so two Worker instances never go out in the same second;
 *   - every answer is kept in D1 (30 days; an empty answer for a day), so a name is asked once;
 *   - no autocomplete: the web app only asks when the person submits the search;
 *   - a User-Agent that says what the client is. It is generic on purpose: no person, no contact detail.
 */
import type { D1Like } from '../d1-adapter.js'
import type { Place, PlaceKind } from '../types.js'
import { languageTag } from '../voice/index.js'
import type { AreaHit, GeoResult } from './types.js'

export type { AreaHit, GeoResult }

export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
export const GEOCODE_USER_AGENT = 'open-menu-helper/0.1 (open-source restaurant finder)'
export const MIN_GAP_MS = 1100
const KEEP_MS = 30 * 24 * 60 * 60_000
const KEEP_EMPTY_MS = 24 * 60 * 60_000

/** Lowercase, accents off, one space: how names are compared ("Döner" matches "doner"). */
export const foldText = (s: string): string => s.normalize('NFKD').replace(/\p{M}+/gu, '').replace(/ß/g, 'ss').toLowerCase().replace(/\s+/g, ' ').trim()

const KINDS = new Set<string>(['restaurant', 'fast_food', 'cafe'])
const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

interface NominatimItem {
  osm_type?: string; osm_id?: number; lat?: string; lon?: string; category?: string; type?: string; addresstype?: string
  name?: string; display_name?: string; address?: Record<string, string>
}

/** A Nominatim answer as areas and restaurants. Malformed entries are dropped. */
export function parseNominatim(body: unknown): GeoResult {
  const out: GeoResult = { areas: [], places: [] }
  if (!Array.isArray(body)) return out
  const seen = new Set<string>()
  for (const raw of body as NominatimItem[]) {
    if (!raw || typeof raw !== 'object') continue
    const lat = Number(raw.lat), lng = Number(raw.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 85 || Math.abs(lng) > 180) continue
    const a = raw.address ?? {}
    const name = str(raw.name, 80) ?? str(raw.display_name?.split(',')[0], 80)
    if (!name) continue
    const town = str(a['city'] ?? a['town'] ?? a['village'] ?? a['municipality'] ?? a['county'] ?? a['state'], 60)
    if (raw.category === 'amenity' && KINDS.has(raw.type ?? '') && typeof raw.osm_id === 'number' && /^(node|way|relation)$/.test(raw.osm_type ?? '')) {
      const id = `${raw.osm_type![0]}${raw.osm_id}`
      if (seen.has(id)) continue
      seen.add(id)
      const road = str(a['road'] ?? a['pedestrian'], 80)
      const place: Place = {
        id, name, lat: +lat.toFixed(6), lng: +lng.toFixed(6), kind: raw.type as PlaceKind, cuisine: null,
        address: road ? `${road}${a['house_number'] ? ` ${a['house_number']}` : ''}` : null, vegan: null, vegetarian: null,
        postcode: /^\d{5}$/.test(a['postcode'] ?? '') ? a['postcode']! : null,
      }
      // No detail tags here: the details page loads them with the restaurant's area.
      out.places.push({ ...place, ...(town ? { city: town } : {}) })
      continue
    }
    const label = [town && foldText(town) !== foldText(name) ? town : null, str(a['country'], 40)].filter(Boolean).join(', ')
    const key = `${foldText(name)}|${foldText(label)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.areas.push({ name, label, lat: +lat.toFixed(5), lng: +lng.toFixed(5), kind: str(raw.addresstype ?? raw.type, 30) ?? 'place' })
  }
  out.areas = out.areas.slice(0, 5)
  out.places = out.places.slice(0, 8)
  return out
}

export function geocodeUrl(q: string, near: { lat: number; lng: number }, lang: string): string {
  const p = new URLSearchParams({
    q, format: 'jsonv2', limit: '8', addressdetails: '1', 'accept-language': languageTag(lang) ?? 'en',
    // Prefer results around the viewer, without excluding the rest of the world.
    viewbox: `${(near.lng - 0.7).toFixed(2)},${(near.lat + 0.45).toFixed(2)},${(near.lng + 0.7).toFixed(2)},${(near.lat - 0.45).toFixed(2)}`,
    bounded: '0',
  })
  return `${NOMINATIM_URL}?${p.toString()}`
}

/** Claim the next request slot. False when another request went out less than a second ago, anywhere. */
export async function claimSlot(db: D1Like, name: string, now = Date.now()): Promise<boolean> {
  await db.prepare('INSERT OR IGNORE INTO discover_throttle (name, ts) VALUES (?, 0)').bind(name).run()
  const r = await db.prepare('UPDATE discover_throttle SET ts = ? WHERE name = ? AND ts <= ?').bind(now, name, now - MIN_GAP_MS).run()
  return (r.meta.changes ?? 0) > 0
}

export type GeoOutcome =
  | { ok: true; result: GeoResult; from: 'cache' | 'live' }
  /** not_cached: the name is unknown here and asking Nominatim was not allowed for this request. */
  | { ok: false; reason: 'not_cached' | 'busy' | 'unavailable' }

export interface GeoDeps { fetchImpl?: typeof fetch; now?: () => number; sleep?: (ms: number) => Promise<void> }

const cacheKey = (q: string, near: { lat: number; lng: number }, lang: string) => `v1|${languageTag(lang) ?? 'en'}|${Math.round(near.lat)}:${Math.round(near.lng)}|${foldText(q)}`

// One lookup at a time per Worker instance; the D1 slot keeps instances apart.
let queue: Promise<unknown> = Promise.resolve()

export async function geocode(db: D1Like, q: string, near: { lat: number; lng: number }, lang: string, allowFetch: boolean, deps: GeoDeps = {}): Promise<GeoOutcome> {
  const now = deps.now ?? Date.now
  const key = cacheKey(q, near, lang)
  const read = async (): Promise<GeoResult | null> => {
    const row = await db.prepare('SELECT ts, body FROM geocode_cache WHERE key = ?').bind(key).first<{ ts: number; body: string }>()
    if (!row) return null
    const result = JSON.parse(row.body) as GeoResult
    const empty = result.areas.length === 0 && result.places.length === 0
    return now() - row.ts < (empty ? KEEP_EMPTY_MS : KEEP_MS) ? result : null
  }
  const cached = await read()
  if (cached) return { ok: true, result: cached, from: 'cache' }
  if (!allowFetch) return { ok: false, reason: 'not_cached' }

  const run = queue.then(async (): Promise<GeoOutcome> => {
    // Someone may have asked the same name while this request waited.
    const again = await read()
    if (again) return { ok: true, result: again, from: 'cache' }
    const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
    let claimed = false
    for (let i = 0; i < 5 && !claimed; i++) {
      claimed = await claimSlot(db, 'nominatim', now())
      if (!claimed) await sleep(300)
    }
    if (!claimed) return { ok: false, reason: 'busy' }
    try {
      const res = await (deps.fetchImpl ?? fetch)(geocodeUrl(q, near, lang), {
        headers: { 'user-agent': GEOCODE_USER_AGENT, accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      })
      if (res.status === 429 || res.status === 503) return { ok: false, reason: 'busy' }
      if (!res.ok) return { ok: false, reason: 'unavailable' }
      const result = parseNominatim(await res.json())
      await db.prepare('INSERT OR REPLACE INTO geocode_cache (key, ts, body) VALUES (?, ?, ?)').bind(key, now(), JSON.stringify(result)).run()
      await db.prepare('DELETE FROM geocode_cache WHERE ts < ?').bind(now() - KEEP_MS).run()
      return { ok: true, result, from: 'live' }
    } catch {
      return { ok: false, reason: 'unavailable' }
    }
  })
  queue = run.catch(() => {})
  return run
}
