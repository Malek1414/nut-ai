import { beforeEach, describe, expect, it } from 'vitest'
import { memoryD1 } from '../../test/d1-shim.js'
import { areaFor, parseOverpass } from '../overpass.js'
import { PLACES_SCHEMA } from '../places.js'
import { BERLIN_AREAS, inBerlin } from './areas.js'
import { communityDishConfidence, confidenceLabel, deliveryConfidenceOf, dishConfidence, hoursConfidence, reportedSeedOilFree, seedOilConfidence } from './confidence.js'
import { claimSlot, foldText, geocode, GEOCODE_USER_AGENT, MIN_GAP_MS, parseNominatim } from './geocode.js'
import { handleDiscover } from './index.js'
import { fullAddress, hasDetails, hostOf, osmDetailTags, phoneNumber, webUrl } from './osm-tags.js'
import { findPlace, loadElement, placeDetails, withKnown } from './place.js'
import { DISCOVER_SCHEMA } from './schema.js'
import { LIKE_MAX_BYTES, likePattern, matchRank, search, searchByName } from './search.js'
import { checkWebsite, isPrivateAddress, publicUrl, reportSeedOil, resolvesPublicly, SEED_OIL_LABEL, SEED_OIL_WEB_LABEL, seedOilFor, seedOilInBox, seedOilView, sourceLink, websiteDue } from './seed-oil.js'
import type { DetailsResponse, SearchResponse, SeedOilView } from './types.js'

const EVENTS = 'CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, type TEXT NOT NULL, device TEXT, team INTEGER NOT NULL DEFAULT 0, props TEXT)'

async function freshDb() {
  const db = memoryD1()
  for (const sql of [EVENTS, ...PLACES_SCHEMA, ...DISCOVER_SCHEMA]) await db.prepare(sql).run()
  return db
}

const MITTE = { lat: 52.5235, lng: 13.404 }
const viewer = (device: string | null = 'device-aaaa-1111') => ({ device, team: false, lang: 'English' as const })

/** One OSM element as Overpass returns it. */
const el = (id: number, name: string, tags: Record<string, string> = {}, lat = 52.5236, lng = 13.4041) => ({ type: 'node', id, lat, lon: lng, tags: { amenity: 'restaurant', name, ...tags } })

async function cacheArea(db: Awaited<ReturnType<typeof freshDb>>, elements: unknown[], at = MITTE, ts = Date.now()) {
  const a = areaFor(at.lat, at.lng)
  const places = parseOverpass({ elements }, at)
  await db.prepare('INSERT OR REPLACE INTO overpass_cache (key, ts, lat, lng, body) VALUES (?, ?, ?, ?, ?)').bind(a.key, ts, a.lat, a.lng, JSON.stringify(places)).run()
  return places
}

describe('OSM detail tags', () => {
  it('reads hours, website, phone and city, and keeps every key', () => {
    const d = osmDetailTags({ opening_hours: 'Mo-Fr 11:00-22:00', website: 'www.zola.example', 'contact:phone': '+49 30 1234567', 'addr:city': 'Berlin', 'check_date:opening_hours': '2026-08-01' })
    expect(d).toEqual({ hours: 'Mo-Fr 11:00-22:00', hoursChecked: '2026-08-01', website: 'https://www.zola.example/', menuUrl: null, phone: '+49 30 1234567', city: 'Berlin' })
    expect(Object.keys(osmDetailTags({}))).toEqual(['hours', 'hoursChecked', 'website', 'menuUrl', 'phone', 'city'])
    expect(hasDetails(osmDetailTags({}))).toBe(true)
    expect(hasDetails({ id: 'n1' })).toBe(false)
  })

  it('only keeps links a person may open', () => {
    expect(webUrl('https://example.de/menu')).toBe('https://example.de/menu')
    expect(webUrl('example.de;https://other.example')).toBe('https://example.de/')
    expect(webUrl('javascript:alert(1)')).toBeNull()
    expect(webUrl('https://user:pw@example.de')).toBeNull()
    expect(webUrl('ftp://example.de')).toBeNull()
    expect(webUrl('just words')).toBeNull()
    expect(webUrl(null)).toBeNull()
    expect(hostOf('https://www.example.de/a')).toBe('example.de')
    expect(phoneNumber('030 1234567; 030 7654321')).toBe('030 1234567')
    expect(phoneNumber('call us')).toBeNull()
  })

  it('travels with every place the map caches', () => {
    const [p] = parseOverpass({ elements: [el(7, 'Zola', { opening_hours: 'Mo-Su 12:00-22:00', website: 'https://zola.example', 'addr:street': 'Paul-Lincke-Ufer', 'addr:housenumber': '39', 'addr:postcode': '10999', 'addr:city': 'Berlin' })] })
    expect(p).toMatchObject({ id: 'n7', hours: 'Mo-Su 12:00-22:00', website: 'https://zola.example/', city: 'Berlin' })
    expect(fullAddress(p!)).toBe('Paul-Lincke-Ufer 39, 10999 Berlin')
    expect(fullAddress({ address: null, postcode: null })).toBeNull()
  })
})

describe('data confidence: one scale for everything', () => {
  const row = (isEstimate: boolean, grams = 100, kcal = 200) => ({ counted: true, isEstimate, grams, per100: { kcal } })

  it('follows the width of the engine range for a scanned dish', () => {
    expect(dishConfidence({ bandTier: 'tight' }).level).toBe('high')
    expect(dishConfidence({ bandTier: 'none' }).level).toBe('high')
    expect(dishConfidence({ bandTier: 'moderate' }).level).toBe('medium')
    expect(dishConfidence({ bandTier: 'wide' }).level).toBe('low')
    expect(dishConfidence({ bandTier: 'very_wide' }).level).toBe('low')
  })

  it('never calls a mostly estimated dish high, and always says why', () => {
    const c = dishConfidence({ bandTier: 'tight', rows: [row(true, 300), row(false, 50)], bandReasons: ['Grams follow a standard restaurant recipe.'] })
    expect(c.level).toBe('medium')
    expect(c.why.length).toBeGreaterThanOrEqual(2)
    expect(c.why.join(' ')).toContain('estimated')
    expect(dishConfidence({ bandTier: 'tight', rows: [row(false, 300), row(true, 20)] }).level).toBe('high')
    for (const tier of ['none', 'tight', 'moderate', 'wide', 'very_wide', 'anything']) expect(dishConfidence({ bandTier: tier }).why[0]).toBeTruthy()
    expect(confidenceLabel({ level: 'low' })).toBe('Low confidence')
  })

  it('rates a community dish by its range, its age and whether it is an example', () => {
    const now = Date.UTC(2026, 10, 22)
    const dish = (low: number, high: number, ts = now, example = false) => ({ example, ts, kcal: { low, mid: (low + high) / 2, high } })
    expect(communityDishConfidence(dish(540, 660), now).level).toBe('high')
    expect(communityDishConfidence(dish(450, 750), now).level).toBe('medium')
    expect(communityDishConfidence(dish(300, 900), now).level).toBe('low')
    expect(communityDishConfidence(dish(540, 660, now - 200 * 86_400_000), now).level).toBe('medium')
    expect(communityDishConfidence(dish(540, 660, now, true), now)).toEqual({ level: 'low', why: ['An example entry, not a real scan.'] })
  })

  it('rates hours, seed oils and delivery on the same scale', () => {
    const now = Date.UTC(2026, 10, 22)
    expect(hoursConfidence({ hours: null, understood: false }, now)).toBeNull()
    expect(hoursConfidence({ hours: 'Mo-Fr 10:00-20:00', understood: true }, now)?.level).toBe('medium')
    expect(hoursConfidence({ hours: 'Mo-Fr 10:00-20:00', understood: true, hoursChecked: '2026-09-01' }, now)?.level).toBe('high')
    expect(hoursConfidence({ hours: 'Mo-Fr 10:00-20:00', understood: true, hoursChecked: '2023-09-01' }, now)?.level).toBe('medium')
    expect(hoursConfidence({ hours: 'sunrise-sunset', understood: false }, now)?.level).toBe('low')

    expect(seedOilConfidence({ status: 'unknown', yes: 0, no: 0 })).toBeNull()
    expect(seedOilConfidence({ status: 'reported', yes: 3, no: 1 })).toMatchObject({ level: 'low' })
    expect(seedOilConfidence({ status: 'reported', yes: 3, no: 1 })!.why[0]).toBe('3 community reports, 1 against. Not verified.')
    expect(seedOilConfidence({ status: 'verified', yes: 0, no: 0 })?.level).toBe('medium')
    expect(reportedSeedOilFree({ status: 'verified' })).toBe(true)
    expect(reportedSeedOilFree({ status: 'unknown' })).toBe(false)
    expect(reportedSeedOilFree(null)).toBe(false)

    expect(deliveryConfidenceOf({ level: 'none', reason: '', yes: 0 })).toBeNull()
    expect(deliveryConfidenceOf({ level: 'likely', reason: 'A guess.', yes: 0 })?.level).toBe('low')
    expect(deliveryConfidenceOf({ level: 'osm', reason: 'Tagged.', yes: 0 })?.level).toBe('medium')
    expect(deliveryConfidenceOf({ level: 'confirmed', reason: 'People.', yes: 6 })?.level).toBe('high')
  })
})

describe('seed-oil status: reported, verified or unknown, never a fact', () => {
  const web = (claim: 'free' | 'uses' | null) => ({ url: 'https://zola.example/', claim, quote: claim ? 'We cook without seed oils.' : null, checkedAt: 1 })

  it('is unknown until someone other than us says so', () => {
    expect(seedOilView({})).toMatchObject({ status: 'unknown', label: '', source: 'No reports yet.' })
    expect(seedOilView({ web: web(null) }).source).toBe('No reports yet. Its website does not mention it.')
    expect(seedOilView({ yes: 1, no: 1 })).toMatchObject({ status: 'unknown', source: 'Reports disagree: 1 yes, 1 no.' })
    expect(seedOilView({ no: 2 })).toMatchObject({ status: 'unknown', source: '2 people reported seed oils here.' })
  })

  it('says "reported" for the community and "verified" only for the restaurant\'s own website', () => {
    const reported = seedOilView({ yes: 2, no: 1 })
    expect(reported).toMatchObject({ status: 'reported', label: SEED_OIL_LABEL, source: '2 people reported it, 1 disagreed. Not verified.' })
    expect(seedOilView({ web: web('free') })).toMatchObject({ status: 'verified', label: SEED_OIL_WEB_LABEL, source: 'Its own website says so.' })
    expect(seedOilView({ web: web('free'), yes: 1 }).source).toBe('Its own website says so, and 1 person reported it.')
    // Neither label states it as a fact: each names who says so.
    expect(SEED_OIL_LABEL).toBe('Reported seed-oil free')
    expect(SEED_OIL_WEB_LABEL).toBe('Website says seed-oil free')
  })

  it('lets neither source overrule a clear contradiction', () => {
    expect(seedOilView({ web: web('free'), no: 2 })).toMatchObject({ status: 'unknown', source: 'Its website says seed-oil free, but more people disagree.' })
    expect(seedOilView({ web: web('uses'), yes: 5 })).toMatchObject({ status: 'unknown', source: 'Its own website mentions cooking with seed oil.' })
  })

  it('accepts only real links as a source', () => {
    expect(sourceLink('https://example.de/menu')).toBe('https://example.de/menu')
    expect(sourceLink('javascript:alert(1)')).toBeNull()
    expect(sourceLink(42)).toBeNull()
    expect(sourceLink(`https://example.de/${'a'.repeat(400)}`)).toBeNull()
  })
})

describe('seed-oil reports in D1', () => {
  let db: Awaited<ReturnType<typeof freshDb>>
  beforeEach(async () => { db = await freshDb() })
  const report = (value: unknown, device = 'device-aaaa-1111', extra: Record<string, unknown> = {}) =>
    reportSeedOil(db, { placeId: 'n7', value, lat: 52.5236, lng: 13.4041, ...extra }, viewer(device))

  it('counts one report per device and takes it back on 0', async () => {
    expect(await report(1)).toMatchObject({ ok: true, data: { status: 'reported', yes: 1, no: 0, myReport: 1 } })
    expect(await report(1)).toMatchObject({ ok: true, data: { yes: 1 } })
    expect(await report(-1, 'device-bbbb-2222')).toMatchObject({ ok: true, data: { status: 'unknown', yes: 1, no: 1, myReport: -1 } })
    expect(await report(0, 'device-bbbb-2222')).toMatchObject({ ok: true, data: { status: 'reported', yes: 1, no: 0, myReport: 0 } })
  })

  it('keeps the optional source link, and refuses a bad one', async () => {
    const ok = await report(1, 'device-aaaa-1111', { sourceUrl: 'https://zola.example/about' })
    expect(ok).toMatchObject({ ok: true, data: { links: ['https://zola.example/about'] } })
    expect(await report(1, 'device-cccc-3333', { sourceUrl: 'javascript:alert(1)' })).toMatchObject({ ok: false, status: 400, code: 'bad_link' })
    expect(await report(2)).toMatchObject({ ok: false, status: 400, code: 'bad_report' })
    expect(await reportSeedOil(db, { placeId: 'n7', value: 1, lat: 1, lng: 1 }, viewer(null))).toMatchObject({ ok: false, code: 'no_device' })
  })

  it('slows a device that reports too much', async () => {
    for (let i = 0; i < 30; i++) await reportSeedOil(db, { placeId: `n${100 + i}`, value: 1, lat: 52.5, lng: 13.4 }, viewer())
    expect(await report(1)).toMatchObject({ ok: false, status: 429, code: 'rate_limited' })
  })

  it('answers for many restaurants at once and for a box', async () => {
    await report(1)
    await reportSeedOil(db, { placeId: 'n8', value: -1, lat: 52.5237, lng: 13.4042 }, viewer())
    const many = await seedOilFor(db, ['n7', 'n8', 'n9', 'not-an-id'], 'device-aaaa-1111')
    expect([...many.keys()].sort()).toEqual(['n7', 'n8'])
    expect(many.get('n7')).toMatchObject({ status: 'reported', myReport: 1 })
    expect((await seedOilFor(db, ['n9'], null, true)).get('n9')).toMatchObject({ status: 'unknown' })
    const box = await seedOilInBox(db, { south: 52.5, north: 52.55, west: 13.38, east: 13.43 }, null)
    expect(Object.keys(box).sort()).toEqual(['n7', 'n8'])
    expect(await seedOilInBox(db, { south: 48, north: 48.1, west: 2, east: 2.1 }, null)).toEqual({})
  })
})

/** A DNS-over-HTTPS answer: every host resolves to `ip` (a public address unless a test says otherwise). */
const dns = (url: string, ip = '93.184.216.34') => {
  const type = new URL(url).searchParams.get('type')
  return new Response(JSON.stringify({ Status: 0, Answer: type === 'A' ? [{ name: 'x', type: 1, data: ip }] : [] }), { status: 200, headers: { 'content-type': 'application/dns-json' } })
}
const isDns = (url: string) => url.startsWith('https://cloudflare-dns.com/dns-query')

describe("the restaurant's own website", () => {
  const page = (html: string, type = 'text/html; charset=utf-8') => new Response(html, { status: 200, headers: { 'content-type': type } })

  it('only fetches public web hosts', () => {
    expect(publicUrl('https://zola.example/')?.hostname).toBe('zola.example')
    expect(publicUrl('http://127.0.0.1/admin')).toBeNull()
    expect(publicUrl('http://2130706433/')).toBeNull()
    expect(publicUrl('http://0x7f.0.0.1/')).toBeNull()
    expect(publicUrl('http://[::1]/')).toBeNull()
    expect(publicUrl('http://localhost/')).toBeNull()
    expect(publicUrl('https://printer.local/')).toBeNull()
    expect(publicUrl('https://zola.example:8443/')).toBeNull()
    expect(publicUrl(null)).toBeNull()
  })

  it('knows which addresses are private', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.254', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '192.0.2.5', '198.18.0.1',
      '::1', '::', '::ffff:127.0.0.1', '::ffff:7f00:1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '64:ff9b::7f00:1', '2001:db8::1', 'not-an-address', '999.1.1.1', '']) {
      expect(isPrivateAddress(ip), ip).toBe(true)
    }
    for (const ip of ['93.184.216.34', '1.1.1.1', '172.15.0.1', '172.32.0.1', '100.63.0.1', '192.169.0.1', '2606:4700:4700::1111', '2a00:1450:4001:81b::200e']) {
      expect(isPrivateAddress(ip), ip).toBe(false)
    }
  })

  it('checks where a host name resolves, and says no when unsure', async () => {
    const to = (ip: string) => (async (url: string) => dns(url, ip)) as unknown as typeof fetch
    expect(await resolvesPublicly('zola.example', to('93.184.216.34'))).toBe(true)
    expect(await resolvesPublicly('rebind.example', to('127.0.0.1'))).toBe(false)
    expect(await resolvesPublicly('meta.example', to('169.254.169.254'))).toBe(false)
    // One private address among public ones is enough to refuse.
    const mixed = (async (url: string) => new Response(JSON.stringify({ Status: 0, Answer: new URL(url).searchParams.get('type') === 'A' ? [{ type: 5, data: 'cdn.example.' }, { type: 1, data: '93.184.216.34' }] : [{ type: 28, data: 'fd00::1' }] }), { status: 200 })) as unknown as typeof fetch
    expect(await resolvesPublicly('mixed.example', mixed)).toBe(false)
    const nx = (async () => new Response(JSON.stringify({ Status: 3 }), { status: 200 })) as unknown as typeof fetch
    expect(await resolvesPublicly('nope.example', nx)).toBe(false)
    const empty = (async () => new Response(JSON.stringify({ Status: 0 }), { status: 200 })) as unknown as typeof fetch
    expect(await resolvesPublicly('empty.example', empty)).toBe(false)
    const down = (async () => { throw new Error('network') }) as unknown as typeof fetch
    expect(await resolvesPublicly('zola.example', down)).toBe(false)
    const broken = (async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch
    expect(await resolvesPublicly('zola.example', broken)).toBe(false)
  })

  it('keeps what the page says, with the sentence and the link', async () => {
    const db = await freshDb()
    const calls: Array<{ url: string; ua: string | null }> = []
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (isDns(url)) return dns(url)
      calls.push({ url, ua: new Headers(init?.headers).get('user-agent') })
      return page('<html><head><script>var x = "seed oil free"</script></head><body><h1>Zola</h1><p>We cook without seed oils, only olive oil and butter.</p></body></html>')
    }) as unknown as typeof fetch
    const web = await checkWebsite(db, { id: 'n7', ...MITTE, website: 'zola.example' }, fetchImpl, 1000)
    expect(web).toMatchObject({ url: 'https://zola.example/', claim: 'free', checkedAt: 1000 })
    expect(web!.quote).toContain('without seed oils')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.ua).not.toMatch(/snapmenu|platepal|@/i)
    expect((await seedOilFor(db, ['n7'], null)).get('n7')).toMatchObject({ status: 'verified' })
    expect(await websiteDue(db, 'n7', 2000)).toBe(false)
    expect(await websiteDue(db, 'n7', 1000 + 15 * 86_400_000)).toBe(true)
  })

  it('never fetches a public-looking name that points at a private address', async () => {
    const db = await freshDb()
    for (const ip of ['127.0.0.1', '192.168.1.1', '169.254.169.254', '10.0.0.5']) {
      const fetched: string[] = []
      const fetchImpl = (async (url: string) => {
        if (isDns(url)) return dns(url, ip)
        fetched.push(url)
        return page('<p>We cook without seed oils.</p>')
      }) as unknown as typeof fetch
      expect(await checkWebsite(db, { id: 'n7', ...MITTE, website: 'https://intranet.attacker.example/admin?reset=1' }, fetchImpl), ip).toBeNull()
      expect(fetched, ip).toEqual([])
    }
    // Nothing was claimed about the restaurant, and the name is not asked again for a day.
    expect((await seedOilFor(db, ['n7'], null, true)).get('n7')).toMatchObject({ status: 'unknown', web: null })
    expect(await websiteDue(db, 'n7', Date.now() + 3_600_000)).toBe(false)
  })

  it('claims nothing from a page it could not read, and does not ask again for a day', async () => {
    const db = await freshDb()
    const pdf = (async (url: string) => (isDns(url) ? dns(url) : page('%PDF', 'application/pdf'))) as unknown as typeof fetch
    expect(await checkWebsite(db, { id: 'n7', ...MITTE, website: 'https://zola.example/' }, pdf, 1000)).toBeNull()
    expect((await seedOilFor(db, ['n7'], null, true)).get('n7')).toMatchObject({ status: 'unknown', web: null, source: 'No reports yet.' })
    expect(await websiteDue(db, 'n7', 1000 + 3_600_000)).toBe(false)
    expect(await websiteDue(db, 'n7', 1000 + 25 * 3_600_000)).toBe(true)
  })

  it('does not follow a redirect to a private host, by name or by address', async () => {
    const db = await freshDb()
    let calls = 0
    const hop = (async (url: string) => {
      if (isDns(url)) return dns(url)
      calls += 1
      return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secret' } })
    }) as unknown as typeof fetch
    expect(await checkWebsite(db, { id: 'n7', ...MITTE, website: 'https://zola.example/' }, hop)).toBeNull()
    expect(calls).toBe(1)

    // The redirect names a public-looking host that resolves to the local network.
    const fetched: string[] = []
    const rebind = (async (url: string) => {
      if (isDns(url)) return dns(url, new URL(url).searchParams.get('name') === 'zola.example' ? '93.184.216.34' : '192.168.0.10')
      fetched.push(url)
      return new Response(null, { status: 302, headers: { location: 'https://router.attacker.example/apply' } })
    }) as unknown as typeof fetch
    expect(await checkWebsite(db, { id: 'n8', ...MITTE, website: 'https://zola.example/' }, rebind)).toBeNull()
    expect(fetched).toEqual(['https://zola.example/'])
  })

  it('follows a redirect between public hosts and stops reading a long page early', async () => {
    const db = await freshDb()
    const fetched: string[] = []
    const fetchImpl = (async (url: string) => {
      if (isDns(url)) return dns(url)
      fetched.push(url)
      if (url === 'http://zola.example/') return new Response(null, { status: 301, headers: { location: 'https://www.zola.example/' } })
      return page(`<p>Seed oil free kitchen.</p>${'<p>filler</p>'.repeat(200_000)}`)
    }) as unknown as typeof fetch
    const web = await checkWebsite(db, { id: 'n7', ...MITTE, website: 'http://zola.example/' }, fetchImpl)
    expect(fetched).toEqual(['http://zola.example/', 'https://www.zola.example/'])
    expect(web).toMatchObject({ claim: 'free' })
  })

  it('skips a place without a usable website', async () => {
    const db = await freshDb()
    const never = (async () => { throw new Error('must not be called') }) as unknown as typeof fetch
    expect(await checkWebsite(db, { id: 'n7', ...MITTE, website: null }, never)).toBeNull()
    expect(await checkWebsite(db, { id: 'n7', ...MITTE, website: 'http://192.168.0.1/' }, never)).toBeNull()
  })
})

describe('Nominatim: polite geocoding', () => {
  const answer = [
    { osm_type: 'relation', osm_id: 55764, lat: '52.4977', lon: '13.4108', category: 'boundary', type: 'administrative', addresstype: 'suburb', name: 'Kreuzberg', display_name: 'Kreuzberg, Berlin, Germany', address: { suburb: 'Kreuzberg', city: 'Berlin', country: 'Germany' } },
    { osm_type: 'node', osm_id: 4242, lat: '52.4961', lon: '13.4222', category: 'amenity', type: 'restaurant', name: 'Zola Pizza', display_name: 'Zola Pizza, Paul-Lincke-Ufer, Berlin', address: { road: 'Paul-Lincke-Ufer', house_number: '39', postcode: '10999', city: 'Berlin', country: 'Germany' } },
    { osm_type: 'node', osm_id: 1, lat: 'x', lon: 'y', category: 'place', type: 'city', name: 'Broken' },
  ]

  it('turns an answer into areas and restaurants', () => {
    const r = parseNominatim(answer)
    expect(r.areas).toEqual([{ name: 'Kreuzberg', label: 'Berlin, Germany', lat: 52.4977, lng: 13.4108, kind: 'suburb' }])
    expect(r.places).toHaveLength(1)
    expect(r.places[0]).toMatchObject({ id: 'n4242', name: 'Zola Pizza', kind: 'restaurant', address: 'Paul-Lincke-Ufer 39', postcode: '10999', city: 'Berlin' })
    expect(parseNominatim({ error: 'nope' })).toEqual({ areas: [], places: [] })
  })

  it('asks once, with a generic User-Agent, and then answers from D1', async () => {
    const db = await freshDb()
    const calls: Array<{ url: string; ua: string | null }> = []
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, ua: new Headers(init?.headers).get('user-agent') })
      return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch
    const first = await geocode(db, 'Kreuzberg', MITTE, 'German', true, { fetchImpl })
    expect(first).toMatchObject({ ok: true, from: 'live' })
    const again = await geocode(db, '  KREUZBERG ', MITTE, 'German', true, { fetchImpl })
    expect(again).toMatchObject({ ok: true, from: 'cache' })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toContain('nominatim.openstreetmap.org/search?q=Kreuzberg')
    expect(calls[0]!.url).toContain('accept-language=de')
    expect(calls[0]!.ua).toBe(GEOCODE_USER_AGENT)
    // Generic on purpose: no project name, no person, no contact detail.
    expect(GEOCODE_USER_AGENT).not.toMatch(/snapmenu|platepal|nut|@|malek/i)
  })

  it('never asks while someone is only typing', async () => {
    const db = await freshDb()
    const never = (async () => { throw new Error('must not be called') }) as unknown as typeof fetch
    expect(await geocode(db, 'Kreuzberg', MITTE, 'English', false, { fetchImpl: never })).toEqual({ ok: false, reason: 'not_cached' })
  })

  it('keeps one second between two requests, across Worker instances', async () => {
    const db = await freshDb()
    expect(await claimSlot(db, 'nominatim', 10_000)).toBe(true)
    expect(await claimSlot(db, 'nominatim', 10_000 + MIN_GAP_MS - 1)).toBe(false)
    expect(await claimSlot(db, 'nominatim', 10_000 + MIN_GAP_MS)).toBe(true)
  })

  it('reports busy instead of breaking the limit, and does not cache a failure', async () => {
    const db = await freshDb()
    let now = 50_000
    await claimSlot(db, 'nominatim', now)
    let calls = 0
    const fetchImpl = (async () => { calls += 1; return new Response('[]', { status: 200 }) }) as unknown as typeof fetch
    // The clock does not move: the slot never frees up.
    expect(await geocode(db, 'Mitte', MITTE, 'English', true, { fetchImpl, now: () => now, sleep: async () => {} })).toEqual({ ok: false, reason: 'busy' })
    expect(calls).toBe(0)
    now += 5000
    const down = (async () => new Response('down', { status: 500 })) as unknown as typeof fetch
    expect(await geocode(db, 'Mitte', MITTE, 'English', true, { fetchImpl: down, now: () => now, sleep: async () => {} })).toEqual({ ok: false, reason: 'unavailable' })
    now += 5000
    expect(await geocode(db, 'Mitte', MITTE, 'English', true, { fetchImpl, now: () => now, sleep: async () => {} })).toMatchObject({ ok: true, from: 'live' })
    expect(calls).toBe(1)
  })
})

describe('restaurant search by name', () => {
  let db: Awaited<ReturnType<typeof freshDb>>
  beforeEach(async () => {
    db = await freshDb()
    await cacheArea(db, [
      el(1, 'Zola Pizza', { cuisine: 'pizza', opening_hours: 'Mo-Su 12:00-22:00' }),
      el(2, 'Mustafas Gemüse Döner', { cuisine: 'kebab' }),
      el(3, 'Pizzeria Nuova', {}),
      el(4, 'Café Übersee', { amenity: 'cafe' }),
      el(5, 'Standard Serious', { cuisine: 'pizza;italian' }),
    ])
  })

  it('folds accents and case, so "doner" finds "Döner"', async () => {
    expect((await searchByName(db, 'doner', MITTE)).map((p) => p.name)).toEqual(['Mustafas Gemüse Döner'])
    expect((await searchByName(db, 'UBERSEE', MITTE)).map((p) => p.name)).toEqual(['Café Übersee'])
    expect((await searchByName(db, 'gemüse', MITTE)).map((p) => p.name)).toEqual(['Mustafas Gemüse Döner'])
    expect(foldText('  Café  ÜBERSEE ')).toBe('cafe ubersee')
  })

  it('puts a name that starts with the query first, then a word, then the cuisine', async () => {
    expect((await searchByName(db, 'pizz', MITTE)).map((p) => p.name)).toEqual(['Pizzeria Nuova', 'Zola Pizza', 'Standard Serious'])
    expect(matchRank('Pizza Nostra', 'pizz')).toBe(0)
    expect(matchRank('La Pizzeria', 'pizz')).toBe(1)
    expect(matchRank('Hauspizza', 'pizz')).toBe(2)
    expect(matchRank('Standard', 'pizz')).toBe(3)
  })

  it('treats % and _ as letters, not wildcards', async () => {
    expect(await searchByName(db, '%%', MITTE)).toEqual([])
    expect(await searchByName(db, 'a', MITTE)).toEqual([])
    expect(likePattern('50%_off')).toBe('%50\\%\\_off%')
  })

  it('keeps the pattern within what D1 accepts, however long the query', async () => {
    const bytes = (s: string) => new TextEncoder().encode(s).length
    for (const q of ['x'.repeat(60), 'ö'.repeat(60), '%'.repeat(60), `${'a'.repeat(47)}%`, 'Mustafas Gemüse Döner am Mehringdamm in Berlin Kreuzberg']) {
      const p = likePattern(q)
      expect(bytes(p)).toBeLessThanOrEqual(LIKE_MAX_BYTES)
      // Never cut in the middle of an escaped character.
      expect(p.slice(1, -1)).not.toMatch(/(^|[^\\])(\\\\)*\\$/)
    }
    expect((await searchByName(db, 'mustafas gemüse döner und noch viel mehr text dahinter', MITTE)).length).toBeLessThanOrEqual(1)
    expect((await searchByName(db, 'Mustafas Gemüse Döner', MITTE)).map((p) => p.name)).toEqual(['Mustafas Gemüse Döner'])
  })

  it('returns one copy of a restaurant that sits in two cached areas, the one with details', async () => {
    // The neighbouring area was cached before the detail tags existed.
    const next = areaFor(MITTE.lat, MITTE.lng + 0.015)
    await db.prepare('INSERT INTO overpass_cache (key, ts, lat, lng, body) VALUES (?, ?, ?, ?, ?)')
      .bind(next.key, Date.now() + 1000, next.lat, next.lng, JSON.stringify([{ id: 'n1', name: 'Zola Pizza', lat: 52.5236, lng: 13.4041, kind: 'restaurant', cuisine: 'Pizza', address: null, vegan: null, vegetarian: null }])).run()
    const hits = await searchByName(db, 'zola', MITTE)
    expect(hits).toHaveLength(1)
    expect(hits[0]!.hours).toBe('Mo-Su 12:00-22:00')
  })

  it('answers a search with restaurants, known districts, scans and seed-oil status, without asking anyone', async () => {
    await db.prepare(`INSERT INTO place_dishes (place_id, place_name, lat, lng, scan_id, ts, name, kcal_low, kcal_mid, kcal_high, protein, carbs, fat, osm_verified) VALUES ('n1', 'Zola Pizza', 52.5236, 13.4041, 's1', 1, 'Margherita', 700, 850, 1000, 30, 100, 30, 1)`).run()
    await reportSeedOil(db, { placeId: 'n1', value: 1, lat: 52.5236, lng: 13.4041 }, viewer())
    const never = (async () => { throw new Error('must not be called') }) as unknown as typeof fetch
    const out = (await search(db, new URL('https://x/api/discover/search?q=zola&lat=52.5235&lng=13.404'), viewer(), { fetchImpl: never }))!
    expect(out.geo).toBe('local')
    expect(out.places).toHaveLength(1)
    expect(out.places[0]).toMatchObject({ id: 'n1', scanned: 1, seedOil: { status: 'reported' } })
    const kiez = (await search(db, new URL('https://x/api/discover/search?q=kreuz'), viewer(), { fetchImpl: never }))!
    expect(kiez.areas.map((a) => a.name)).toEqual(['Kreuzberg'])
    expect(await search(db, new URL('https://x/api/discover/search?q=k'), viewer())).toBeNull()
  })

  it('knows the Berlin districts and where Berlin is', () => {
    expect(BERLIN_AREAS.length).toBeGreaterThanOrEqual(10)
    for (const a of BERLIN_AREAS) expect(inBerlin(a)).toBe(true)
    expect(inBerlin({ lat: 48.8566, lng: 2.3522 })).toBe(false)
  })
})

describe('restaurant details', () => {
  it('finds a cached restaurant by id, near a point or anywhere', async () => {
    const db = await freshDb()
    await cacheArea(db, [el(1, 'Zola Pizza', { opening_hours: 'Mo-Su 12:00-22:00' })])
    expect(await findPlace(db, 'n1', { lat: 52.5236, lng: 13.4041 })).toMatchObject({ name: 'Zola Pizza', hours: 'Mo-Su 12:00-22:00' })
    expect(await findPlace(db, 'n1', null)).toMatchObject({ name: 'Zola Pizza' })
    expect(await findPlace(db, 'n1', { lat: 48.85, lng: 2.35 })).toBeNull()
    expect(await findPlace(db, 'n999', null)).toBeNull()
  })

  it('answers with hours, scanned dishes, votes and seed-oil status in one go', async () => {
    const db = await freshDb()
    await cacheArea(db, [el(1, 'Zola Pizza', { opening_hours: 'Mo-Su 12:00-22:00', 'addr:street': 'Paul-Lincke-Ufer', 'addr:housenumber': '39' })])
    await db.prepare(`INSERT INTO place_dishes (place_id, place_name, lat, lng, scan_id, ts, name, kcal_low, kcal_mid, kcal_high, protein, carbs, fat, osm_verified) VALUES ('n1', 'Zola Pizza', 52.5236, 13.4041, 's1', 1, 'Margherita', 700, 850, 1000, 30, 100, 30, 1)`).run()
    const out = (await placeDetails(db, new URL('https://x/api/discover/place?id=n1&lat=52.5236&lng=13.4041&goal=build_muscle'), viewer()))!
    expect(out.place).toMatchObject({ id: 'n1', hours: 'Mo-Su 12:00-22:00', address: 'Paul-Lincke-Ufer 39' })
    expect(out.dishes.map((d) => d.name)).toEqual(['Margherita'])
    expect(out.votes).toEqual({ yes: 0, no: 0, myVote: 0 })
    expect(out.seedOil).toMatchObject({ status: 'unknown' })
    expect(out.webPending).toBe(false)
    expect(await placeDetails(db, new URL('https://x/api/discover/place?id=bad'), viewer())).toBeNull()
  })

  /** One restaurant as Nominatim's lookup returns it. */
  const lookup = (name: string, extratags: Record<string, string>) => [{ osm_type: 'way', osm_id: 9, lat: '52.4701', lon: '13.4402', category: 'amenity', type: 'restaurant', name, address: { road: 'Weserstraße', house_number: '4', postcode: '12047', city: 'Berlin' }, extratags }]

  it('looks one restaurant up when its cached copy has no hours, once, and reads its website in the background', async () => {
    const db = await freshDb()
    // A list cached before the detail tags existed.
    const a = areaFor(52.4701, 13.4402)
    await db.prepare('INSERT INTO overpass_cache (key, ts, lat, lng, body) VALUES (?, ?, ?, ?, ?)')
      .bind(a.key, Date.now(), a.lat, a.lng, JSON.stringify([{ id: 'w9', name: 'Neu Hier', lat: 52.4701, lng: 13.4402, kind: 'restaurant', cuisine: 'Thai', address: null, vegan: null, vegetarian: null }])).run()
    const calls: Array<{ url: string; ua: string | null }> = []
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (isDns(url)) return dns(url)
      calls.push({ url, ua: new Headers(init?.headers).get('user-agent') })
      if (url.includes('/lookup?')) return new Response(JSON.stringify(lookup('Neu Hier', { opening_hours: 'Tu-Su 17:00-23:00', 'contact:website': 'https://neu.example', 'contact:phone': '+49 30 1234567' })), { status: 200 })
      return new Response('<p>Wir kochen ohne Saatenöle.</p>', { status: 200, headers: { 'content-type': 'text/html' } })
    }) as unknown as typeof fetch
    const pending: Array<Promise<unknown>> = []
    const deps = { fetchImpl, waitUntil: (p: Promise<unknown>) => { pending.push(p) } }

    // Without `load` nothing is asked: the list copy is all there is.
    const quiet = (await placeDetails(db, new URL('https://x/api/discover/place?id=w9&lat=52.4701&lng=13.4402'), viewer(), deps))!
    expect(quiet.place).toMatchObject({ name: 'Neu Hier' })
    expect(hasDetails(quiet.place!)).toBe(false)
    expect(calls).toHaveLength(0)

    const url = new URL('https://x/api/discover/place?id=w9&lat=52.4701&lng=13.4402&load=1')
    const first = (await placeDetails(db, url, viewer(), deps))!
    // The lookup fills the gaps; what the list knew (the cuisine) stays.
    expect(first.place).toMatchObject({ id: 'w9', name: 'Neu Hier', cuisine: 'Thai', hours: 'Tu-Su 17:00-23:00', website: 'https://neu.example/', phone: '+49 30 1234567', address: 'Weserstraße 4', postcode: '12047', city: 'Berlin' })
    expect(first.webPending).toBe(true)
    await Promise.all(pending)
    const second = (await placeDetails(db, url, viewer(), deps))!
    expect(second.webPending).toBe(false)
    expect(second.seedOil).toMatchObject({ status: 'verified', label: SEED_OIL_WEB_LABEL })
    expect(second.seedOil.web?.quote).toContain('ohne Saatenöle')
    // One lookup and one page: nothing is asked twice, and the client names no person or project.
    expect(calls.filter((c) => c.url.includes('nominatim.openstreetmap.org/lookup?osm_ids=W9'))).toHaveLength(1)
    expect(calls.filter((c) => c.url.includes('neu.example'))).toHaveLength(1)
    for (const c of calls) expect(c.ua).not.toMatch(/snapmenu|platepal|@/i)
    // A search now carries the details too.
    expect((await search(db, new URL('https://x/api/discover/search?q=neu+hier&lat=52.47&lng=13.44'), viewer()))!.places[0]).toMatchObject({ id: 'w9', hours: 'Tu-Su 17:00-23:00' })
  })

  it('fills in hours that a lagging list copy does not have, and never drops what the list knew', async () => {
    const db = await freshDb()
    // Parsed with the detail tags, but this server's copy of the restaurant has no opening hours.
    await cacheArea(db, [{ type: 'way', id: 9, center: { lat: 52.4701, lon: 13.4402 }, tags: { amenity: 'restaurant', name: 'Neu Hier', cuisine: 'thai', website: 'https://neu.example', delivery: 'yes' } }], { lat: 52.4701, lng: 13.4402 })
    const fetchImpl = (async (url: string) => (isDns(url) ? dns(url) : url.includes('/lookup?')
      ? new Response(JSON.stringify(lookup('Neu Hier', { opening_hours: 'Mo-Su 12:00-22:00' })), { status: 200 })
      : new Response('<p>Hallo</p>', { status: 200, headers: { 'content-type': 'text/html' } }))) as unknown as typeof fetch
    const out = (await placeDetails(db, new URL('https://x/api/discover/place?id=w9&lat=52.4701&lng=13.4402&load=1'), viewer(), { fetchImpl }))!
    expect(out.place).toMatchObject({ hours: 'Mo-Su 12:00-22:00', website: 'https://neu.example/', delivery: 'yes', cuisine: 'Thai' })
    expect(withKnown(null, null)).toBeNull()
    expect(withKnown({ id: 'n1', hours: 'Mo 10:00-12:00' } as never, { id: 'n1', hours: null, phone: '030 1' } as never)).toMatchObject({ hours: 'Mo 10:00-12:00', phone: '030 1' })
  })

  it('prefers the cached copy that has opening hours over a newer one without', async () => {
    const db = await freshDb()
    await cacheArea(db, [el(1, 'Zola Pizza', { opening_hours: 'Mo-Su 12:00-22:00' })], MITTE, 1000)
    const next = areaFor(MITTE.lat, MITTE.lng + 0.015)
    await db.prepare('INSERT INTO overpass_cache (key, ts, lat, lng, body) VALUES (?, ?, ?, ?, ?)')
      .bind(next.key, 2000, next.lat, next.lng, JSON.stringify(parseOverpass({ elements: [el(1, 'Zola Pizza', {})] }))).run()
    expect((await findPlace(db, 'n1', { lat: 52.5236, lng: 13.4041 }))?.hours).toBe('Mo-Su 12:00-22:00')
  })

  it('keeps a restaurant that is gone as gone, and survives a failing lookup', async () => {
    const db = await freshDb()
    const at = { lat: 52.47, lng: 13.44 }
    let calls = 0
    const gone = (async () => { calls += 1; return new Response('[]', { status: 200 }) }) as unknown as typeof fetch
    expect(await loadElement(db, 'n5', at, true, gone, 10_000)).toBeNull()
    expect(await loadElement(db, 'n5', at, true, gone, 20_000)).toBeNull()
    expect(calls).toBe(1)
    const down = (async () => { throw new Error('network') }) as unknown as typeof fetch
    expect(await loadElement(db, 'n6', at, true, down, 30_000)).toBeNull()
    // One request a second at most, shared with the geocoder: the slot taken at 30 s is still warm.
    const ok = (async () => { calls += 1; return new Response(JSON.stringify([{ lat: '52.47', lon: '13.44', type: 'cafe', name: 'Da', extratags: null }]), { status: 200 }) }) as unknown as typeof fetch
    expect(await loadElement(db, 'n6', at, true, ok, 30_500)).toBeNull()
    expect(await loadElement(db, 'n6', at, true, ok, 32_000)).toMatchObject({ id: 'n6', name: 'Da', kind: 'cafe', hours: null })
    expect(await claimSlot(db, 'nominatim', 32_500)).toBe(false)
  })
})

describe('the /api/discover routes', () => {
  const get = (db: Awaited<ReturnType<typeof freshDb>>, path: string) => handleDiscover(new Request(`https://x${path}`, { headers: { 'x-device': 'device-aaaa-1111' } }), { DB: db }, new URL(`https://x${path}`))

  it('leaves every other path to the main router', async () => {
    const db = await freshDb()
    expect(await get(db, '/api/places?lat=1&lng=1')).toBeNull()
    expect(await get(db, '/api/discover/nope')).toBeNull()
  })

  it('creates its own tables on first use', async () => {
    const db = memoryD1()
    for (const sql of [EVENTS, ...PLACES_SCHEMA]) await db.prepare(sql).run()
    const res = (await get(db, '/api/discover/search?q=pizza'))!
    expect(res.status).toBe(200)
    expect(((await res.json()) as SearchResponse).places).toEqual([])
  })

  it('serves search, details and the seed-oil report', async () => {
    const db = await freshDb()
    await cacheArea(db, [el(1, 'Zola Pizza', { opening_hours: 'Mo-Su 12:00-22:00' })])
    expect((await get(db, '/api/discover/search?q=x'))!.status).toBe(400)
    const found = (await (await get(db, '/api/discover/search?q=zola'))!.json()) as SearchResponse
    expect(found.places.map((p) => p.id)).toEqual(['n1'])

    const post = await handleDiscover(new Request('https://x/api/discover/seed-oil', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-device': 'device-aaaa-1111' },
      body: JSON.stringify({ placeId: 'n1', value: 1, lat: 52.5236, lng: 13.4041, sourceUrl: 'https://zola.example/' }),
    }), { DB: db }, new URL('https://x/api/discover/seed-oil'))
    expect(post!.status).toBe(200)
    expect((await post!.json()) as SeedOilView).toMatchObject({ status: 'reported', yes: 1, myReport: 1, links: ['https://zola.example/'] })
    const logged = await db.prepare("SELECT COUNT(*) c FROM events WHERE type = 'seed_oil_report'").first<{ c: number }>()
    expect(logged?.c).toBe(1)

    const details = (await (await get(db, '/api/discover/place?id=n1&lat=52.5236&lng=13.4041'))!.json()) as DetailsResponse
    expect(details.seedOil).toMatchObject({ status: 'reported', myReport: 1 })
    expect((await get(db, '/api/discover/place?id=nope'))!.status).toBe(400)

    const box = (await (await get(db, '/api/discover/seed-oil?south=52.5&north=52.55&west=13.38&east=13.43'))!.json()) as { seedOil: Record<string, SeedOilView> }
    expect(Object.keys(box.seedOil)).toEqual(['n1'])
    expect((await get(db, '/api/discover/seed-oil?south=40&north=60&west=0&east=20'))!.status).toBe(400)
  })
})
