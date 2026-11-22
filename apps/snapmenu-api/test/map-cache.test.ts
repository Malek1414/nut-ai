import { afterEach, expect, it, vi } from 'vitest'
import { cachedPlaces, fetchPlaces, forgetPlaces } from '../../snapmenu-web/src/lib/places'
import type { PlacesResponse, Profile } from '../src/types'

const lat = 52.52
const lng = 13.4
const area: PlacesResponse = {
  center: { lat, lng }, source: 'cache', updatedAt: 1, attribution: 'OpenStreetMap',
  places: [{ id: 'n42', verified: true, name: 'Corner café', lat, lng, kind: 'cafe', cuisine: null,
    address: null, vegan: null, vegetarian: null }],
  scored: {}, deliveryVotes: {},
}
const profile: Profile = { goal: 'balanced', allergies: [], language: 'English' }

afterEach(() => {
  forgetPlaces()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('restores nearby places during a service or network outage, scoped to diet, restrictions and area', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json(area))
  vi.stubGlobal('fetch', fetch)
  await fetchPlaces(lat, lng, profile)
  fetch.mockResolvedValueOnce(Response.json({ ...area, places: [], source: 'unavailable' }))
  expect(await fetchPlaces(lat + 0.001, lng, profile)).toMatchObject({ source: 'stale', places: area.places })
  fetch.mockRejectedValue(new Error('offline'))
  expect((await fetchPlaces(lat, lng, profile)).places).toEqual(area.places)
  expect(cachedPlaces(lat, lng, { ...profile, diet: 'vegan' })).toBeNull()
  expect(cachedPlaces(lat, lng, { ...profile, allergies: ['milk'] })).toBeNull()
  expect(cachedPlaces(lat + 1, lng, profile)).toBeNull()
  vi.useFakeTimers()
  vi.setSystemTime(Date.now() + 8 * 86400_000)
  expect(cachedPlaces(lat, lng, profile)).toBeNull()
})
