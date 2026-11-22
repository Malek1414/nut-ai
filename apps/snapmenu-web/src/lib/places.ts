import type { DishLite, MenuResult, Place, PlacesResponse, Profile } from '../../../snapmenu-api/src/types'
import { store } from './storage'
import { distance } from './position'

export type { DishLite, Place, PlacesResponse }

// `lang` is the language a dish's "why" line comes back in.
const goalQuery = (p: Profile | null) => `goal=${p?.goal ?? 'lose_fat'}${p?.diet ? `&diet=${p.diet}` : p?.goal === 'plant_based' && p.plantStyle === 'vegetarian' ? '&style=vegetarian' : ''}&lang=${encodeURIComponent(store.language())}`

const menuAvoid = (p: Profile | null) => (p?.allergies ?? []).filter((a) => /^[a-z_]+$/.test(a)).join(',')
const requests = new Map<string, Promise<PlacesResponse>>()
const STORAGE_KEY = 'snapmenu.map.areas.v1'
const KEEP_MS = 7 * 24 * 60 * 60_000
type SavedArea = { preferences: string; savedAt: number; data: PlacesResponse }

function readAreas(): SavedArea[] {
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]')
    if (!Array.isArray(saved)) return []
    return saved.filter((area: SavedArea) => area?.savedAt > Date.now() - KEEP_MS &&
      Number.isFinite(area.data?.center?.lat) && Number.isFinite(area.data?.center?.lng) &&
      Array.isArray(area.data.places) && area.data.scored && area.data.deliveryVotes).slice(0, 3)
  } catch { return [] }
}

let areas = readAreas()
const preferencesFor = (profile: Profile | null) => goalQuery(profile) + '|' + menuAvoid(profile)

function saveArea(preferences: string, data: PlacesResponse) {
  const { lat, lng } = data.center
  areas = [{ preferences, savedAt: Date.now(), data }, ...areas.filter(area =>
    area.preferences !== preferences || area.data.center.lat !== lat || area.data.center.lng !== lng)].slice(0, 3)
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(areas)) } catch { /* Still available in memory. */ }
}

/** Restore a nearby list only when its goal, diet, allergies and language match. */
export function cachedPlaces(lat: number, lng: number, profile: Profile | null): PlacesResponse | null {
  const preferences = preferencesFor(profile)
  let closest: PlacesResponse | null = null
  let limit = 1500
  for (const area of areas) {
    if (area.preferences !== preferences || area.savedAt <= Date.now() - KEEP_MS) continue
    const metres = distance({ lat, lng }, area.data.center)
    if (metres < limit) { closest = area.data; limit = metres }
  }
  return closest && { ...closest, source: 'stale' }
}

/** Restaurants near a point plus the best community dish per place for the user's goal. */
export function fetchPlaces(lat: number, lng: number, profile: Profile | null, fresh = false): Promise<PlacesResponse> {
  const preferences = preferencesFor(profile)
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}|${preferences}`
  const existing = requests.get(key)
  if (existing && !fresh) return existing
  const request: Promise<PlacesResponse> = fetch(`/api/places?lat=${lat.toFixed(4)}&lng=${lng.toFixed(4)}&${goalQuery(profile)}`, {
    signal: AbortSignal.timeout(10_000), headers: { 'x-menu-avoid': menuAvoid(profile) },
  }).then(async response => {
    if (!response.ok) throw new Error(`places ${response.status}`)
    const data = await response.json() as PlacesResponse
    if (data.source === 'unavailable') return cachedPlaces(lat, lng, profile) ?? data
    if (requests.get(key) === request && data.places.length) saveArea(preferences, data)
    return data
  }).catch((error: unknown) => {
    const saved = cachedPlaces(lat, lng, profile)
    if (saved) return saved
    throw error
  }).finally(() => {
    if (requests.get(key) === request) requests.delete(key)
  })
  requests.set(key, request)
  return request
}

export function forgetPlaces() {
  requests.clear()
  areas = []
  try { window.localStorage.removeItem(STORAGE_KEY) } catch { /* Storage may be disabled. */ }
}

export async function fetchPlace(id: string, profile: Profile | null): Promise<{ dishes: DishLite[]; votes?: { yes: number; no: number; myVote: -1 | 0 | 1 } }> {
  const r = await fetch(`/api/place?id=${encodeURIComponent(id)}&${goalQuery(profile)}`, { headers: { 'x-device': store.deviceId(), 'x-menu-avoid': menuAvoid(profile) } })
  if (!r.ok) throw new Error(`place ${r.status}`)
  return (await r.json()) as { dishes: DishLite[]; votes?: { yes: number; no: number; myVote: -1 | 0 | 1 } }
}

/** File a scan's dishes under a restaurant, so its map pin shows them. */
export async function attachScan(result: MenuResult, place: Place): Promise<Place> {
  const response = await fetch('/api/scan/attach', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-lang': store.language() },
    body: JSON.stringify({
      scanId: result.scanId,
      place: { id: place.id, lat: place.lat, lng: place.lng },
      deviceId: store.deviceId(),
      team: store.isTeam(),
    }),
  })
  const body = await response.json().catch(() => null) as { place?: Place; error?: { message: string } } | null
  if (!response.ok || !body?.place) throw new Error(body?.error?.message ?? 'Could not attach the scan. Try again.')
  forgetPlaces()
  return body.place
}
