import { beforeEach, describe, expect, it } from 'vitest'
import * as c from '../src/community-api.js'
import { deliveryConfidence, DELIVERY_RADIUS_M, hintPoints, orderUrl, osmDeliveryTags } from '../src/delivery.js'
import { parseOverpass } from '../src/overpass.js'
import { deliveryVote, DELIVERY_VOTE_LIMIT, handlePlace, handlePlaces, PLACES_SCHEMA, placeVotes } from '../src/places.js'
import type { Place } from '../src/types.js'
import { memoryD1 } from './d1-shim.js'

const el = (id: number, tags: Record<string, string>) => ({ type: 'node', id, lat: 52.5236, lon: 13.4031, tags: { amenity: 'restaurant', name: `R${id}`, ...tags } })

describe('OSM delivery parsing', () => {
  const places = parseOverpass({
    elements: [
      el(1, { delivery: 'yes', takeaway: 'yes', 'addr:postcode': '10119' }),
      el(2, { delivery: 'only' }),
      el(3, { delivery: 'no', takeaway: 'only' }),
      el(4, { 'delivery:partner': 'wolt', brand: 'dean&david' }),
      el(5, { 'delivery:covid19': 'no', delivery: 'maybe' }),
      el(6, { 'addr:postcode': 'Berlin' }),
      el(7, { delivery: ' YES ' }),
    ],
  })
  const byId = (id: string) => places.find((p) => p.id === id)!

  it('reads delivery and takeaway as yes, only or no; anything else is unknown', () => {
    expect(byId('n1')).toMatchObject({ delivery: 'yes', takeaway: 'yes' })
    expect(byId('n2').delivery).toBe('only')
    expect(byId('n3')).toMatchObject({ delivery: 'no', takeaway: 'only' })
    expect(byId('n5').delivery).toBeNull()
    expect(byId('n7').delivery).toBe('yes')
  })

  it('keeps the first positive delivery:* tag as a hint and the brand', () => {
    expect(byId('n4')).toMatchObject({ deliveryHint: 'delivery:partner=wolt', brand: 'dean&david', delivery: null })
    expect(byId('n5').deliveryHint).toBeNull()
  })

  it('keeps only real five-digit postcodes', () => {
    expect(byId('n1').postcode).toBe('10119')
    expect(byId('n6').postcode).toBeNull()
  })

  it('always sets the fields, so old cached lists can be told apart', () => {
    for (const p of places) expect('delivery' in p).toBe(true)
    expect(osmDeliveryTags({})).toEqual({ delivery: null, takeaway: null, deliveryHint: null, brand: null, postcode: null })
  })
})

const place = (over: Partial<Place> = {}): Place => ({ id: 'n1', name: 'X', lat: 52.52, lng: 13.4, kind: 'restaurant', cuisine: null, address: null, vegan: null, vegetarian: null, ...over })

describe('delivery confidence', () => {
  it('says "Delivers (OSM)" only for a delivery tag', () => {
    expect(deliveryConfidence(place({ delivery: 'yes' }), 800).level).toBe('osm')
    expect(deliveryConfidence(place({ delivery: 'only' }), null).label).toBe('Delivers (OSM)')
    expect(deliveryConfidence(place({ kind: 'fast_food', brand: 'Burger King', takeaway: 'yes' }), 500).level).toBe('likely')
  })

  it('calls hints "Likely delivers", never a guarantee, and explains why', () => {
    const c1 = deliveryConfidence(place({ kind: 'fast_food' }), 1200)
    expect(c1).toMatchObject({ level: 'likely', label: 'Likely delivers' })
    expect(c1.reason).toMatch(/guess/i)
    expect(c1.reason).toContain('1.2 km')
    expect(deliveryConfidence(place({ deliveryHint: 'delivery:partner=wolt' }), 300).level).toBe('likely')
  })

  it('shows nothing for a plain restaurant or café without hints', () => {
    expect(deliveryConfidence(place(), 300).level).toBe('none')
    expect(deliveryConfidence(place({ kind: 'cafe', takeaway: 'yes' }), 300).level).toBe('none')
    expect(deliveryConfidence(place(), 300).label).toBe('')
  })

  it('drops hints beyond the delivery radius but keeps an OSM tag', () => {
    const far = DELIVERY_RADIUS_M + 500
    expect(deliveryConfidence(place({ kind: 'fast_food' }), far).level).toBe('none')
    expect(deliveryConfidence(place({ kind: 'fast_food' }), far).reason).toMatch(/too far/)
    expect(deliveryConfidence(place({ delivery: 'yes' }), far).level).toBe('osm')
  })

  it('respects delivery=no', () => {
    expect(deliveryConfidence(place({ delivery: 'no', kind: 'fast_food' }), 200).level).toBe('none')
  })

  it('caps hints so they never outweigh a real tag', () => {
    expect(hintPoints(place({ kind: 'fast_food', deliveryHint: 'delivery:partner=x', brand: 'B', takeaway: 'yes' }))).toBe(3)
  })

  it('community votes strengthen the badge', () => {
    expect(deliveryConfidence(place(), 300, { yes: 1, no: 0 }).level).toBe('none')
    expect(deliveryConfidence(place(), 300, { yes: 2, no: 0 })).toMatchObject({ level: 'confirmed', label: 'Delivers · 2 confirmed' })
    expect(deliveryConfidence(place({ kind: 'fast_food' }), 300, { yes: 2, no: 0 }).level).toBe('confirmed')
    // A restaurant OSM says does not deliver needs a clear majority to flip.
    expect(deliveryConfidence(place({ delivery: 'no' }), 300, { yes: 4, no: 0 }).level).toBe('none')
    expect(deliveryConfidence(place({ delivery: 'no' }), 300, { yes: 8, no: 0 }).level).toBe('confirmed')
  })

  it('community votes weaken the badge', () => {
    expect(deliveryConfidence(place({ delivery: 'yes' }), 300, { yes: 0, no: 2 }).level).toBe('likely')
    expect(deliveryConfidence(place({ delivery: 'yes' }), 300, { yes: 0, no: 4 }).level).toBe('none')
    expect(deliveryConfidence(place({ kind: 'fast_food' }), 300, { yes: 0, no: 1 }).level).toBe('none')
    expect(deliveryConfidence(place({ kind: 'fast_food', brand: 'B' }), 300, { yes: 0, no: 1 }).level).toBe('likely')
    expect(deliveryConfidence(place(), 300, { yes: 1, no: 3 }).reason).toMatch(/does not deliver/)
  })
})

describe('order links', () => {
  const p = { name: 'dean&david', lat: 52.5235038, lng: 13.398912 }
  it('builds the verified search URLs with the name encoded', () => {
    expect(orderUrl('wolt', p)).toBe('https://wolt.com/de/deu/berlin/search?q=dean%26david')
    expect(orderUrl('lieferando', p)).toBe('https://www.lieferando.de/lieferservice/essen/berlin-10178?search=dean%26david')
    expect(orderUrl('lieferando', { ...p, postcode: '10999' })).toContain('/berlin-10999?search=')
    expect(orderUrl('lieferando', { ...p, postcode: '80331' })).toContain('/berlin-10178?')
  })
  it('gives Uber Eats the restaurant position so the search is local', () => {
    const u = new URL(orderUrl('ubereats', p))
    expect(u.origin + u.pathname).toBe('https://www.ubereats.com/de/search')
    expect(u.searchParams.get('q')).toBe('dean&david')
    const loc = JSON.parse(decodeURIComponent(atob(u.searchParams.get('pl')!)))
    expect(loc).toMatchObject({ latitude: 52.5235, longitude: 13.39891 })
  })
  it('does not send restaurants in other cities to Berlin searches', () => {
    for (const provider of ['wolt', 'lieferando', 'ubereats'] as const) {
      expect(orderUrl(provider, { ...p, lat: 53.55, lng: 10.0 })).not.toContain('berlin')
    }
  })
})

describe('community delivery votes (D1)', () => {
  let db: ReturnType<typeof memoryD1>
  const at = { lat: 52.5235, lng: 13.3989 }
  beforeEach(async () => {
    db = memoryD1()
    for (const sql of [...PLACES_SCHEMA, ...c.COMMUNITY_SCHEMA]) await db.prepare(sql).run()
  })

  it('counts one vote per device and lets it change or take it back', async () => {
    const r1 = await deliveryVote(db, { placeId: 'n1', value: 1, ...at }, 'device-aaaa', false)
    expect(r1).toEqual({ ok: true, data: { yes: 1, no: 0, myVote: 1 } })
    await deliveryVote(db, { placeId: 'n1', value: 1, ...at }, 'device-aaaa', false)
    expect(await placeVotes(db, 'n1', 'device-aaaa')).toEqual({ yes: 1, no: 0, myVote: 1 })
    await deliveryVote(db, { placeId: 'n1', value: -1, ...at }, 'device-aaaa', false)
    await deliveryVote(db, { placeId: 'n1', value: 1, ...at }, 'device-bbbb', false)
    expect(await placeVotes(db, 'n1', 'device-bbbb')).toEqual({ yes: 1, no: 1, myVote: 1 })
    await deliveryVote(db, { placeId: 'n1', value: 0, ...at }, 'device-bbbb', false)
    expect(await placeVotes(db, 'n1', null)).toEqual({ yes: 0, no: 1, myVote: 0 })
  })

  it('rejects bad input and missing devices', async () => {
    expect((await deliveryVote(db, { placeId: 'n1', value: 1, ...at }, null, false)).ok).toBe(false)
    expect((await deliveryVote(db, { placeId: 'x1', value: 1, ...at }, 'device-aaaa', false)).ok).toBe(false)
    expect((await deliveryVote(db, { placeId: 'n1', value: 2, ...at }, 'device-aaaa', false)).ok).toBe(false)
    expect((await deliveryVote(db, { placeId: 'n1', value: 1 }, 'device-aaaa', false)).ok).toBe(false)
  })

  it('rate-limits a device', async () => {
    for (let i = 0; i < DELIVERY_VOTE_LIMIT.max; i++) await deliveryVote(db, { placeId: `n${i + 10}`, value: 1, ...at }, 'device-spam', false)
    const r = await deliveryVote(db, { placeId: 'n999', value: 1, ...at }, 'device-spam', false)
    expect(r).toMatchObject({ ok: false, status: 429 })
  })

  it('shows the votes on the map list and in the restaurant sheet', async () => {
    await db.prepare('INSERT INTO overpass_cache (key, ts, lat, lng, body) VALUES (?, ?, ?, ?, ?)').bind('5252:893', Date.now(), 52.52, 13.395, JSON.stringify([place({ id: 'n1', lat: at.lat, lng: at.lng, kind: 'fast_food', delivery: null })])).run()
    await deliveryVote(db, { placeId: 'n1', value: 1, ...at }, 'device-aaaa', false)
    await deliveryVote(db, { placeId: 'n1', value: 1, ...at }, 'device-bbbb', false)
    const list = await handlePlaces(new URL('http://x/api/places?lat=52.5235&lng=13.3989'), db, () => {})
    expect(list!.source).toBe('cache')
    expect(list!.deliveryVotes['n1']).toEqual({ yes: 2, no: 0 })
    const one = await handlePlace(new URL('http://x/api/place?id=n1'), db, 'device-aaaa')
    expect(one!.votes).toEqual({ yes: 2, no: 0, myVote: 1 })
  })

  it('tags community posts with the restaurant badge and filters "Delivers"', async () => {
    await db.prepare('INSERT INTO overpass_cache (key, ts, lat, lng, body) VALUES (?, ?, ?, ?, ?)').bind('5252:893', Date.now(), 52.52, 13.395, JSON.stringify([
      place({ id: 'n1', lat: at.lat, lng: at.lng, delivery: 'yes' }),
      place({ id: 'n2', lat: at.lat, lng: at.lng }),
    ])).run()
    const v = { device: 'device-poster', team: false }
    const post = (over: Record<string, unknown>) => c.createPost(db, { nickname: 'tester', community: 'Mitte', kind: 'text', title: 'A long enough title', ...over }, v)
    const a = await post({ place: { id: 'n1', name: 'Delivers', ...at } })
    await post({ place: { id: 'n2', name: 'Sit-down only', ...at } })
    await post({ community: 'Delivery', title: 'Delivery question here' })
    const b = await post({ kind: 'order', title: 'Delivered bowl, nice', via: 'wolt', place: { id: 'n2', name: 'Sit-down only', ...at }, dish: { name: 'Bowl', kcalLow: 400, kcalHigh: 500, protein: 30 } })
    const bad = await post({ kind: 'order', title: 'Bad platform tag', via: 'telegram', dish: { name: 'Bowl', kcalLow: 400, kcalHigh: 500, protein: 30 } })
    expect(a.ok && a.data.delivery).toEqual({ level: 'osm', label: 'Delivers (OSM)' })
    expect(b.ok && b.data.via).toBe('wolt')
    expect(bad.ok && bad.data.via).toBeNull()
    const all = await c.listPosts(db, new URL('http://x/api/feed?sort=new'), v)
    expect(all).toHaveLength(5)
    const only = await c.listPosts(db, new URL('http://x/api/feed?sort=new&delivers=1'), v)
    expect(only.map((p) => p.title).sort()).toEqual(['A long enough title', 'Delivered bowl, nice', 'Delivery question here'].sort())
    expect(only.find((p) => p.place?.name === 'Sit-down only' && p.kind === 'text')).toBeUndefined()
  })
})
