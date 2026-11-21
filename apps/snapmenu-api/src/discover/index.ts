/**
 * Discover: restaurant search, restaurant details and the seed-oil filter.
 *
 *   GET  /api/discover/search?q=&lat=&lng=[&geo=1]   restaurants by name (cached OpenStreetMap lists) and areas
 *                                                    (built-in districts, cached lookups; `geo=1` may ask Nominatim)
 *   GET  /api/discover/place?id=&lat=&lng=[&load=1]  one restaurant: address, hours, website, scanned dishes,
 *                                                    delivery votes, seed-oil status (`load=1` may ask Nominatim for it)
 *   GET  /api/discover/seed-oil?south=&west=&north=&east=   seed-oil status of the restaurants in a box
 *   POST /api/discover/seed-oil                      one-tap report: { placeId, value: 1 | -1 | 0, lat, lng, sourceUrl? }
 *
 * The main router hands every request over with one line; anything that is not /api/discover/* comes back as null.
 */
import type { D1Like } from '../d1-adapter.js'
import type { GeoDeps } from './geocode.js'
import { fail, json, logEvent, num, viewerOf } from './http.js'
import { placeDetails } from './place.js'
import { ensureDiscoverSchema } from './schema.js'
import { search } from './search.js'
import { reportSeedOil, seedOilInBox } from './seed-oil.js'

export { DISCOVER_SCHEMA } from './schema.js'

interface Ctx { waitUntil(p: Promise<unknown>): void }
export interface DiscoverDeps extends GeoDeps { fetchImpl?: typeof fetch }

export async function handleDiscover(req: Request, env: { DB: D1Like }, url: URL, ctx?: Ctx, deps: DiscoverDeps = {}): Promise<Response | null> {
  const p = url.pathname
  if (!p.startsWith('/api/discover/')) return null
  await ensureDiscoverSchema(env.DB)
  const v = viewerOf(req, url)

  if (req.method === 'GET' && p === '/api/discover/search') {
    const out = await search(env.DB, url, v, deps)
    if (!out) return fail(400, 'bad_query', 'Type at least two letters.')
    if (out.geo === 'live') await logEvent(env.DB, 'discover_geo', v, {})
    return json(out)
  }

  if (req.method === 'GET' && p === '/api/discover/place') {
    const out = await placeDetails(env.DB, url, v, { ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}), ...(ctx ? { waitUntil: (pr: Promise<unknown>) => ctx.waitUntil(pr) } : {}) })
    return out ? json(out) : fail(400, 'bad_place', 'Unknown restaurant id.')
  }

  if (req.method === 'GET' && p === '/api/discover/seed-oil') {
    const south = num(url.searchParams.get('south'), -85, 85), north = num(url.searchParams.get('north'), -85, 85)
    const west = num(url.searchParams.get('west'), -180, 180), east = num(url.searchParams.get('east'), -180, 180)
    if (south === null || north === null || west === null || east === null || north - south > 0.2 || east - west > 0.3 || north < south || east < west) {
      return fail(400, 'bad_box', 'Missing or invalid area.')
    }
    return json({ seedOil: await seedOilInBox(env.DB, { south, west, north, east }, v.device) })
  }

  if (req.method === 'POST' && p === '/api/discover/seed-oil') {
    let body: Record<string, unknown>
    try { body = (await req.json()) as Record<string, unknown> } catch { return fail(400, 'bad_json', 'Request body must be JSON.') }
    const out = await reportSeedOil(env.DB, body, v)
    if (!out.ok) return fail(out.status, out.code, out.message)
    await logEvent(env.DB, 'seed_oil_report', v, { place: body['placeId'], value: body['value'], link: Boolean(body['sourceUrl']) })
    return json(out.data)
  }

  return null
}
