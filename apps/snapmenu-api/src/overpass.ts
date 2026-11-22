/**
 * Restaurants near the user from OpenStreetMap via the Overpass API.
 * Data © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright).
 *
 * Polite use: one query per ~2.5 km area, cached in D1 for a day, a generic User-Agent,
 * at most one request in flight per Worker, a pause between requests, and a mirror
 * only when the main server says it is busy.
 */
import { distanceM } from './community.js'
import { osmDeliveryTags } from './delivery.js'
import { osmDetailTags } from './discover/osm-tags.js'
import type { Place, PlaceKind } from './types.js'

export type { Place, PlaceKind }


export interface Area { key: string; lat: number; lng: number; south: number; west: number; north: number; east: number }

const STEP_LAT = 0.01
const STEP_LNG = 0.015
const HALF_LAT = 0.012
const HALF_LNG = 0.018

/** Snap a position to a grid of area centres (~1.1 km apart), so nearby users share one cached query. */
export function areaFor(lat: number, lng: number): Area {
  const i = Math.round(lat / STEP_LAT)
  const j = Math.round(lng / STEP_LNG)
  const cLat = +(i * STEP_LAT).toFixed(4)
  const cLng = +(j * STEP_LNG).toFixed(4)
  return {
    key: `${i}:${j}`,
    lat: cLat,
    lng: cLng,
    south: +(cLat - HALF_LAT).toFixed(4),
    west: +(cLng - HALF_LNG).toFixed(4),
    north: +(cLat + HALF_LAT).toFixed(4),
    east: +(cLng + HALF_LNG).toFixed(4),
  }
}

export function buildQuery(a: Area): string {
  const bbox = `${a.south},${a.west},${a.north},${a.east}`
  return `[out:json][timeout:25];(node["amenity"~"^(restaurant|fast_food|cafe)$"]["name"](${bbox});way["amenity"~"^(restaurant|fast_food|cafe)$"]["name"](${bbox}););out center tags 2000;`
}

interface OsmElement {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

const KINDS = new Set<PlaceKind>(['restaurant', 'fast_food', 'cafe'])
const dietTag = (v: string | undefined) => (v === 'only' ? 'only' : v === 'yes' ? 'yes' : null)

function prettyCuisine(raw: string | undefined): string | null {
  if (!raw) return null
  const first = raw.split(/[;,]/).map((s) => s.trim()).filter(Boolean).slice(0, 2)
  if (first.length === 0) return null
  return first.map((c) => c.replace(/_/g, ' ').replace(/^\w/, (m) => m.toUpperCase())).join(', ')
}

/** Overpass JSON -> named places, deduplicated, nearest first, capped. Unnamed or malformed entries are dropped. */
export function parseOverpass(body: unknown, near?: { lat: number; lng: number }, limit = 600): Place[] {
  const elements = (body as { elements?: unknown } | null)?.elements
  if (!Array.isArray(elements)) return []
  const seen = new Set<string>()
  const out: Place[] = []
  for (const raw of elements as OsmElement[]) {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'number') continue
    const tags = raw.tags ?? {}
    const name = (tags['name'] ?? '').trim()
    const kind = tags['amenity'] as PlaceKind
    if (!name || !KINDS.has(kind)) continue
    const lat = raw.lat ?? raw.center?.lat
    const lng = raw.lon ?? raw.center?.lon
    if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) continue
    const id = `${raw.type === 'way' ? 'w' : raw.type === 'relation' ? 'r' : 'n'}${raw.id}`
    if (seen.has(id)) continue
    seen.add(id)
    const street = tags['addr:street']
    const no = tags['addr:housenumber']
    out.push({
      id,
      name: name.slice(0, 80),
      lat: +lat.toFixed(6),
      lng: +lng.toFixed(6),
      kind,
      cuisine: prettyCuisine(tags['cuisine']),
      address: street ? `${street}${no ? ` ${no}` : ''}` : null,
      vegan: dietTag(tags['diet:vegan']),
      vegetarian: dietTag(tags['diet:vegetarian']),
      ...osmDeliveryTags(tags),
      ...osmDetailTags(tags), // discover: opening hours, website, phone
    })
  }
  if (near) out.sort((a, b) => distanceM(near.lat, near.lng, a.lat, a.lng) - distanceM(near.lat, near.lng, b.lat, b.lng))
  return out.slice(0, limit)
}

export const OVERPASS_ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']
export const USER_AGENT = 'Snapmenu/0.1 (open-source menu helper; contact via GitHub)'

let inFlight: Promise<Place[]> | null = null
let lastRequestAt = 0

export class OverpassBusy extends Error {}

/** One Overpass request with the polite rules above. Throws OverpassBusy when every server refuses. */
export async function fetchOverpass(a: Area, fetchImpl: typeof fetch = fetch): Promise<Place[]> {
  if (inFlight) {
    // Another area is loading: wait for it, then go (keeps us to one request at a time).
    try { await inFlight } catch { /* ignore */ }
  }
  const run = (async () => {
    const wait = lastRequestAt + 1100 - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    let lastErr: unknown = null
    // Overall budget, so a phone never waits much more than 20 s for the map list.
    const deadline = Date.now() + 20_000
    for (const url of OVERPASS_ENDPOINTS) {
      const budget = Math.min(6_000, deadline - Date.now())
      if (budget < 2_000) break
      lastRequestAt = Date.now()
      try {
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': USER_AGENT, accept: 'application/json' },
          body: `data=${encodeURIComponent(buildQuery(a))}`,
          signal: AbortSignal.timeout(budget),
        })
        if (res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504) { lastErr = new OverpassBusy(`overpass ${res.status}`); continue }
        if (!res.ok) { lastErr = new Error(`overpass ${res.status}`); continue }
        return parseOverpass(await res.json(), { lat: a.lat, lng: a.lng })
      } catch (e) {
        lastErr = e
      }
    }
    throw lastErr instanceof Error ? lastErr : new OverpassBusy('overpass unavailable')
  })()
  inFlight = run
  try {
    return await run
  } finally {
    if (inFlight === run) inFlight = null
  }
}
