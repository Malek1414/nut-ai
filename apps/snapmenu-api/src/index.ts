import { AiError, orderTips, readMenu } from './anthropic.js'
import { D1DbAdapter, type D1Like } from './d1-adapter.js'
import { estimateDish, loadFoodDb } from './menu-engine.js'
import { lookupOpenFoodFacts } from './off.js'
import { rankDishes } from './ranking.js'
import { attachScan, deliveryVote, handlePlace, handlePlaces, PLACES_SCHEMA } from './places.js'
import { PROVIDER_IDS } from './delivery.js'
import { RATE_LIMITS } from './community.js'
import { SEED_SQL, seedCommunitySql } from './seed.js'
import * as community from './community-api.js'
import type { FoodDb } from '@nutai/gram-engine'
import type { MenuResult, Profile } from './types.js'

/**
 * Snapmenu API — one Cloudflare Worker, plain fetch handler.
 *
 *   POST /api/menu     menu photo + profile -> ranked dishes with ranges and sources
 *   POST /api/event    analytics event (scan, share tap, correction ...)
 *   GET  /api/numbers  aggregate numbers for the jury slide (team devices excluded)
 *   GET  /api/places   restaurants near a point (OpenStreetMap) + best community dish per place for a goal
 *   GET  /api/place    every community-scanned dish at one restaurant, best first
 *   POST /api/scan/attach  file a scan's dishes under a nearby restaurant
 *   POST /api/delivery-vote  one-tap "Delivers? yes / no" for a restaurant
 *   GET  /api/feed, /api/post, /api/communities, /api/photo   community reads
 *   POST /api/posts, /api/comments, /api/vote, /api/save, /api/report, /api/delete   community writes
 *   GET  /api/health
 */

interface Ctx { waitUntil(p: Promise<unknown>): void }

let schemaReady: Promise<void> | null = null
/** Community and map tables are created on first use, so a fresh local D1 works without a migration step. */
function ensureSchema(env: Env): Promise<void> {
  schemaReady ??= (async () => {
    for (const sql of [...PLACES_SCHEMA, ...community.COMMUNITY_SCHEMA]) await env.DB.prepare(sql).run()
    for (const sql of community.COMMUNITY_MIGRATIONS) {
      try { await env.DB.prepare(sql).run() } catch { /* column already there */ }
    }
    for (const sql of [...SEED_SQL, ...seedCommunitySql(Date.now())]) await env.DB.prepare(sql).run()
  })().catch((e) => { schemaReady = null; throw e })
  return schemaReady
}

async function handleAttach(req: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>
  try { body = (await req.json()) as Record<string, unknown> } catch { return fail(400, 'bad_json', 'Request body must be JSON.') }
  const device = typeof body['deviceId'] === 'string' ? body['deviceId'] : null
  const team = body['team'] === true
  if (device) {
    const { max, windowMs } = RATE_LIMITS.attach
    const n = await env.DB.prepare('SELECT COUNT(DISTINCT scan_id) c FROM place_dishes WHERE device = ? AND ts > ?').bind(device, Date.now() - windowMs).first<{ c: number }>()
    if ((n?.c ?? 0) >= max) return fail(429, 'rate_limited', 'You attached a lot of scans in the last hour. Try again later.')
  }
  const out = await attachScan(env.DB, body, device, team)
  if (!out.ok) return fail(out.status, out.code, out.message)
  await logEvent(env, 'scan_attach', device, team, { place: (body['place'] as { id?: string } | undefined)?.id ?? null, dishes: out.attached })
  return json(out)
}

export interface Env {
  DB: D1Like
  ANTHROPIC_API_KEY?: string
}

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, x-device, x-team',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
const fail = (status: number, code: string, message: string) => json({ error: { code, message } }, status)

let foodDbPromise: Promise<FoodDb> | null = null

const GOALS = new Set(['lose_fat', 'build_muscle', 'balanced', 'plant_based'])

function parseProfile(raw: unknown): Profile | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r['goal'] !== 'string' || !GOALS.has(r['goal'])) return null
  const allergies = Array.isArray(r['allergies']) ? (r['allergies'] as unknown[]).filter((a): a is string => typeof a === 'string').slice(0, 20) : []
  const language = typeof r['language'] === 'string' && r['language'].length < 40 ? r['language'] : 'English'
  const plantStyle = r['plantStyle'] === 'vegetarian' ? 'vegetarian' : 'vegan'
  return { goal: r['goal'] as Profile['goal'], plantStyle, allergies, language }
}

async function logEvent(env: Env, type: string, device: string | null, team: boolean, props: Record<string, unknown>) {
  try {
    await env.DB.prepare('INSERT INTO events (ts, type, device, team, props) VALUES (?, ?, ?, ?, ?)')
      .bind(Date.now(), type.slice(0, 40), device?.slice(0, 64) ?? null, team ? 1 : 0, JSON.stringify(props).slice(0, 2000))
      .run()
  } catch {
    // Analytics must never break a scan.
  }
}

async function handleMenu(req: Request, env: Env): Promise<Response> {
  const t0 = Date.now()
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return fail(400, 'bad_json', 'Request body must be JSON.')
  }
  const profile = parseProfile(body['profile'])
  if (!profile) return fail(400, 'bad_profile', 'Missing or invalid profile.')
  let image = typeof body['image'] === 'string' ? body['image'] : ''
  let mediaType: 'image/jpeg' | 'image/png' | 'image/webp' = 'image/jpeg'
  const m = /^data:(image\/(?:jpeg|png|webp));base64,/.exec(image)
  if (m) {
    mediaType = m[1] as typeof mediaType
    image = image.slice(m[0].length)
  }
  if (image.length < 1000) return fail(400, 'no_image', 'No photo received.')
  if (image.length > 7_000_000) return fail(413, 'too_big', 'The photo is too large. Try again, it will be compressed.')
  const device = typeof body['deviceId'] === 'string' ? body['deviceId'] : null
  const team = body['team'] === true

  try {
    const read = await readMenu(env.ANTHROPIC_API_KEY, image, mediaType, profile)
    const t1 = Date.now()
    if (!read.is_menu || read.dishes.length === 0) {
      await logEvent(env, 'scan_not_menu', device, team, {})
      return fail(422, 'not_menu', read.refusal_reason || 'We could not find a menu in this photo. Try a sharper, closer photo of the menu.')
    }

    const db = new D1DbAdapter(env.DB)
    foodDbPromise ??= loadFoodDb(db)
    const foodDb = await foodDbPromise
    const off = (q: string) => lookupOpenFoodFacts(q)
    const estimates = await Promise.all(read.dishes.slice(0, 24).map((d, i) => estimateDish(d, i, { db, foodDb, off }, profile)))
    const t2 = Date.now()
    const ranking = rankDishes(estimates, profile)

    const tipDishes = ranking.top.map((id) => ranking.dishes.find((d) => d.id === id)!).filter(Boolean)
    let tips: MenuResult['tips'] = []
    try {
      tips = await orderTips(env.ANTHROPIC_API_KEY, tipDishes, read.menu_language, profile)
    } catch {
      tips = []
    }
    const t3 = Date.now()

    const scanId = crypto.randomUUID()
    const result: MenuResult = {
      scanId,
      restaurant: read.restaurant_name,
      menuLanguage: read.menu_language,
      cuisine: read.cuisine,
      profile,
      dishes: ranking.dishes,
      top: ranking.top,
      avoid: ranking.avoid,
      tips,
      notes: [],
      timings: { readMs: t1 - t0, engineMs: t2 - t1, tipsMs: t3 - t2, totalMs: t3 - t0 },
    }
    await logEvent(env, 'scan', device, team, {
      scanId, dishes: result.dishes.length, shown: result.top.length, menuLanguage: read.menu_language,
      cuisine: read.cuisine, userLanguage: profile.language, goal: profile.goal, ms: t3 - t0,
    })
    return json(result)
  } catch (err) {
    if (err instanceof AiError) {
      await logEvent(env, 'scan_error', device, team, { code: err.code })
      return fail(err.status, err.code, err.message)
    }
    console.error('menu failed', err instanceof Error ? err.message : 'unknown')
    return fail(500, 'internal', 'Something went wrong while reading the menu. Please try again.')
  }
}

async function handleEvent(req: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return fail(400, 'bad_json', 'Request body must be JSON.')
  }
  const type = typeof body['type'] === 'string' ? body['type'] : ''
  if (!/^[a-z_]{2,40}$/.test(type)) return fail(400, 'bad_type', 'Invalid event type.')
  const props = body['props'] && typeof body['props'] === 'object' ? (body['props'] as Record<string, unknown>) : {}
  if (type === 'order_click' && !(typeof props['provider'] === 'string' && PROVIDER_IDS.has(props['provider']))) return fail(400, 'bad_provider', 'Unknown delivery provider.')
  await logEvent(env, type, typeof body['deviceId'] === 'string' ? body['deviceId'] : null, body['team'] === true, props)
  return json({ ok: true })
}

/** No accounts: the app sends its random device id and the team flag as headers. */
function viewer(req: Request): community.Viewer {
  const d = req.headers.get('x-device')
  return { device: d && /^[A-Za-z0-9-]{8,64}$/.test(d) ? d : null, team: req.headers.get('x-team') === '1' }
}

const outJson = <T,>(o: community.Out<T>) => (o.ok ? json(o.data) : fail(o.status, o.code, o.message))

async function handleCommunity(req: Request, env: Env, url: URL): Promise<Response | null> {
  const v = viewer(req)
  const p = url.pathname
  if (req.method === 'GET') {
    if (p === '/api/feed') return json({ posts: await community.listPosts(env.DB, url, v) })
    if (p === '/api/post') return outJson(await community.getPost(env.DB, url.searchParams.get('id') ?? '', v))
    if (p === '/api/communities') return json({ communities: await community.communityCounts(env.DB) })
    if (p === '/api/photo') {
      const ph = await community.getPhoto(env.DB, url.searchParams.get('id') ?? '')
      return ph ? new Response(ph.bytes as unknown as BodyInit, { headers: { 'content-type': ph.type, 'cache-control': 'public, max-age=86400' } }) : fail(404, 'not_found', 'No photo.')
    }
    return null
  }
  if (req.method !== 'POST') return null
  const writes: Record<string, (db: Env['DB'], b: Record<string, unknown>, v: community.Viewer) => Promise<community.Out<unknown>>> = {
    '/api/posts': community.createPost, '/api/comments': community.createComment, '/api/vote': community.vote,
    '/api/save': community.save, '/api/report': community.report, '/api/delete': community.remove,
  }
  const fn = writes[p]
  if (!fn) return null
  let body: Record<string, unknown>
  try { body = (await req.json()) as Record<string, unknown> } catch { return fail(400, 'bad_json', 'Request body must be JSON.') }
  const out = await fn(env.DB, body, v)
  if (out.ok) {
    const type = { '/api/posts': 'post', '/api/comments': 'comment', '/api/vote': 'vote', '/api/report': 'report' }[p]
    if (type) await logEvent(env, type, v.device, v.team, type === 'post' ? { community: body['community'], kind: body['kind'] } : {})
  }
  return outJson(out)
}

async function handleNumbers(env: Env): Promise<Response> {
  const q = async <T>(sql: string) => (await env.DB.prepare(sql).first<T>()) as T
  const all = async <T>(sql: string) => (await env.DB.prepare(sql).all<T>()).results
  const scans = await q<{ c: number }>("SELECT COUNT(*) c FROM events WHERE type='scan' AND team=0")
  const people = await q<{ c: number }>("SELECT COUNT(DISTINCT device) c FROM events WHERE type='scan' AND team=0")
  const visitors = await q<{ c: number }>("SELECT COUNT(DISTINCT device) c FROM events WHERE team=0")
  const dishes = await q<{ c: number }>("SELECT COALESCE(SUM(json_extract(props,'$.dishes')),0) c FROM events WHERE type='scan' AND team=0")
  const recommended = await q<{ c: number }>("SELECT COALESCE(SUM(json_extract(props,'$.shown')),0) c FROM events WHERE type='scan' AND team=0")
  const shares = await q<{ c: number }>("SELECT COUNT(*) c FROM events WHERE type='share' AND team=0")
  const corrections = await q<{ c: number }>("SELECT COUNT(*) c FROM events WHERE type='correction' AND team=0")
  const menuLangs = await all<{ v: string; c: number }>("SELECT json_extract(props,'$.menuLanguage') v, COUNT(*) c FROM events WHERE type='scan' AND team=0 GROUP BY v ORDER BY c DESC")
  const userLangs = await all<{ v: string; c: number }>("SELECT json_extract(props,'$.userLanguage') v, COUNT(*) c FROM events WHERE type='scan' AND team=0 GROUP BY v ORDER BY c DESC")
  const cuisines = await all<{ v: string; c: number }>("SELECT json_extract(props,'$.cuisine') v, COUNT(*) c FROM events WHERE type='scan' AND team=0 GROUP BY v ORDER BY c DESC LIMIT 10")
  const teamScans = await q<{ c: number }>("SELECT COUNT(*) c FROM events WHERE type='scan' AND team=1")
  const orderClicks = await all<{ v: string; c: number }>("SELECT json_extract(props,'$.provider') v, COUNT(*) c FROM events WHERE type='order_click' AND team=0 GROUP BY v ORDER BY c DESC")
  const deliveryVotes = await q<{ c: number }>('SELECT COUNT(*) c FROM delivery_votes WHERE team=0')
  return json({
    scans: scans.c, people: people.c, visitors: visitors.c, dishesRead: dishes.c, dishesRecommended: recommended.c,
    shareTaps: shares.c, corrections: corrections.c, menuLanguages: menuLangs, userLanguages: userLangs, cuisines,
    excludedTeamScans: teamScans.c,
    delivery: { clicks: orderClicks.reduce((n, r) => n + r.c, 0), byProvider: orderClicks, votes: deliveryVotes.c },
    community: await community.communityNumbers(env.DB), generatedAt: new Date().toISOString(),
  })
}

export default {
  async fetch(req: Request, env: Env, ctx?: Ctx): Promise<Response> {
    const url = new URL(req.url)
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: JSON_HEADERS })
    try {
      if (url.pathname === '/api/health') return json({ ok: true, ai: Boolean(env.ANTHROPIC_API_KEY) })
      if (url.pathname === '/api/menu' && req.method === 'POST') return await handleMenu(req, env)
      if (url.pathname === '/api/event' && req.method === 'POST') return await handleEvent(req, env)
      if (url.pathname !== '/api/menu' && url.pathname !== '/api/event') await ensureSchema(env)
      if (url.pathname === '/api/numbers' && req.method === 'GET') return await handleNumbers(env)
      const c = await handleCommunity(req, env, url)
      if (c) return c
      if (url.pathname === '/api/places' && req.method === 'GET') {
        const out = await handlePlaces(url, env.DB, (p) => ctx?.waitUntil(p))
        return out ? json(out) : fail(400, 'bad_position', 'Missing or invalid position.')
      }
      if (url.pathname === '/api/place' && req.method === 'GET') {
        const out = await handlePlace(url, env.DB, viewer(req).device)
        return out ? json(out) : fail(400, 'bad_place', 'Unknown restaurant id.')
      }
      if (url.pathname === '/api/scan/attach' && req.method === 'POST') return await handleAttach(req, env)
      if (url.pathname === '/api/delivery-vote' && req.method === 'POST') {
        let body: Record<string, unknown>
        try { body = (await req.json()) as Record<string, unknown> } catch { return fail(400, 'bad_json', 'Request body must be JSON.') }
        const v = viewer(req)
        const out = await deliveryVote(env.DB, body, v.device, v.team)
        if (out.ok) await logEvent(env, 'delivery_vote', v.device, v.team, { place: body['placeId'], value: body['value'] })
        return out.ok ? json(out.data) : fail(out.status, out.code, out.message)
      }
      return fail(404, 'not_found', 'Not found.')
    } catch (err) {
      console.error('request failed', err instanceof Error ? err.message : 'unknown')
      return fail(500, 'internal', 'Server error.')
    }
  },
}
