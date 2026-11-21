import { beforeEach, describe, expect, it } from 'vitest'
import { attachScan, fitScore, handlePlace, handlePlaces, parsePriceEur, PLACES_SCHEMA } from '../src/places.js'
import { SEED_SQL } from '../src/seed.js'
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
    .bind('5252:893', Date.now(), 52.52, 13.395, JSON.stringify([{ id: 'n123', name: 'Testimbiss', lat: 52.52, lng: 13.4, kind: 'fast_food', cuisine: 'Kebab', address: null, vegan: null, vegetarian: null }])).run()
  await db.prepare('INSERT INTO overpass_cache (key, ts, lat, lng, body) VALUES (?, ?, ?, ?, ?)').bind('5252:894', Date.now(), 52.52, 13.41, '[]').run()
})

describe('attachScan', () => {
  it('files valid dishes under the restaurant and skips broken ones', async () => {
    const out = await attachScan(db, { scanId: 's1', place, dishes: [dish('Döner Teller', 700, 40), dish('Broken', 500, 20, { kcal: { low: 600, mid: 500, high: 700 } }), { name: '' }] }, 'dev-1', false)
    expect(out).toEqual({ ok: true, attached: 1 })
    const res = await handlePlace(new URL('http://x/api/place?id=n123&goal=build_muscle'), db)
    expect(res!.dishes.map((d) => d.name)).toEqual(['Döner Teller'])
    expect(res!.dishes[0]!.example).toBe(false)
    expect(res!.dishes[0]!.priceEur).toBe(9.5)
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
    expect(muscle!.scored['n123']!.best.name).toBe('Hähnchen Teller')
    const vegan = await handlePlaces(new URL('http://x/api/places?lat=52.5201&lng=13.4001&goal=plant_based'), db, () => {})
    expect(vegan!.scored['n123']!.best.name).toBe('Pommes')
  })

  it('shows the labelled example places from the seed', async () => {
    const out = await handlePlaces(new URL('http://x/api/places?lat=52.5235&lng=13.404&goal=lose_fat'), db, () => {})
    const examples = Object.values(out!.scored).filter((s) => s.example)
    expect(examples.length).toBeGreaterThanOrEqual(5)
    expect(out!.attribution).toMatch(/OpenStreetMap/)
  })

  it('rejects a bad position', async () => {
    expect(await handlePlaces(new URL('http://x/api/places?lat=abc&lng=13'), db, () => {})).toBeNull()
  })
})

describe('helpers', () => {
  it('reads European and plain prices', () => {
    expect(parsePriceEur('10,50 €')).toBe(10.5)
    expect(parsePriceEur('€ 7.9')).toBe(7.9)
    expect(parsePriceEur('12')).toBe(12)
    expect(parsePriceEur('market price')).toBeNull()
  })
  it('squashes goal scores into 1-99', () => {
    expect(fitScore(-200, 'lose_fat')).toBe(1)
    expect(fitScore(500, 'build_muscle')).toBe(99)
    expect(fitScore(60, 'lose_fat')).toBeGreaterThan(fitScore(20, 'lose_fat'))
  })
})
