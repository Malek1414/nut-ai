// Discover on the client: search, restaurant details and seed-oil reports (apps/snapmenu-api/src/discover).
import type { PlaceDetails } from '../../../snapmenu-api/src/discover/osm-tags'
import type { AreaHit, DetailsResponse, SearchPlace, SearchResponse, SeedOilView } from '../../../snapmenu-api/src/discover/types'
import type { Profile } from '../../../snapmenu-api/src/types'
import { store } from '../lib/storage'

export type { AreaHit, DetailsResponse, PlaceDetails, SearchPlace, SearchResponse, SeedOilView }

const headers = (): Record<string, string> => ({ 'x-device': store.deviceId(), 'x-lang': store.language(), ...(store.isTeam() ? { 'x-team': '1' } : {}) })
const goalQuery = (p: Profile | null) => `goal=${p?.goal ?? 'lose_fat'}${p?.goal === 'plant_based' && p.plantStyle === 'vegetarian' ? '&style=vegetarian' : ''}&lang=${encodeURIComponent(store.language())}`

async function read<T>(r: Response): Promise<T> {
  const body = (await r.json().catch(() => null)) as (T & { error?: { message: string } }) | null
  if (!r.ok || !body) throw new Error(body?.error?.message ?? 'That did not work. Try again.')
  return body
}

/** Restaurants by name and areas by name. `geo` (a submitted search) may look the name up on OpenStreetMap's Nominatim. */
export async function searchDiscover(q: string, near: { lat: number; lng: number }, geo: boolean, signal?: AbortSignal): Promise<SearchResponse> {
  const url = `/api/discover/search?q=${encodeURIComponent(q)}&lat=${near.lat.toFixed(4)}&lng=${near.lng.toFixed(4)}${geo ? '&geo=1' : ''}`
  return read<SearchResponse>(await fetch(url, { headers: headers(), ...(signal ? { signal } : {}) }))
}

/** One restaurant in full. `load` lets the API fetch its area from OpenStreetMap when it is not cached yet. */
export async function fetchDetails(place: { id: string; lat: number; lng: number }, profile: Profile | null, load: boolean): Promise<DetailsResponse> {
  const url = `/api/discover/place?id=${encodeURIComponent(place.id)}&lat=${place.lat.toFixed(6)}&lng=${place.lng.toFixed(6)}${load ? '&load=1' : ''}&${goalQuery(profile)}`
  return read<DetailsResponse>(await fetch(url, { headers: headers(), signal: AbortSignal.timeout(30_000) }))
}

/** Seed-oil status of the restaurants around a point that have one (a sparse map: most places have none). */
export async function fetchSeedOilAround(c: { lat: number; lng: number }): Promise<Record<string, SeedOilView>> {
  const url = `/api/discover/seed-oil?south=${(c.lat - 0.022).toFixed(4)}&north=${(c.lat + 0.022).toFixed(4)}&west=${(c.lng - 0.033).toFixed(4)}&east=${(c.lng + 0.033).toFixed(4)}`
  return (await read<{ seedOil: Record<string, SeedOilView> }>(await fetch(url, { headers: headers() }))).seedOil
}

/** One tap: 1 "seed-oil free", -1 "uses seed oils", 0 takes the report back. The link is optional. */
export async function sendSeedOilReport(place: { id: string; lat: number; lng: number }, value: -1 | 0 | 1, sourceUrl?: string): Promise<SeedOilView> {
  const r = await fetch('/api/discover/seed-oil', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers() },
    body: JSON.stringify({ placeId: place.id, value, lat: place.lat, lng: place.lng, ...(sourceUrl ? { sourceUrl } : {}) }),
  })
  return read<SeedOilView>(r)
}
