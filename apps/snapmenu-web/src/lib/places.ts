import type { DishEstimate, DishLite, MenuResult, Place, PlacesResponse, Profile } from '../../../snapmenu-api/src/types'
import { store } from './storage'

export type { DishLite, Place, PlacesResponse }

// `lang` is the language a dish's "why" line comes back in.
const goalQuery = (p: Profile | null) => `goal=${p?.goal ?? 'lose_fat'}${p?.goal === 'plant_based' && p.plantStyle === 'vegetarian' ? '&style=vegetarian' : ''}&lang=${encodeURIComponent(store.language())}`

const cache = new Map<string, Promise<PlacesResponse>>()

/** Restaurants near a point plus the best community dish per place for the user's goal. */
export function fetchPlaces(lat: number, lng: number, profile: Profile | null, fresh = false): Promise<PlacesResponse> {
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}|${goalQuery(profile)}`
  if (!fresh && cache.has(key)) return cache.get(key)!
  const p = fetch(`/api/places?lat=${lat.toFixed(4)}&lng=${lng.toFixed(4)}&${goalQuery(profile)}`, { signal: AbortSignal.timeout(30_000) })
    .then(async (r) => {
      if (!r.ok) throw new Error(`places ${r.status}`)
      const body = (await r.json()) as PlacesResponse
      // Never cache "OpenStreetMap is busy" (or a neighbour's list): the next try should ask again.
      if (body.source === 'unavailable' || body.source === 'nearby') cache.delete(key)
      return body
    })
    .catch((e) => { cache.delete(key); throw e })
  cache.set(key, p)
  return p
}

export function forgetPlaces() { cache.clear() }

export async function fetchPlace(id: string, profile: Profile | null): Promise<{ dishes: DishLite[]; votes?: { yes: number; no: number; myVote: -1 | 0 | 1 } }> {
  const r = await fetch(`/api/place?id=${encodeURIComponent(id)}&${goalQuery(profile)}`, { headers: { 'x-device': store.deviceId() } })
  if (!r.ok) throw new Error(`place ${r.status}`)
  return (await r.json()) as { dishes: DishLite[]; votes?: { yes: number; no: number; myVote: -1 | 0 | 1 } }
}

const compact = (d: DishEstimate) => ({
  name: d.name, translated: d.translated, kcal: d.kcal, protein: d.protein.mid, carbs: d.carbs.mid, fat: d.fat.mid, fiber: d.fiber,
  price: d.price, vegetarian: d.diet.vegetarian, vegan: d.diet.vegan,
})

/** File a scan's dishes under a restaurant, so its map pin shows them. */
export async function attachScan(result: MenuResult, place: Place): Promise<number> {
  const r = await fetch('/api/scan/attach', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-lang': store.language() },
    body: JSON.stringify({
      scanId: result.scanId,
      place: { id: place.id, name: place.name, lat: place.lat, lng: place.lng, kind: place.kind, cuisine: place.cuisine },
      dishes: result.dishes.filter((d) => d.course !== 'drink').map(compact),
      deviceId: store.deviceId(),
      team: store.isTeam(),
    }),
  })
  const body = (await r.json().catch(() => null)) as { attached?: number; error?: { message: string } } | null
  if (!r.ok) throw new Error(body?.error?.message ?? 'Could not attach the scan. Try again.')
  forgetPlaces()
  return body?.attached ?? 0
}
