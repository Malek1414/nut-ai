import { beforeEach, describe, expect, it, vi } from 'vitest'
import { attachScan, fitScore, handlePlace, handlePlaces, parsePriceEur, PLACES_SCHEMA } from '../src/places.js'
import * as overpass from '../src/overpass.js'
import { SEED_SQL } from '../src/seed.js'
import { nearbyPick } from '../src/nearby-pick.js'
import { memoryD1 } from './d1-shim.js'

const dish = (name: string, mid: number, protein: number, extra: Record<string, unknown> = {}) => ({
  name, translated: name, kcal: { low: mid * 0.8, mid, high: mid * 1.2 }, protein, carbs: 40, fat: 20, fiber: 4, price: '9,50 €', vegetarian: false, vegan: false, ...extra,
})
const place = { id: 'n123', name: 'Testimbiss', lat: 52.52, lng: 13.40, kind: 'fast_food', cuisine: 'Kebab' }

let db: ReturnType<typeof memoryD1>
beforeEach(async () => {
  db = memoryD1()
  for (const sql of [...PLACES_SCHEMA, ...SEED_SQL]) await db.prepare(sql).run()
  // A cached area, so handlePlaces never calls Overpass in tests.
  await db.prepare('INSERT INTO overpass_cache (key, ts, lat, lng, body) VALUES (?, ?, ?, ?, ?)')
    .bind('5252:893', Date.now(), 52.52, 13.395, JSON.stringify([{ id: 'n123', name: 'Testimbiss', lat: 52.52, lng: 13.4, kind: 'fast_food', cuisine: 'Kebab', delivery: null, hours: null, address: null, vegan: null, vegetarian: null }])).run()
  await db.prepare('INSERT INTO overpass_cache (key, ts, lat, lng, body) VALUES (?, ?, ?, ?, ?)').bind('5252:894', Date.now(), 52.52, 13.41, '[]').run()
})

describe('attachScan', () => {
  it('files valid dishes under the restaurant and skips broken ones', async () => {
    const out = await attachScan(db, { scanId: 's1', place, dishes: [dish('Döner Teller', 700, 40), dish('Broken', 500, 20, { kcal: { low: 600, mid: 500, high: 700 } }), { name: '' }] }, 'dev-1', false)
    expect(out).toMatchObject({ ok: true, attached: 1, place: { ...place, verified: true } })
    const res = await handlePlace(new URL('http://x/api/place?id=n123&goal=build_muscle'), db)
    expect(res!.dishes.map((d) => d.name)).toEqual(['Döner Teller'])
    expect(res!.dishes[0]!.example).toBe(false)
    expect(res!.dishes[0]!.priceEur).toBe(9.5)
  })

  it('keeps allergen hints for map recommendations and does not file drinks or desserts', async () => {
    const out = await attachScan(db, { scanId: 's1', place, dishes: [
      dish('House special', 500, 50, { course: 'main', allergens: ['milk'] }),
      dish('Veg plate', 500, 25, { course: 'main', vegetarian: true }),
      dish('Chocolate cake', 400, 6, { course: 'dessert' }),
      dish('Beer', 150, 0, { course: 'drink' }),
    ] }, 'dev-1', false)
    expect(out).toMatchObject({ ok: true, attached: 2 })
    const url = new URL('http://x/api/place?id=n123&goal=build_muscle')
    expect((await handlePlace(url, db))!.dishes.map((d) => d.name)).toEqual(['House special', 'Veg plate'])
    expect((await handlePlace(url, db, null, 'milk'))!.dishes.map((d) => d.name)).toEqual(['Veg plate'])
    expect((await nearbyPick(db, { ...place, message: 'High protein with no dairy' }))?.match?.results[0]?.pick?.dish.name).not.toBe('House special')
  })

  it('rejects a missing or malformed restaurant', async () => {
    expect((await attachScan(db, { scanId: 's1', place: { ...place, id: 'DROP TABLE' }, dishes: [dish('A', 500, 30)] }, null, false)).ok).toBe(false)
    expect((await attachScan(db, { scanId: 's1', dishes: [dish('A', 500, 30)] }, null, false)).ok).toBe(false)
    expect((await attachScan(db, { scanId: 's1', place, dishes: [] }, null, false)).ok).toBe(false)
  })

  it('keeps the latest scan of the same dish only once', async () => {
    await attachScan(db, { scanId: 's1', place, dishes: [dish('Salat', 400, 30)] }, null, false)
    await attachScan(db, { scanId: 's2', place, dishes: [dish('Salat', 420, 35)] }, null, false)
    const res = await handlePlace(new URL('http://x/api/place?id=n123'), db)
    expect(res!.dishes).toHaveLength(1)
    expect(res!.dishes[0]!.protein).toBe(35)
  })
})

describe('handlePlaces', () => {
  it('returns cached OpenStreetMap places plus the best dish for the viewer goal', async () => {
    await attachScan(db, { scanId: 's1', place, dishes: [dish('Pommes', 600, 7, { vegan: true, vegetarian: true }), dish('Hähnchen Teller', 650, 48)] }, null, false)
    const muscle = await handlePlaces(new URL('http://x/api/places?lat=52.5201&lng=13.4001&goal=build_muscle'), db, () => {})
    expect(muscle!.source).toBe('cache')
    expect(muscle!.places.find(p => p.id === place.id)?.verified).toBe(true)
    expect(muscle!.scored['n123']!.best.name).toBe('Hähnchen Teller')
    const vegan = await handlePlaces(new URL('http://x/api/places?lat=52.5201&lng=13.4001&goal=plant_based'), db, () => {})
    expect(vegan!.scored['n123']!.best.name).toBe('Pommes')
  })

  it('keeps a verified dish visible after its OSM cache expires without offering the pin for attachment', async () => {
    await attachScan(db, { scanId: 's1', place, dishes: [dish('Salat', 400, 30)] }, null, false)
    db.raw.prepare('UPDATE overpass_cache SET body=? WHERE key=?').run('[]', '5252:893')
    const list = await handlePlaces(new URL('http://x/api/places?lat=52.52&lng=13.4'), db, () => {})
    expect(list?.places.find(p => p.id === place.id)).toMatchObject({ name: place.name, verified: false })
    expect(list?.scored[place.id]?.best.name).toBe('Salat')
  })

  it('serves stale data repeatedly during an outage while refreshing only once', async () => {
    const a = overpass.areaFor(48.86, 2.35)
    await db.prepare('INSERT INTO overpass_cache VALUES (?,?,?,?,?)')
      .bind(a.key, Date.now() - 8 * 86400_000, a.lat, a.lng, '[]').run()
    const request = vi.spyOn(overpass, 'fetchOverpass').mockRejectedValue(new Error('unavailable'))
    try {
      const pending: Promise<unknown>[] = []
      const url = new URL('http://x/api/places?lat=48.86&lng=2.35')
      for (let i = 0; i < 2; i++) {
        expect((await handlePlaces(url, db, p => pending.push(p)))?.source).toBe('stale')
        await Promise.all(pending)
      }
      expect(request).toHaveBeenCalledTimes(1)
    } finally { request.mockRestore() }
  })

  it('shows the labelled example places from the seed', async () => {
    const out = await handlePlaces(new URL('http://x/api/places?lat=52.5235&lng=13.404&goal=lose_fat'), db, () => {})
    const examples = Object.values(out!.scored).filter((s) => s.example)
    expect(examples.length).toBeGreaterThanOrEqual(5)
    expect(out!.places.find(p => p.id === 'n975312181')?.verified).toBe(false)
    expect(out!.attribution).toMatch(/OpenStreetMap/)
  })

  it('uses an independent diet and goal together', async () => {
    await attachScan(db, { scanId: 's1', place, dishes: [
      dish('Chicken plate', 550, 46),
      dish('Chickpea rice', 550, 27, { vegan: true, vegetarian: true }),
    ] }, null, false)
    const out = await handlePlaces(new URL('http://x/api/places?lat=52.5201&lng=13.4001&goal=build_muscle&diet=vegan'), db, () => {})
    expect(out?.scored['n123']?.best.name).toBe('Chickpea rice')
  })

  it('rejects a bad position', async () => {
    expect(await handlePlaces(new URL('http://x/api/places?lat=abc&lng=13'), db, () => {})).toBeNull()
  })
})

describe('nearby voice or text request', () => {
  it('uses real menu rows, parsed constraints and a deterministic reason', async () => {
    await attachScan(db, { scanId: 's1', place, dishes: [
      dish('Chicken', 600, 50, { price: '10 €' }),
      dish('Tofu rice', 550, 32, { price: '14 €', vegetarian: true, vegan: true }),
      dish('Tofu special', 550, 55, { price: '18 €', vegetarian: true, vegan: true }),
    ] }, null, false)
    const answer = await nearbyPick(db, { ...place, message: 'High protein under fifteen euros', profile: { diet: 'vegan' } })
    expect(answer?.area).toBe('local')
    expect(answer?.match?.place.id).toBe(place.id)
    expect(answer?.match?.results[0]?.pick).toMatchObject({ dish: { name: 'Tofu rice', example: false }, checks: ['vegan', 'within budget'], why: expect.any(String) })
  })

  it('does not silently substitute Berlin or make up a match', async () => {
    expect(await nearbyPick(db, { message: 'high protein' })).toBeNull()
    expect(await nearbyPick(db, { message: 'something halal', example: true })).toMatchObject({ match: null, reason: 'not_understood' })
    expect(await nearbyPick(db, { message: 'high protein', lat: 48.85, lng: 2.35 })).toMatchObject({ area: 'local', reason: 'no_data', match: null })
    expect(await nearbyPick(db, { message: 'under 1 euro', example: true })).toMatchObject({ area: 'berlin', reason: 'no_fit', match: null })
    expect((await nearbyPick(db, { message: 'high protein', example: true }))?.match?.example).toBe(true)
  })
})

describe('helpers', () => {
  it('reads European and plain prices', () => {
    expect(parsePriceEur('10,50 €')).toBe(10.5)
    expect(parsePriceEur('€ 7.9')).toBe(7.9)
    expect(parsePriceEur('12')).toBe(12)
    expect(parsePriceEur('market price')).toBeNull()
    expect(parsePriceEur('$10')).toBeNull()
    expect(parsePriceEur('10–18 €')).toBeNull()
  })
  it('squashes goal scores into 1-99', () => {
    expect(fitScore(-200, 'lose_fat')).toBe(1)
    expect(fitScore(500, 'build_muscle')).toBe(99)
    expect(fitScore(60, 'lose_fat')).toBeGreaterThan(fitScore(20, 'lose_fat'))
  })
})
