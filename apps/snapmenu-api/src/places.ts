/**
 * Map data: restaurants near a point (OpenStreetMap via Overpass, cached per area in D1)
 * plus the dishes the community scanned there, scored for the viewer's goal.
 */
import { distanceM } from './community.js'
import type { D1Like } from './d1-adapter.js'
import { areaFor, fetchOverpass, type Area } from './overpass.js'
import type { Place } from './types.js'
import { fitsDiet, goalScore } from './ranking.js'
import type { DishEstimate, DishLite, PlacesResponse, Profile } from './types.js'

export type { DishLite, PlacesResponse }

export const OSM_ATTRIBUTION = 'Restaurant data © OpenStreetMap contributors, ODbL'
const FRESH_MS = 24 * 60 * 60_000
const KEEP_MS = 14 * 24 * 60 * 60_000

export const PLACES_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS overpass_cache (key TEXT PRIMARY KEY, ts INTEGER NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL, body TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS place_dishes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, place_id TEXT NOT NULL, place_name TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL,
    kind TEXT, cuisine TEXT, scan_id TEXT NOT NULL, device TEXT, team INTEGER NOT NULL DEFAULT 0, seed INTEGER NOT NULL DEFAULT 0, ts INTEGER NOT NULL,
    name TEXT NOT NULL, translated TEXT, kcal_low REAL NOT NULL, kcal_mid REAL NOT NULL, kcal_high REAL NOT NULL,
    protein REAL NOT NULL, carbs REAL NOT NULL, fat REAL NOT NULL, fiber REAL NOT NULL DEFAULT 0, price TEXT,
    vegetarian INTEGER NOT NULL DEFAULT 0, vegan INTEGER NOT NULL DEFAULT 0, UNIQUE(scan_id, name))`,
  `CREATE INDEX IF NOT EXISTS idx_pd_place ON place_dishes(place_id)`,
  `CREATE INDEX IF NOT EXISTS idx_pd_geo ON place_dishes(lat, lng)`,
]


interface DishRow {
  place_id: string; place_name: string; lat: number; lng: number; kind: string | null; cuisine: string | null; seed: number; ts: number
  name: string; translated: string | null; kcal_low: number; kcal_mid: number; kcal_high: number; protein: number; carbs: number; fat: number; fiber: number
  price: string | null; vegetarian: number; vegan: number
}

export function parsePriceEur(price: string | null | undefined): number | null {
  if (!price) return null
  const m = /(\d{1,3})(?:[.,](\d{1,2}))?/.exec(price)
  if (!m) return null
  const v = Number(`${m[1]}.${(m[2] ?? '0').padEnd(2, '0')}`)
  return Number.isFinite(v) && v > 0 && v < 200 ? v : null
}

const MIDS: Record<Profile['goal'], [number, number]> = { lose_fat: [30, 11], build_muscle: [52, 15], balanced: [36, 12], plant_based: [40, 12] }

/** The engine's goal score squashed to 0-100, so the map can draw it as a ring. */
export function fitScore(raw: number, goal: Profile['goal']): number {
  const [mid, scale] = MIDS[goal]
  return Math.max(1, Math.min(99, Math.round(100 / (1 + Math.exp(-(raw - mid) / scale)))))
}

const r = (mid: number) => ({ low: mid, mid, high: mid })

function scoreRow(row: DishRow, profile: Profile): DishLite | null {
  const scorable = {
    kcal: { low: row.kcal_low, mid: row.kcal_mid, high: row.kcal_high }, protein: r(row.protein), carbs: r(row.carbs), fat: r(row.fat), fiber: row.fiber,
    diet: { vegetarian: Boolean(row.vegetarian), vegan: Boolean(row.vegan), reason: null },
  } as unknown as Omit<DishEstimate, 'score' | 'why'>
  if (!fitsDiet(scorable, profile)) return null
  const { score, why } = goalScore(scorable, profile)
  return {
    name: row.name, translated: row.translated, kcal: scorable.kcal, protein: row.protein, carbs: row.carbs, fat: row.fat,
    price: row.price, priceEur: parsePriceEur(row.price), vegetarian: Boolean(row.vegetarian), vegan: Boolean(row.vegan),
    score: fitScore(score, profile.goal), why, example: row.seed === 1, ts: row.ts,
  }
}

/** Best first; the latest scan of a dish wins over older ones. */
export function rankPlaceDishes(rows: DishRow[], profile: Profile): DishLite[] {
  const latest = new Map<string, DishRow>()
  for (const row of rows) {
    const k = row.name.toLowerCase()
    const prev = latest.get(k)
    if (!prev || row.ts > prev.ts) latest.set(k, row)
  }
  return [...latest.values()].map((row) => scoreRow(row, profile)).filter((d): d is DishLite => d !== null).sort((a, b) => b.score - a.score)
}

export function profileFromQuery(url: URL): Profile {
  const goal = url.searchParams.get('goal')
  const g: Profile['goal'] = goal === 'build_muscle' || goal === 'balanced' || goal === 'plant_based' ? goal : 'lose_fat'
  return { goal: g, plantStyle: url.searchParams.get('style') === 'vegetarian' ? 'vegetarian' : 'vegan', allergies: [], language: 'English' }
}

const recentFailures = new Map<string, number>()

type Source = 'live' | 'cache' | 'stale' | 'nearby' | 'unavailable'

async function placesFor(db: D1Like, a: Area, waitUntil: (p: Promise<unknown>) => void): Promise<{ places: Place[]; source: Source; ts: number | null }> {
  const row = await db.prepare('SELECT ts, body FROM overpass_cache WHERE key = ?').bind(a.key).first<{ ts: number; body: string }>()
  const save = async (places: Place[]) => {
    await db.prepare('INSERT OR REPLACE INTO overpass_cache (key, ts, lat, lng, body) VALUES (?, ?, ?, ?, ?)').bind(a.key, Date.now(), a.lat, a.lng, JSON.stringify(places)).run()
    await db.prepare('DELETE FROM overpass_cache WHERE ts < ?').bind(Date.now() - KEEP_MS).run()
  }
  if (row) {
    const age = Date.now() - row.ts
    if (age > FRESH_MS) waitUntil(fetchOverpass(a).then(save).catch(() => {}))
    return { places: JSON.parse(row.body) as Place[], source: age > FRESH_MS ? 'stale' : 'cache', ts: row.ts }
  }
  const failedAt = recentFailures.get(a.key) ?? 0
  try {
    // Right after a failed try, do not ask Overpass again for this area for a little while.
    if (Date.now() - failedAt < 20_000) throw new Error('cooling down')
    const places = await fetchOverpass(a)
    await save(places)
    return { places, source: 'live', ts: Date.now() }
  } catch {
    if (Date.now() - failedAt >= 20_000) recentFailures.set(a.key, Date.now())
    // Overpass is busy: borrow the closest area we already have, if it is close enough to be useful.
    const near = await db.prepare('SELECT ts, lat, lng, body FROM overpass_cache ORDER BY ((lat - ?) * (lat - ?) + (lng - ?) * (lng - ?) * 0.37) LIMIT 1')
      .bind(a.lat, a.lat, a.lng, a.lng).first<{ ts: number; lat: number; lng: number; body: string }>()
    if (near && distanceM(a.lat, a.lng, near.lat, near.lng) < 1600) return { places: JSON.parse(near.body) as Place[], source: 'nearby', ts: near.ts }
    return { places: [], source: 'unavailable', ts: null }
  }
}


export async function handlePlaces(url: URL, db: D1Like, waitUntil: (p: Promise<unknown>) => void): Promise<PlacesResponse | null> {
  const lat = Number(url.searchParams.get('lat'))
  const lng = Number(url.searchParams.get('lng'))
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 85 || Math.abs(lng) > 180) return null
  const profile = profileFromQuery(url)
  const a = areaFor(lat, lng)
  const { places, source, ts } = await placesFor(db, a, waitUntil)

  const rows = (await db.prepare('SELECT * FROM place_dishes WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ? ORDER BY ts DESC, id DESC LIMIT 2000')
    .bind(a.south - 0.01, a.north + 0.01, a.west - 0.015, a.east + 0.015).all<DishRow>()).results
  const byPlace = new Map<string, DishRow[]>()
  for (const row of rows) byPlace.set(row.place_id, [...(byPlace.get(row.place_id) ?? []), row])

  const known = new Set(places.map((p) => p.id))
  const merged = [...places]
  const scored: PlacesResponse['scored'] = {}
  for (const [id, list] of byPlace) {
    const ranked = rankPlaceDishes(list, profile)
    const first = list[0]!
    if (!known.has(id)) {
      merged.push({ id, name: first.place_name, lat: first.lat, lng: first.lng, kind: (first.kind as Place['kind']) ?? 'restaurant', cuisine: first.cuisine, address: null, vegan: null, vegetarian: null })
      known.add(id)
    }
    if (ranked[0]) scored[id] = { best: ranked[0], dishes: ranked.length, example: list.every((x) => x.seed === 1) }
  }
  return { center: { lat: a.lat, lng: a.lng }, source, updatedAt: ts, attribution: OSM_ATTRIBUTION, places: merged, scored }
}

export async function handlePlace(url: URL, db: D1Like): Promise<{ dishes: DishLite[] } | null> {
  const id = url.searchParams.get('id') ?? ''
  if (!/^[nwr]\d{1,15}$/.test(id)) return null
  const rows = (await db.prepare('SELECT * FROM place_dishes WHERE place_id = ? ORDER BY ts DESC, id DESC LIMIT 300').bind(id).all<DishRow>()).results
  return { dishes: rankPlaceDishes(rows, profileFromQuery(url)) }
}

const num = (v: unknown, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null)
const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

export type AttachResult = { ok: true; attached: number } | { ok: false; status: number; code: string; message: string }

/** Store the dishes of one scan under a restaurant, so its pin and sheet show them. */
export async function attachScan(db: D1Like, body: Record<string, unknown>, device: string | null, team: boolean): Promise<AttachResult> {
  const scanId = str(body['scanId'], 64)
  const place = body['place'] as Record<string, unknown> | undefined
  const placeId = str(place?.['id'], 20)
  const placeName = str(place?.['name'], 80)
  const lat = num(place?.['lat'], -85, 85)
  const lng = num(place?.['lng'], -180, 180)
  if (!scanId || !placeId || !/^[nwr]\d{1,15}$/.test(placeId) || !placeName || lat === null || lng === null) return { ok: false, status: 400, code: 'bad_place', message: 'Pick a restaurant first.' }
  const dishes = Array.isArray(body['dishes']) ? (body['dishes'] as Array<Record<string, unknown>>).slice(0, 24) : []
  const now = Date.now()
  const stmts = []
  for (const d of dishes) {
    const name = str(d['name'], 80)
    const k = d['kcal'] as Record<string, unknown> | undefined
    const low = num(k?.['low'], 0, 4000), mid = num(k?.['mid'], 0, 4000), high = num(k?.['high'], 0, 4000)
    const protein = num(d['protein'], 0, 300), carbs = num(d['carbs'], 0, 500), fat = num(d['fat'], 0, 300)
    if (!name || low === null || mid === null || high === null || protein === null || carbs === null || fat === null || !(low <= mid && mid <= high)) continue
    stmts.push(db.prepare(`INSERT OR REPLACE INTO place_dishes (place_id, place_name, lat, lng, kind, cuisine, scan_id, device, team, seed, ts, name, translated, kcal_low, kcal_mid, kcal_high, protein, carbs, fat, fiber, price, vegetarian, vegan)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      placeId, placeName, lat, lng, str(place?.['kind'], 20), str(place?.['cuisine'], 60), scanId, device?.slice(0, 64) ?? null, team ? 1 : 0, now,
      name, str(d['translated'], 120), Math.round(low), Math.round(mid), Math.round(high), +protein.toFixed(1), +carbs.toFixed(1), +fat.toFixed(1),
      num(d['fiber'], 0, 100) ?? 0, str(d['price'], 24), d['vegetarian'] === true ? 1 : 0, d['vegan'] === true ? 1 : 0))
  }
  if (stmts.length === 0) return { ok: false, status: 400, code: 'no_dishes', message: 'This scan has no dishes to share.' }
  await db.batch(stmts)
  return { ok: true, attached: stmts.length }
}
