import { describe, expect, it } from 'vitest'
import { areaFor, buildQuery, fetchOverpass, parseOverpass } from '../src/overpass.js'

const sample = {
  version: 0.6,
  elements: [
    { type: 'node', id: 975312181, lat: 52.5226768, lon: 13.4011539, tags: { amenity: 'fast_food', name: "Mustafa's Can Gemüse Kebap", cuisine: 'kebab' } },
    { type: 'way', id: 4242, center: { lat: 52.5240, lon: 13.4050 }, tags: { amenity: 'restaurant', name: 'Lee', cuisine: 'vietnamese;asian', 'addr:street': 'Rosenthaler Straße', 'addr:housenumber': '9', 'diet:vegan': 'yes' } },
    { type: 'node', id: 1, lat: 52.52, lon: 13.40, tags: { amenity: 'restaurant' } },
    { type: 'node', id: 2, lat: 52.52, lon: 13.40, tags: { amenity: 'bar', name: 'A bar' } },
    { type: 'node', id: 3, tags: { amenity: 'cafe', name: 'No coordinates' } },
    { type: 'node', id: 975312181, lat: 52.5226768, lon: 13.4011539, tags: { amenity: 'fast_food', name: 'Duplicate' } },
    { type: 'node', id: 5, lat: 52.60, lon: 13.50, tags: { amenity: 'cafe', name: '  Far Café  ', 'diet:vegetarian': 'only' } },
    null,
    'junk',
  ],
}

describe('parseOverpass', () => {
  it('keeps named restaurants, fast food and cafés with coordinates, once each', () => {
    const places = parseOverpass(sample)
    expect(places.map((p) => p.id)).toEqual(['n975312181', 'w4242', 'n5'])
  })

  it('reads way centres, addresses, cuisines and diet tags', () => {
    const lee = parseOverpass(sample).find((p) => p.id === 'w4242')!
    expect(lee).toMatchObject({ name: 'Lee', lat: 52.524, lng: 13.405, kind: 'restaurant', cuisine: 'Vietnamese, Asian', address: 'Rosenthaler Straße 9', vegan: 'yes', vegetarian: null })
    const far = parseOverpass(sample).find((p) => p.id === 'n5')!
    expect(far.name).toBe('Far Café')
    expect(far.vegetarian).toBe('only')
  })

  it('sorts nearest first and caps the list', () => {
    const near = { lat: 52.6, lng: 13.5 }
    expect(parseOverpass(sample, near)[0]!.id).toBe('n5')
    expect(parseOverpass(sample, near, 1)).toHaveLength(1)
  })

  it('survives garbage', () => {
    expect(parseOverpass(null)).toEqual([])
    expect(parseOverpass({ elements: 'x' })).toEqual([])
    expect(parseOverpass('<html>busy</html>')).toEqual([])
  })
})

describe('areaFor', () => {
  it('snaps nearby positions to one shared cache key', () => {
    expect(areaFor(52.5236, 13.4031).key).toBe(areaFor(52.5221, 13.4062).key)
    expect(areaFor(52.5236, 13.4031).key).not.toBe(areaFor(52.4977, 13.4108).key)
  })

  it('always keeps the user well inside the queried box', () => {
    for (const [lat, lng] of [[52.5236, 13.4031], [52.5149, 13.3974], [52.4977, 13.4108], [48.137, 11.575]] as const) {
      const a = areaFor(lat, lng)
      expect(lat - a.south).toBeGreaterThan(0.006)
      expect(a.north - lat).toBeGreaterThan(0.006)
      expect(lng - a.west).toBeGreaterThan(0.01)
      expect(a.east - lng).toBeGreaterThan(0.01)
    }
  })

  it('builds a bounded query for the three amenity types', () => {
    const q = buildQuery(areaFor(52.5236, 13.4031))
    expect(q).toContain('[out:json]')
    expect(q).toContain('restaurant|fast_food|cafe')
    expect(q).toMatch(/\(52\.508,13\.392,52\.532,13\.428\)/)
  })
})

describe('fetchOverpass', () => {
  it('sends a generic User-Agent and falls through to a mirror when the main server is busy', async () => {
    const calls: Array<{ url: string; ua: string | null }> = []
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, ua: new Headers(init.headers).get('user-agent') })
      if (calls.length === 1) return new Response('busy', { status: 429 })
      return new Response(JSON.stringify(sample), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch
    const places = await fetchOverpass(areaFor(52.5236, 13.4031), fake)
    expect(places.length).toBe(3)
    expect(calls).toHaveLength(2)
    expect(calls[0]!.url).toContain('overpass-api.de')
    expect(calls[1]!.url).not.toContain('overpass-api.de')
    expect(calls[0]!.ua).toMatch(/^Snapmenu\//)
    expect(calls[0]!.ua).not.toMatch(/@/)
  }, 10_000)
})
