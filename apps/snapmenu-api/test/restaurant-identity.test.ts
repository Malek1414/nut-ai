import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import worker from '../src/index.js'
import { areaFor } from '../src/overpass.js'
import type { Place, PlacesResponse, PostView } from '../src/types.js'
import { memoryD1 } from './d1-shim.js'

describe('public restaurant identity', () => {
  const DB = memoryD1()
  let scanId: string
  let device: string
  const restaurant: Place = {
    id: 'w123', name: 'OSM Restaurant', lat: 52.52, lng: 13.4, kind: 'cafe', cuisine: 'Italian',
    address: null, vegan: null, vegetarian: null, delivery: null,
  }
  const dish = { id: 'd1', name: 'Bean soup', kcal: { low: 200, mid: 260, high: 320 }, carbs: 40, fat: 4, protein: 13 }
  const at = areaFor(restaurant.lat, restaurant.lng)
  const call = (path: string, body?: unknown) => worker.fetch(new Request('https://test.local' + path, {
    method: body === undefined ? 'GET' : 'POST', headers: device ? { 'x-device': device } : {},
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), { DB })
  const order = (place: unknown) => call('/api/posts', {
    kind: 'order', community: 'Mitte', title: 'My lunch order', nickname: 'SoupFan',
    scanId, scanDevice: device, dishId: dish.id, place,
  })
  const attach = (place: unknown) => call('/api/scan/attach', { scanId, deviceId: device, place })

  beforeAll(async () => {
    await call('/api/communities')
    DB.raw.exec('CREATE TABLE scan_records (id TEXT PRIMARY KEY, device TEXT, ts INTEGER, body TEXT)')
    DB.raw.prepare('INSERT INTO overpass_cache VALUES (?,?,?,?,?)').run(at.key, Date.now(), at.lat, at.lng, JSON.stringify([{ ...restaurant, hours: null }]))
  })

  beforeEach(() => {
    scanId = crypto.randomUUID()
    device = crypto.randomUUID()
    DB.raw.prepare('INSERT INTO scan_records VALUES (?,?,?,?)').run(scanId, device, Date.now(), JSON.stringify({ goal: 'balanced', dishes: [dish] }))
  })

  it.each([
    ['unknown OSM ID', { ...restaurant, id: 'n987654' }],
    ['seed-only OSM ID', { ...restaurant, id: 'n975312181' }],
    ['coordinates 500 m away in the same cached area', { ...restaurant, lat: restaurant.lat + 0.0045 }],
    ['missing coordinates', { id: restaurant.id, name: restaurant.name }],
  ])('keeps a scan private for a %s in both public writes', async (_label, place) => {
    for (const response of [await attach(place), await order(place)]) {
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ error: { code: 'unverified_place' } })
    }
    expect(DB.raw.prepare('SELECT count(*) AS n FROM place_dishes WHERE scan_id=?').get(scanId)?.['n']).toBe(0)
    expect(DB.raw.prepare('SELECT count(*) AS n FROM posts WHERE device=?').get(device)?.['n']).toBe(0)
    expect(DB.raw.prepare('SELECT count(*) AS n FROM scan_records WHERE id=?').get(scanId)?.['n']).toBe(1)
  })

  it('uses the cached restaurant even when submitted labels differ and coordinates are rounded', async () => {
    const input = { ...restaurant, lat: restaurant.lat + 0.0001, name: 'Old label', kind: 'fast_food', cuisine: 'French' }
    const attached = await attach(input)
    expect(attached.status).toBe(200)
    expect(await attached.json()).toMatchObject({ attached: 1, place: { ...restaurant, verified: true } })
    expect(DB.raw.prepare('SELECT place_id,place_name,kind,cuisine,lat,lng,osm_verified FROM place_dishes WHERE scan_id=?').get(scanId))
      .toEqual({ place_id: restaurant.id, place_name: restaurant.name, kind: restaurant.kind, cuisine: restaurant.cuisine, lat: restaurant.lat, lng: restaurant.lng, osm_verified: 1 })

    const posted = await order(input)
    expect(posted.status).toBe(200)
    expect((await posted.json() as PostView).place).toEqual({ id: restaurant.id, name: restaurant.name, lat: restaurant.lat, lng: restaurant.lng })
    expect((await order(null)).status).toBe(200)
  })

  it('keeps older unverified map dishes and order locations out of public reads', async () => {
    DB.raw.exec(`INSERT INTO place_dishes (place_id,place_name,lat,lng,scan_id,ts,name,kcal_low,kcal_mid,kcal_high,protein,carbs,fat)
      VALUES ('n456','Legacy label',52.52,13.4,'legacy',1,'Legacy dish',1,1,1,1,1,1);
      INSERT INTO posts (id,ts,device,nickname,community,kind,title,place_id,place_name,place_lat,place_lng)
      VALUES ('legacy-post',1,'older-device','Member','Mitte','order','Lunch today','n456','Legacy label',52.52,13.4)`)
    const list = await (await call('/api/places?lat=52.52&lng=13.4')).json() as PlacesResponse
    expect(list.places.some(p => p.id === 'n456')).toBe(false)
    expect(list.scored['n456']).toBeUndefined()
    expect(await (await call('/api/place?id=n456')).json()).toMatchObject({ dishes: [] })
    expect(await (await call('/api/post?id=legacy-post')).json()).toMatchObject({ post: { place: null } })
    expect(await (await call('/api/feed?place=n456')).json()).toMatchObject({ posts: [] })
  })

  it('requires a cache record within the retention window', async () => {
    const mock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61 * 24 * 60 * 60_000)
    try { expect((await attach(restaurant)).status).toBe(400) } finally { mock.mockRestore() }
  })
})
