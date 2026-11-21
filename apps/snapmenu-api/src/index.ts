import { AiError, orderTips, readMenu } from './anthropic.js'
import { D1DbAdapter, type D1Like } from './d1-adapter.js'
import { estimateDish, loadFoodDb } from './menu-engine.js'
import { lookupOpenFoodFacts } from './off.js'
import { rankDishes } from './ranking.js'
import type { FoodDb } from '@nutai/gram-engine'
import type { MenuResult, Profile } from './types.js'

/**
 * Snapmenu API — one Cloudflare Worker, plain fetch handler.
 *
 *   POST /api/menu     menu photo + profile -> ranked dishes with ranges and sources
 *   POST /api/event    analytics event (scan, share tap, correction ...)
 *   GET  /api/numbers  aggregate numbers for the jury slide (team devices excluded)
 *   GET  /api/health
 */

export interface Env {
  DB: D1Like
  ANTHROPIC_API_KEY?: string
}

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
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
  await logEvent(env, type, typeof body['deviceId'] === 'string' ? body['deviceId'] : null, body['team'] === true, props)
  return json({ ok: true })
}

async function handleNumbers(env: Env): Promise<Response> {
  const q = async <T>(sql: string) => (await env.DB.prepare(sql).first<T>()) as T
  const all = async <T>(sql: string) => (await env.DB.prepare(sql).all<T>()).results
  const scans = await q<{ c: number }>("SELECT COUNT(*) c FROM events WHERE type='scan' AND team=0")
  const people = await q<{ c: number }>("SELECT COUNT(DISTINCT device) c FROM events WHERE type='scan' AND team=0")
  const visitors = await q<{ c: number }>("SELECT COUNT(DISTINCT device) c FROM events WHERE team=0")
  const dishes = await q<{ c: number }>("SELECT COALESCE(SUM(json_extract(props,'$.dishes')),0) c FROM events WHERE type='scan' AND team=0")
  const recommended = await q<{ c: number }>("SELECT COALESCE(SUM(json_extract(props,'$.shown')),0) c FROM events WHERE type='scan' AND team=0")
  const shares = await q<{ c: number }>("SELECT COUNT(*) c FROM events WHERE type IN ('share','share_download') AND team=0")
  const corrections = await q<{ c: number }>("SELECT COUNT(*) c FROM events WHERE type='correction' AND team=0")
  const menuLangs = await all<{ v: string; c: number }>("SELECT json_extract(props,'$.menuLanguage') v, COUNT(*) c FROM events WHERE type='scan' AND team=0 GROUP BY v ORDER BY c DESC")
  const userLangs = await all<{ v: string; c: number }>("SELECT json_extract(props,'$.userLanguage') v, COUNT(*) c FROM events WHERE type='scan' AND team=0 GROUP BY v ORDER BY c DESC")
  const cuisines = await all<{ v: string; c: number }>("SELECT json_extract(props,'$.cuisine') v, COUNT(*) c FROM events WHERE type='scan' AND team=0 GROUP BY v ORDER BY c DESC LIMIT 10")
  const teamScans = await q<{ c: number }>("SELECT COUNT(*) c FROM events WHERE type='scan' AND team=1")
  return json({
    scans: scans.c, people: people.c, visitors: visitors.c, dishesRead: dishes.c, dishesRecommended: recommended.c,
    shareTaps: shares.c, corrections: corrections.c, menuLanguages: menuLangs, userLanguages: userLangs, cuisines,
    excludedTeamScans: teamScans.c, generatedAt: new Date().toISOString(),
  })
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: JSON_HEADERS })
    try {
      if (url.pathname === '/api/health') return json({ ok: true, ai: Boolean(env.ANTHROPIC_API_KEY) })
      if (url.pathname === '/api/menu' && req.method === 'POST') return await handleMenu(req, env)
      if (url.pathname === '/api/event' && req.method === 'POST') return await handleEvent(req, env)
      if (url.pathname === '/api/numbers' && req.method === 'GET') return await handleNumbers(env)
      return fail(404, 'not_found', 'Not found.')
    } catch (err) {
      console.error('request failed', err instanceof Error ? err.message : 'unknown')
      return fail(500, 'internal', 'Server error.')
    }
  },
}
