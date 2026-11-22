/**
 * Map data: restaurants near a point (OpenStreetMap via Overpass, cached per area in D1)
 * plus the dishes the community scanned there, scored for the viewer's goal.
 */
import { ALLERGENS, detectAllergens, expandUserAllergies, type Allergen } from './allergens.js'
import { distanceM } from './community.js'
import type { D1Like } from './d1-adapter.js'
import { AREA_HALF_LAT, AREA_HALF_LNG, areaFor, fetchOverpass, type Area } from './overpass.js'
import { readDiet, type Place } from './types.js'
import { fitsDiet, goalScore } from './ranking.js'
import { deliveryConfidence, type DeliveryConfidence, type DeliveryVotes } from './delivery.js'
import type { DishEstimate, DishLite, PlacesResponse, Profile } from './types.js'
import { say, userLanguage } from './voice/index.js'

export type { DishLite, PlacesResponse }

export const OSM_ATTRIBUTION = 'Restaurant data © OpenStreetMap contributors, ODbL'
const FRESH_MS = 7 * 24 * 60 * 60_000
const KEEP_MS = 60 * 24 * 60 * 60_000

export const PLACES_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS overpass_cache (key TEXT PRIMARY KEY, ts INTEGER NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL, body TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_overpass_geo ON overpass_cache(lat, lng)`,
  `CREATE TABLE IF NOT EXISTS place_dishes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, place_id TEXT NOT NULL, place_name TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL,
    kind TEXT, cuisine TEXT, scan_id TEXT NOT NULL, device TEXT, team INTEGER NOT NULL DEFAULT 0, seed INTEGER NOT NULL DEFAULT 0, ts INTEGER NOT NULL,
    name TEXT NOT NULL, translated TEXT, kcal_low REAL NOT NULL, kcal_mid REAL NOT NULL, kcal_high REAL NOT NULL,
    protein REAL NOT NULL, carbs REAL NOT NULL, fat REAL NOT NULL, fiber REAL NOT NULL DEFAULT 0, price TEXT,
    vegetarian INTEGER NOT NULL DEFAULT 0, vegan INTEGER NOT NULL DEFAULT 0, osm_verified INTEGER NOT NULL DEFAULT 0, UNIQUE(scan_id, name))`,
  `CREATE INDEX IF NOT EXISTS idx_pd_place ON place_dishes(place_id)`,
  `CREATE INDEX IF NOT EXISTS idx_pd_geo ON place_dishes(lat, lng)`,
  `CREATE TABLE IF NOT EXISTS place_dish_hints (scan_id TEXT NOT NULL, name TEXT NOT NULL, course TEXT, allergens TEXT NOT NULL,
    PRIMARY KEY (scan_id, name))`,
  `CREATE TABLE IF NOT EXISTS delivery_votes (place_id TEXT NOT NULL, device TEXT NOT NULL, value INTEGER NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL,
    ts INTEGER NOT NULL, team INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (place_id, device))`,
  `CREATE INDEX IF NOT EXISTS idx_dv_geo ON delivery_votes(lat, lng)`,
]


interface DishRow {
  osm_verified: number
  place_id: string; place_name: string; lat: number; lng: number; kind: string | null; cuisine: string | null; seed: number; ts: number
  name: string; translated: string | null; kcal_low: number; kcal_mid: number; kcal_high: number; protein: number; carbs: number; fat: number; fiber: number
  price: string | null; vegetarian: number; vegan: number
  course: string | null; allergens: string | null
}

const ALLERGEN_SET = new Set<string>(ALLERGENS)
const COURSE_SET = new Set(['main', 'starter', 'side', 'dessert', 'drink'])
export const DISH_ROWS = `SELECT d.*, h.course, h.allergens FROM (SELECT * FROM place_dishes WHERE seed = 1 OR osm_verified = 1) d
  LEFT JOIN place_dish_hints h ON d.scan_id = h.scan_id AND d.name = h.name`

export function dishAllergens(raw: unknown): Allergen[] {
  if (!Array.isArray(raw)) return []
  return [...new Set(raw.filter((a): a is Allergen => typeof a === 'string' && ALLERGEN_SET.has(a)))].slice(0, ALLERGEN_SET.size)
}

const wordCache = new Map<string, Allergen[]>()
export function allergensFromWords(name: string, translated: string | null): Allergen[] {
  const key = JSON.stringify([name, translated])
  let hit = wordCache.get(key)
  if (!hit) {
    hit = detectAllergens({ dishName: name, description: translated, components: [] }).map((a) => a.allergen)
    if (wordCache.size >= 2000) wordCache.clear()
    wordCache.set(key, hit)
  }
  return hit
}

export function readDishHints(row: Pick<DishRow, 'allergens' | 'name' | 'translated'>): Allergen[] {
  const saved = dishAllergens(row.allergens ? JSON.parse(row.allergens) : null)
  return [...new Set([...saved, ...allergensFromWords(row.name, row.translated)])]
}

export function parsePriceEur(price: string | null | undefined): number | null {
  if (!price) return null
  const m = /^(?:€\s*|EUR\s*)?(\d{1,3})(?:[.,](\d{1,2}))?\s*(?:€|EUR)?$/i.exec(price.trim())
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

function scoreRow(row: DishRow, profile: Profile, avoid: Set<Allergen>): DishLite | null {
  if (row.course === 'drink' || row.course === 'dessert') return null
  if (avoid.size && readDishHints(row).some((a) => avoid.has(a))) return null
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
  const hasScans = rows.some((r) => !r.seed)
  for (const row of rows) {
    if (hasScans && row.seed) continue
    const k = row.name.toLowerCase()
    const prev = latest.get(k)
    if (!prev || row.ts > prev.ts) latest.set(k, row)
  }
  const avoid = expandUserAllergies(profile.allergies)
  return [...latest.values()].map((row) => scoreRow(row, profile, avoid)).filter((d): d is DishLite => d !== null).sort((a, b) => b.score - a.score)
}

export function profileFromQuery(url: URL, restrictions?: string | null): Profile {
  const goal = url.searchParams.get('goal')
  const g: Profile['goal'] = goal === 'build_muscle' || goal === 'balanced' || goal === 'plant_based' ? goal : 'lose_fat'
  // `lang` is the viewer's language (the web app adds it); a dish's `why` line is written in it.
  const diet = readDiet(url.searchParams.get('diet'))
  return { goal: g, plantStyle: url.searchParams.get('style') === 'vegetarian' ? 'vegetarian' : 'vegan', ...(diet ? { diet } : {}), allergies: [...expandUserAllergies(restrictions?.slice(0, 200).split(',') ?? [])], language: userLanguage({ saved: url.searchParams.get('lang') }) }
}

const recentFailures = new Map<string, number>()
const refreshTried = new Map<string, number>()

type Source = 'live' | 'cache' | 'stale' | 'nearby' | 'unavailable'

async function placesFor(db: D1Like, a: Area, waitUntil: (p: Promise<unknown>) => void): Promise<{ places: Place[]; source: Source; ts: number | null }> {
  const row = await db.prepare('SELECT ts, body FROM overpass_cache WHERE key = ?').bind(a.key).first<{ ts: number; body: string }>()
  const save = async (places: Place[]) => {
    await db.prepare('INSERT OR REPLACE INTO overpass_cache (key, ts, lat, lng, body) VALUES (?, ?, ?, ?, ?)').bind(a.key, Date.now(), a.lat, a.lng, JSON.stringify(places)).run()
    await db.prepare('DELETE FROM overpass_cache WHERE ts < ?').bind(Date.now() - KEEP_MS).run()
  }
  if (row && Date.now() - row.ts <= KEEP_MS) {
    const age = Date.now() - row.ts
    const places = JSON.parse(row.body) as Place[]
    // Lists cached before the delivery tags were parsed get refreshed in the background, at most every 10 minutes.
    const oldFormat = places.length > 0 && (!('delivery' in places[0]!) || !('hours' in places[0]!)) // hours: discover's detail tags
    if ((age > FRESH_MS || oldFormat) && Date.now() - (refreshTried.get(a.key) ?? 0) > 10 * 60_000) {
      refreshTried.set(a.key, Date.now())
      waitUntil(fetchOverpass(a).then(save).catch(() => {}))
    }
    return { places, source: age > FRESH_MS ? 'stale' : 'cache', ts: row.ts }
  }
  const failedAt = recentFailures.get(a.key) ?? 0
  try {
    // Right after a failed try, do not ask Overpass again for this area for a little while.
    if (Date.now() - failedAt < 20_000) throw new Error('cooling down')
    const live = fetchOverpass(a).then(async places => { await save(places); return places })
    waitUntil(live.catch(() => { recentFailures.set(a.key, Date.now()) }))
    let timer: ReturnType<typeof setTimeout> | undefined
    let places: Place[]
    try {
      places = await Promise.race([live, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('map wait budget')), 4000) })])
    } finally { clearTimeout(timer) }
    return { places, source: 'live', ts: Date.now() }
  } catch {
    if (Date.now() - failedAt >= 20_000) recentFailures.set(a.key, Date.now())
    // Overpass is busy: borrow the closest area we already have, if it is close enough to be useful.
    const near = await db.prepare('SELECT ts, lat, lng, body FROM overpass_cache WHERE ts >= ? ORDER BY ((lat - ?) * (lat - ?) + (lng - ?) * (lng - ?) * 0.37) LIMIT 1')
      .bind(Date.now() - KEEP_MS, a.lat, a.lat, a.lng, a.lng).first<{ ts: number; lat: number; lng: number; body: string }>()
    if (near && distanceM(a.lat, a.lng, near.lat, near.lng) < 1600) return { places: JSON.parse(near.body) as Place[], source: 'nearby', ts: near.ts }
    return { places: [], source: 'unavailable', ts: null }
  }
}


export async function handlePlaces(url: URL, db: D1Like, waitUntil: (p: Promise<unknown>) => void, restrictions?: string | null): Promise<PlacesResponse | null> {
  const lat = Number(url.searchParams.get('lat'))
  const lng = Number(url.searchParams.get('lng'))
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 85 || Math.abs(lng) > 180) return null
  const profile = profileFromQuery(url, restrictions)
  const a = areaFor(lat, lng)
  const { places, source, ts } = await placesFor(db, a, waitUntil)

  const rows = (await db.prepare(`${DISH_ROWS} WHERE d.lat BETWEEN ? AND ? AND d.lng BETWEEN ? AND ? ORDER BY d.ts DESC, d.id DESC LIMIT 2000`)
    .bind(a.south - 0.01, a.north + 0.01, a.west - 0.015, a.east + 0.015).all<DishRow>()).results
  const byPlace = new Map<string, DishRow[]>()
  for (const row of rows) byPlace.set(row.place_id, [...(byPlace.get(row.place_id) ?? []), row])

  const known = new Set(places.map((p) => p.id))
  const merged: Place[] = places.map(p => ({ ...p, verified: true }))
  const scored: PlacesResponse['scored'] = {}
  for (const [id, list] of byPlace) {
    const ranked = rankPlaceDishes(list, profile)
    const first = list.find(row => row.osm_verified === 1) ?? list[0]!
    if (!known.has(id)) {
      // A stored dish can outlive its OSM cache entry. Show the pin, but only offer current OSM records for attachment.
      merged.push({ id, verified: false, name: first.place_name, lat: first.lat, lng: first.lng, kind: (first.kind as Place['kind']) ?? 'restaurant', cuisine: first.cuisine, address: null, vegan: null, vegetarian: null })
      known.add(id)
    }
    if (ranked[0]) scored[id] = { best: ranked[0], dishes: ranked.length, example: ranked[0].example }
  }
  const deliveryVotes: PlacesResponse['deliveryVotes'] = {}
  const votes = (await db.prepare(`SELECT place_id, SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END) yes, SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END) no
      FROM delivery_votes WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ? GROUP BY place_id`)
    .bind(a.south - 0.01, a.north + 0.01, a.west - 0.015, a.east + 0.015).all<{ place_id: string; yes: number; no: number }>()).results
  for (const v of votes) deliveryVotes[v.place_id] = { yes: v.yes, no: v.no }
  return { center: { lat: a.lat, lng: a.lng }, source, updatedAt: ts, attribution: OSM_ATTRIBUTION, places: merged, scored, deliveryVotes }
}

export interface PlaceVotes { yes: number; no: number; myVote: -1 | 0 | 1 }

export async function placeVotes(db: D1Like, placeId: string, device: string | null): Promise<PlaceVotes> {
  const r = await db.prepare(`SELECT SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END) yes, SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END) no,
      MAX(CASE WHEN device = ? THEN value END) mine FROM delivery_votes WHERE place_id = ?`).bind(device ?? '', placeId).first<{ yes: number | null; no: number | null; mine: number | null }>()
  const mine = r?.mine ?? 0
  return { yes: r?.yes ?? 0, no: r?.no ?? 0, myVote: mine === 1 ? 1 : mine === -1 ? -1 : 0 }
}

export const DELIVERY_VOTE_LIMIT = { max: 30, windowMs: 10 * 60_000 } as const

export type VoteResult = { ok: true; data: PlaceVotes } | { ok: false; status: number; code: string; message: string }

/** One device, one "Delivers? yes / no" per restaurant. Tapping the same answer again (value 0) takes it back. */
export async function deliveryVote(db: D1Like, body: Record<string, unknown>, device: string | null, team: boolean, lang: unknown = 'English'): Promise<VoteResult> {
  if (!device) return { ok: false, status: 400, code: 'no_device', message: 'Missing device id.' }
  const placeId = typeof body['placeId'] === 'string' ? body['placeId'] : ''
  const value = body['value']
  const lat = num(body['lat'], -85, 85)
  const lng = num(body['lng'], -180, 180)
  if (!/^[nwr]\d{1,15}$/.test(placeId) || (value !== 1 && value !== -1 && value !== 0) || lat === null || lng === null) {
    return { ok: false, status: 400, code: 'bad_vote', message: 'Invalid vote.' }
  }
  const n = await db.prepare('SELECT COUNT(*) c FROM delivery_votes WHERE device = ? AND ts > ?').bind(device, Date.now() - DELIVERY_VOTE_LIMIT.windowMs).first<{ c: number }>()
  if ((n?.c ?? 0) >= DELIVERY_VOTE_LIMIT.max) return { ok: false, status: 429, code: 'rate_limited', message: say(lang, 'community.slow_answers') }
  if (value === 0) await db.prepare('DELETE FROM delivery_votes WHERE place_id = ? AND device = ?').bind(placeId, device).run()
  else {
    await db.prepare('INSERT OR REPLACE INTO delivery_votes (place_id, device, value, lat, lng, ts, team) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(placeId, device.slice(0, 64), value, +lat.toFixed(6), +lng.toFixed(6), Date.now(), team ? 1 : 0).run()
  }
  return { ok: true, data: await placeVotes(db, placeId, device) }
}

export async function handlePlace(url: URL, db: D1Like, device: string | null = null, restrictions?: string | null): Promise<{ dishes: DishLite[]; votes: PlaceVotes } | null> {
  const id = url.searchParams.get('id') ?? ''
  if (!/^[nwr]\d{1,15}$/.test(id)) return null
  const rows = (await db.prepare(`${DISH_ROWS} WHERE d.place_id = ? ORDER BY d.ts DESC, d.id DESC LIMIT 300`).bind(id).all<DishRow>()).results
  return { dishes: rankPlaceDishes(rows, profileFromQuery(url, restrictions)), votes: await placeVotes(db, id, device) }
}

/**
 * Delivery badges for posts: look the posts' restaurants up in the cached OpenStreetMap lists and the votes.
 * No user position on the server, so distance is unknown here.
 */
export async function deliveryForPlaces(db: D1Like, places: Array<{ id: string; lat: number; lng: number }>): Promise<Map<string, DeliveryConfidence>> {
  const out = new Map<string, DeliveryConfidence>()
  if (places.length === 0) return out
  const keys = [...new Set(places.map(p => areaFor(p.lat, p.lng).key))].slice(0, 12)
  const known = new Map<string, Place>()
  const stamps = (await db.prepare(`SELECT key, ts FROM overpass_cache WHERE key IN (${keys.map(() => '?').join(',')})`).bind(...keys).all<{ key: string; ts: number }>()).results
  for (const stamp of stamps) {
    let list = parsedCache.get(stamp.key)
    if (!list || list.ts !== stamp.ts) {
      const row = await db.prepare('SELECT body FROM overpass_cache WHERE key=?').bind(stamp.key).first<{ body: string }>()
      if (!row) continue
      list = { ts: stamp.ts, byId: new Map((JSON.parse(row.body) as Place[]).map(p => [p.id, p])) }
      if (parsedCache.size >= 40) parsedCache.delete(parsedCache.keys().next().value!)
      parsedCache.set(stamp.key, list)
    }
    for (const p of places) { const hit = list.byId.get(p.id); if (hit) known.set(p.id, hit) }
  }
  const ids = [...new Set(places.map(p => p.id))].slice(0, 90)
  const slots = ids.map(() => '?').join(',')
  const rows = (await db.prepare(`SELECT place_id, SUM(value=1) yes, SUM(value=-1) no FROM delivery_votes WHERE place_id IN (${slots}) GROUP BY place_id`).bind(...ids).all<{ place_id: string; yes: number; no: number }>()).results
  const votes = new Map(rows.map(r => [r.place_id, { yes: r.yes, no: r.no }]))
  const kinds = (await db.prepare(`SELECT place_id, MAX(kind) kind FROM place_dishes WHERE (seed = 1 OR osm_verified = 1) AND place_id IN (${slots}) GROUP BY place_id`).bind(...ids).all<{ place_id: string; kind: string }>()).results
  const kindById = new Map(kinds.map(r => [r.place_id, r.kind]))
  for (const id of ids) {
    const k = kindById.get(id)
    const kind = k === 'cafe' || k === 'fast_food' ? k : 'restaurant'
    out.set(id, deliveryConfidence(known.get(id) ?? { kind }, null, votes.get(id)))
  }
  return out
}

const parsedCache = new Map<string, { ts: number; byId: Map<string, Place> }>()

const num = (v: unknown, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null)
const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

/** Only the server's Overpass lists can supply a public restaurant identity. Look in overlapping
 * cache areas around the submitted pin, then check the actual distance to the OSM element. */
export async function verifiedRestaurant(db: D1Like, input: unknown): Promise<Place | null> {
  if (!input || typeof input !== 'object') return null
  const p = input as Record<string, unknown>
  const id = p['id'], lat = num(p['lat'], -85, 85), lng = num(p['lng'], -180, 180)
  if (typeof id !== 'string' || !/^[nwr]\d{1,15}$/.test(id) || lat === null || lng === null) return null
  const maxDistanceM = 250
  // Search area centers whose boxes can hold the restaurant, including the pin tolerance.
  const latSpan = AREA_HALF_LAT + maxDistanceM / 110_000
  const lngSpan = AREA_HALF_LNG + maxDistanceM / (110_000 * Math.cos(lat * Math.PI / 180))
  const wrappedLng = lng + (lng < 0 ? 360 : -360)
  const row = await db.prepare(`SELECT j.value AS place FROM overpass_cache c, json_each(c.body) j
    WHERE c.lat BETWEEN ? AND ? AND (c.lng BETWEEN ? AND ? OR c.lng BETWEEN ? AND ?)
      AND c.ts >= ? AND json_extract(j.value, '$.id') = ? ORDER BY c.ts DESC LIMIT 1`)
    .bind(lat - latSpan, lat + latSpan, lng - lngSpan, lng + lngSpan,
      wrappedLng - lngSpan, wrappedLng + lngSpan, Date.now() - KEEP_MS, id)
    .first<{ place: string }>()
  if (!row) return null
  const place = JSON.parse(row.place) as Place
  return distanceM(lat, lng, place.lat, place.lng) <= maxDistanceM ? { ...place, verified: true } : null
}

export type AttachResult = { ok: true; attached: number; place: Place } | { ok: false; status: number; code: string; message: string }

/** Store the dishes of one scan under a restaurant, so its pin and sheet show them. */
export async function attachScan(db: D1Like, body: Record<string, unknown>, device: string | null, team: boolean, lang: unknown = 'English'): Promise<AttachResult> {
  const scanId = str(body['scanId'], 64)
  if (!scanId) return { ok: false, status: 400, code: 'bad_place', message: say(lang, 'community.failed') }
  const place = await verifiedRestaurant(db, body['place'])
  if (!place) return { ok: false, status: 400, code: 'unverified_place', message: say(lang, 'community.unverified_place') }
  const dishes = Array.isArray(body['dishes']) ? (body['dishes'] as Array<Record<string, unknown>>).slice(0, 24) : []
  const now = Date.now()
  const stmts = []
  let attached = 0
  for (const d of dishes) {
    if (!d || typeof d !== 'object') continue
    const name = str(d['name'], 80)
    const k = d['kcal'] as Record<string, unknown> | undefined
    const low = num(k?.['low'], 0, 4000), mid = num(k?.['mid'], 0, 4000), high = num(k?.['high'], 0, 4000)
    const protein = num(d['protein'], 0, 300), carbs = num(d['carbs'], 0, 500), fat = num(d['fat'], 0, 300)
    if (!name || low === null || mid === null || high === null || protein === null || carbs === null || fat === null || !(low <= mid && mid <= high)) continue
    const course = typeof d['course'] === 'string' && COURSE_SET.has(d['course']) ? d['course'] : null
    if (course === 'drink' || course === 'dessert') continue
    stmts.push(db.prepare(`INSERT OR REPLACE INTO place_dishes (place_id, place_name, lat, lng, kind, cuisine, scan_id, device, team, seed, osm_verified, ts, name, translated, kcal_low, kcal_mid, kcal_high, protein, carbs, fat, fiber, price, vegetarian, vegan)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      place.id, place.name, place.lat, place.lng, place.kind, place.cuisine, scanId, device?.slice(0, 64) ?? null, team ? 1 : 0, now,
      name, str(d['translated'], 120), Math.round(low), Math.round(mid), Math.round(high), +protein.toFixed(1), +carbs.toFixed(1), +fat.toFixed(1),
      num(d['fiber'], 0, 100) ?? 0, str(d['price'], 24), d['vegetarian'] === true ? 1 : 0, d['vegan'] === true ? 1 : 0))
    stmts.push(db.prepare('INSERT OR REPLACE INTO place_dish_hints (scan_id, name, course, allergens) VALUES (?, ?, ?, ?)')
      .bind(scanId, name, course, JSON.stringify(dishAllergens(d['allergens']))))
    attached++
  }
  if (attached === 0) return { ok: false, status: 400, code: 'no_dishes', message: say(lang, 'community.failed') }
  await db.batch(stmts)
  return { ok: true, attached, place }
}
