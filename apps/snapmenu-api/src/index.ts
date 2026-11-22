import { aiSettings, type AiEnv } from './ai-config.js'
import { readDiet } from './types.js'
import { AiError, pickVoice, readMenu, readMenuStream, setAiBaseUrl, type Ai } from './anthropic.js'
import { nearbyPick } from './nearby-pick.js'
import { handleGroup } from './group/api.js'
import type { D1Like } from './d1-adapter.js'
import { d1Runner, FoodLookup } from './food-lookup.js'
import { estimateDish } from './menu-engine.js'
import { scanSeconds, type TimedScan } from './models.js'
import { lookupOpenFoodFacts } from './off.js'
import { goalScore, rankDishes } from './ranking.js'
import { attachScan, deliveryVote, handlePlace, handlePlaces, PLACES_SCHEMA } from './places.js'
import { PROVIDER_IDS } from './delivery.js'
import { handleMe } from './me/handler.js'
import { dishesToVoice, readMeCtx, type MeCtx } from './me/rank.js'
import { RATE_LIMITS } from './community.js'
import { SEED_SQL, seedCommunitySql } from './seed.js'
import * as community from './community-api.js'
import { communityMembership, handleAccount, sessionAccount, setMembership } from './account.js'
import { handleDiscover } from './discover/index.js'
import { handleSocial, socialNumbers } from './social/index.js'
import type { DishEstimate, MenuResult, OrderTip, Profile } from './types.js'
import { errorText, noAmounts, say, userLanguage, type Lang } from './voice/index.js'
import { handleVoice, voiceNumbers } from './voice/api.js'

/**
 * Snapmenu API — one Cloudflare Worker, plain fetch handler.
 *
 *   POST /api/menu     menu photo + profile -> ranked dishes with ranges and sources
 *                      (`stream: true` in the body -> the same result as server-sent events, dish by dish; see STREAMING.md)
 *   POST /api/event    analytics event (scan, share tap, correction ...)
 *   GET  /api/numbers  aggregate numbers for the jury slide (team devices excluded), and how long real scans took per model
 *   GET  /api/places   restaurants near a point (OpenStreetMap) + best community dish per place for a goal
 *   GET  /api/place    every community-scanned dish at one restaurant, best first
 *   POST /api/scan/attach  file a scan's dishes under a nearby restaurant
 *   POST /api/delivery-vote  one-tap "Delivers? yes / no" for a restaurant
 *   GET  /api/feed, /api/post, /api/communities, /api/photo   community reads
 *   POST /api/posts, /api/comments, /api/vote, /api/save, /api/report, /api/delete   community writes
 *   POST /api/chat   menu chat (typed or browser-transcribed) (voice/api.ts)
 *   POST /api/me/estimate  a typed meal ("2 eggs and toast") as dishes with the engine's numbers (me/handler.ts)
 *   POST /api/share, /api/import, /api/premium-interest; GET /s/<id>   friend sharing, link imports, the Premium list (social/index.ts)
 *   GET  /api/health   is the AI key set, and which model does which job
 *
 * Every sentence a response carries for a person is in their language and in the
 * app's voice (voice/index.ts): the language saved in the interview, else the
 * phone's, which the web app sends as `locale` in a scan and as the `x-lang` header.
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
    if ((n?.c ?? 0) >= max) return fail(429, 'rate_limited', say(requestLanguage(req, body), 'community.slow_attach'))
  }
  const out = await attachScan(env.DB, body, device, team, requestLanguage(req, body))
  if (!out.ok) return fail(out.status, out.code, out.message)
  await logEvent(env, 'scan_attach', device, team, { place: (body['place'] as { id?: string } | undefined)?.id ?? null, dishes: out.attached })
  return json(out)
}

export interface Env extends AiEnv {
  DB: D1Like
  ANTHROPIC_API_KEY?: string
  /** Explicit WebAuthn origin in production; loopback only in local development. */
  AUTH_ORIGIN?: string
  /** Which Claude model reads the menu photo. Default and rules: models.ts. */
  MODEL_READ?: string
  /** Which Claude model writes the words for the picked dishes. */
  MODEL_VOICE?: string
  /** Benchmarks only: a local stand-in for the AI service (scripts/mock-anthropic.mjs). */
  ANTHROPIC_BASE_URL?: string
  /** "off" answers every scan as one JSON body, even when the app asks for a stream (a streamed scan costs about twice the CPU). */
  SCAN_STREAM?: string
}

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, x-device, x-team, x-lang, x-menu-avoid',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
const fail = (status: number, code: string, message: string) => json({ error: { code, message } }, status)

const GOALS = new Set(['lose_fat', 'build_muscle', 'balanced', 'plant_based'])

/**
 * The language to answer this request in: the one saved in the interview (the
 * profile in a scan), else the phone's as the web app sent it (`locale` in the
 * body or the `x-lang` header), else the browser's own Accept-Language, else English.
 */
function requestLanguage(req: Request, body?: Record<string, unknown> | null): Lang {
  const profile = body?.['profile']
  return userLanguage({
    saved: profile && typeof profile === 'object' ? (profile as Record<string, unknown>)['language'] : undefined,
    locale: body?.['locale'] ?? req.headers.get('x-lang'),
    acceptLanguage: req.headers.get('accept-language'),
  })
}

function parseProfile(raw: unknown, language: Lang): Profile | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r['goal'] !== 'string' || !GOALS.has(r['goal'])) return null
  const allergies = Array.isArray(r['allergies']) ? (r['allergies'] as unknown[]).filter((a): a is string => typeof a === 'string').slice(0, 20) : []
  const plantStyle = r['plantStyle'] === 'vegetarian' ? 'vegetarian' : 'vegan'
  const diet = readDiet(r['diet'])
  return { goal: r['goal'] as Profile['goal'], plantStyle, ...(diet ? { diet } : {}), allergies, language }
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

/** What a streamed scan sends, one `data: <json>` block per event, in this order. See STREAMING.md. */
export type ScanEvent =
  | { type: 'start'; scanId: string }
  | { type: 'menu'; restaurant: string | null; menuLanguage: string; cuisine: string }
  | { type: 'dish'; index: number; dish: DishEstimate }
  | { type: 'result'; result: MenuResult }
  | { type: 'tips'; tips: OrderTip[] }
  | { type: 'done'; timings: Record<string, number> }
  | { type: 'error'; status: number; error: { code: string; message: string } }

class ScanError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message)
  }
}

const MAX_DISHES = 24
const SSE_HEADERS = { ...JSON_HEADERS, 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' }

interface ScanInput { image: string; mediaType: 'image/jpeg' | 'image/png' | 'image/webp'; profile: Profile; device: string | null; team: boolean; table: boolean; /** The person's taste and what is left of their day (me/rank.ts): their picks get words too. */ me?: MeCtx | null }

/**
 * One scan. With `emit` (a streamed scan) each dish is estimated the moment the
 * model has written it, so the app shows dishes long before the read ends and
 * the engine's work overlaps the model's. Tips come last in both modes.
 */
async function runScan(input: ScanInput, env: Env, emit?: (ev: ScanEvent) => void): Promise<MenuResult> {
  const { image, mediaType, profile, device, team } = input
  const ai: Ai = { ...aiSettings(env), served: {} }
  const t0 = Date.now()
  const scanId = crypto.randomUUID()
  emit?.({ type: 'start', scanId })

  const lookup = new FoodLookup(d1Runner(env.DB))
  const deps = { lookup, off: (q: string) => lookupOpenFoodFacts(q) }
  const started: Array<ReturnType<typeof estimateDish>> = []
  let firstDishMs = 0
  let menuSent = false

  // A streamed scan reads the model's answer as it is written. A plain scan
  // takes it as one response: nothing would be shown earlier, and one JSON
  // document costs far less Worker CPU than 1,500 stream events.
  const read = !emit
    ? await readMenu(ai, image, mediaType, profile)
    : await readMenuStream(ai, image, mediaType, profile, (dish, i, head) => {
        if (i >= MAX_DISHES) return
        firstDishMs ||= Date.now() - t0
        if (!menuSent && head.is_menu !== false) {
          menuSent = true
          emit({ type: 'menu', restaurant: head.restaurant_name ?? null, menuLanguage: head.menu_language ?? '', cuisine: head.cuisine ?? '' })
        }
        const est = estimateDish(dish, i, deps, profile)
        started[i] = est
        // A failed estimate surfaces below, where every dish is awaited.
        est.then((d) => emit({ type: 'dish', index: i, dish: { ...d, ...goalScore(d, profile) } }), () => {})
      })
  const t1 = Date.now()
  if (!read.is_menu || read.dishes.length === 0) {
    await logEvent(env, 'scan_not_menu', device, team, {})
    // The model says what is wrong with the photo in the user's language; without that, the fixed sentence.
    throw new ScanError(noAmounts(read.refusal_reason) || errorText(profile.language, 'not_menu').message, 422, 'not_menu')
  }

  const estimates = await Promise.all(read.dishes.slice(0, MAX_DISHES).map((d, i) => started[i] ?? estimateDish(d, i, deps, profile)))
  const t2 = Date.now()
  const ranking = rankDishes(estimates, profile)
  const result: MenuResult = {
    scanId,
    restaurant: read.restaurant_name,
    menuLanguage: read.menu_language,
    cuisine: read.cuisine,
    profile,
    dishes: ranking.dishes,
    top: ranking.top,
    avoid: ranking.avoid,
    tips: [],
    notes: [],
    timings: { readMs: t1 - t0, engineMs: t2 - t1, firstDishMs, rankedMs: t2 - t0 },
  }
  // The ranked menu is complete here; the app can show it while the words for the picks are written.
  emit?.({ type: 'result', result })

  // A group gets deterministic reasons for each person, not generic ordering tips.
  if (!input.table) {
    const picked = dishesToVoice(result, input.me).map((id) => ranking.dishes.find((d) => d.id === id)!).filter(Boolean)
    try { result.tips = await pickVoice(ai, picked, read.menu_language, profile) } catch { /* The engine's own lines still stand. */ }
  }
  const t3 = Date.now()
  result.timings = { ...result.timings, tipsMs: t3 - t2, totalMs: t3 - t0 }
  emit?.({ type: 'tips', tips: result.tips })

  await logEvent(env, 'scan', device, team, {
    scanId, dishes: result.dishes.length, shown: result.top.length, menuLanguage: read.menu_language,
    cuisine: read.cuisine, userLanguage: profile.language, goal: profile.goal, ms: t3 - t0,
    rankedMs: t2 - t0, firstDishMs, stream: emit ? 1 : 0, d1: lookup.stats.queries, d1Batches: lookup.stats.batches,
    // Which model answered each job, so real scans show what a model setting costs in seconds.
    readMs: t1 - t0, tipsMs: t3 - t2, readModel: ai.served?.read ?? null, voiceModel: ai.served?.voice ?? null,
  })
  return result
}

async function scanFailure(err: unknown, env: Env, input: ScanInput): Promise<{ status: number; code: string; message: string }> {
  const lang = input.profile.language
  if (err instanceof ScanError) return { status: err.status, code: err.code, message: err.message }
  if (err instanceof AiError) {
    await logEvent(env, 'scan_error', input.device, input.team, { code: err.code })
    // Provider error text can contain request details; log the code only.
    if (err.code === 'bad_request' || err.code === 'api' || err.code === 'unknown') console.error('menu failed', err.code)
    return { status: err.status, code: err.code, message: errorText(lang, err.code).message }
  }
  console.error('menu failed', err instanceof Error ? err.message : 'unknown')
  return { status: 500, code: 'internal', message: errorText(lang, 'internal').message }
}

async function handleMenu(req: Request, env: Env, ctx?: Ctx): Promise<Response> {
  setAiBaseUrl(env.ANTHROPIC_BASE_URL)
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return fail(400, 'bad_json', 'Request body must be JSON.')
  }
  const lang = requestLanguage(req, body)
  const profile = parseProfile(body['profile'], lang)
  if (!profile) return fail(400, 'bad_profile', 'Missing or invalid profile.')
  let image = typeof body['image'] === 'string' ? body['image'] : ''
  let mediaType: ScanInput['mediaType'] = 'image/jpeg'
  const m = /^data:(image\/(?:jpeg|png|webp));base64,/.exec(image)
  if (m) {
    mediaType = m[1] as typeof mediaType
    image = image.slice(m[0].length)
  }
  if (image.length < 1000) return fail(400, 'no_image', errorText(lang, 'no_image').message)
  if (image.length > 7_000_000) return fail(413, 'too_big', errorText(lang, 'too_big').message)
  const input: ScanInput = { image, mediaType, profile, device: typeof body['deviceId'] === 'string' ? body['deviceId'] : null, team: body['team'] === true, table: body['table'] === true, me: readMeCtx(body['me']) }

  if (body['stream'] !== true || env.SCAN_STREAM === 'off') {
    try {
      return json(await runScan(input, env))
    } catch (err) {
      const f = await scanFailure(err, env, input)
      return fail(f.status, f.code, f.message)
    }
  }

  // Streamed: the status is already 200 when the model answers, so a failure arrives as an `error` event.
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
  const writer = writable.getWriter()
  const enc = new TextEncoder()
  const emit = (ev: ScanEvent) => { writer.write(enc.encode(`data: ${JSON.stringify(ev)}\n\n`)).catch(() => {}) }
  const work = (async () => {
    try {
      const result = await runScan(input, env, emit)
      emit({ type: 'done', timings: result.timings })
    } catch (err) {
      const f = await scanFailure(err, env, input)
      emit({ type: 'error', status: f.status, error: { code: f.code, message: f.message } })
    } finally {
      await writer.close().catch(() => {})
    }
  })()
  ctx?.waitUntil(work)
  return new Response(readable, { headers: SSE_HEADERS })
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

/** Guest identity and analytics headers. Community replaces the guest actor with the verified session when present. */
function viewer(req: Request): community.Viewer {
  const d = req.headers.get('x-device')
  return { device: d && !d.startsWith('account-') && /^[A-Za-z0-9-]{8,64}$/.test(d) ? d : null, team: req.headers.get('x-team') === '1', lang: requestLanguage(req) }
}

const outJson = <T,>(o: community.Out<T>) => (o.ok ? json(o.data) : fail(o.status, o.code, o.message))
const privateRead = (response: Response) => {
  response.headers.set('cache-control', 'private, no-store')
  return response
}

async function handleCommunity(req: Request, env: Env, url: URL): Promise<Response | null> {
  const p = url.pathname
  if (!['/api/feed', '/api/post', '/api/photo', '/api/communities', '/api/membership', '/api/posts', '/api/comments', '/api/vote', '/api/save', '/api/report', '/api/delete'].includes(p)) return null
  const v = viewer(req)
  let accountUsername: string | undefined
  if (p !== '/api/photo') {
    const account = await sessionAccount(req, env.DB)
    if (account && req.method === 'POST' && (req.headers.get('origin') !== url.origin || req.headers.get('sec-fetch-site') === 'cross-site')) return fail(403, 'origin', 'Open PlatePal directly in your browser.')
    if (account) { v.device = account.id; accountUsername = account.username }
  }
  if (req.method === 'GET') {
    if (p === '/api/feed') return privateRead(json({ posts: await community.listPosts(env.DB, url, v) }))
    if (p === '/api/post') return privateRead(outJson(await community.getPost(env.DB, url.searchParams.get('id') ?? '', v)))
    if (p === '/api/communities') {
      const [communities, membership] = await Promise.all([community.communityCounts(env.DB), communityMembership(env.DB, v.device)])
      return privateRead(json({ communities: communities.map((c) => ({ ...c, ...(membership[c.id] ?? { members: 0, joined: false }) })) }))
    }
    if (p === '/api/photo') {
      const ph = await community.getPhoto(env.DB, url.searchParams.get('id') ?? '')
      return ph ? new Response(ph.bytes as unknown as BodyInit, { headers: { 'content-type': ph.type, 'cache-control': 'public, max-age=86400' } }) : fail(404, 'not_found', 'No photo.')
    }
    return null
  }
  if (req.method !== 'POST') return null
  if (p === '/api/membership') return setMembership(req, env.DB, v.device)
  const writes: Record<string, (db: Env['DB'], b: Record<string, unknown>, v: community.Viewer) => Promise<community.Out<unknown>>> = {
    '/api/posts': community.createPost, '/api/comments': community.createComment, '/api/vote': community.vote,
    '/api/save': community.save, '/api/report': community.report, '/api/delete': community.remove,
  }
  const fn = writes[p]
  if (!fn) return null
  let body: Record<string, unknown>
  try { body = (await req.json()) as Record<string, unknown> } catch { return fail(400, 'bad_json', 'Request body must be JSON.') }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400, 'bad_json', 'Request body must be JSON.')
  if (accountUsername && (p === '/api/posts' || p === '/api/comments')) body['nickname'] = accountUsername
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
  // How long real scans took, by the models that answered them (team scans count here: this is about the service, not about people).
  const timed = await all<TimedScan>("SELECT json_extract(props,'$.ms') ms, json_extract(props,'$.readMs') readMs, json_extract(props,'$.readModel') readModel, json_extract(props,'$.voiceModel') voiceModel FROM events WHERE type='scan' AND json_extract(props,'$.readModel') IS NOT NULL ORDER BY ts DESC LIMIT 500")
  return json({
    scans: scans.c, people: people.c, visitors: visitors.c, dishesRead: dishes.c, dishesRecommended: recommended.c,
    shareTaps: shares.c, corrections: corrections.c, menuLanguages: menuLangs, userLanguages: userLangs, cuisines,
    excludedTeamScans: teamScans.c,
    scanSeconds: scanSeconds(timed),
    delivery: { clicks: orderClicks.reduce((n, r) => n + r.c, 0), byProvider: orderClicks, votes: deliveryVotes.c },
    voice: await voiceNumbers(env.DB),
    community: await community.communityNumbers(env.DB), social: await socialNumbers(env.DB), generatedAt: new Date().toISOString(),
  })
}

export default {
  async fetch(req: Request, env: Env, ctx?: Ctx): Promise<Response> {
    const url = new URL(req.url)
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: JSON_HEADERS })
    try {
      if (url.pathname === '/api/health') return json({ ok: true, ai: Boolean(aiSettings(env).apiKey), provider: aiSettings(env).provider, models: { read: aiSettings(env).read, voice: aiSettings(env).voice } })
      if (url.pathname.startsWith('/api/account/')) return await handleAccount(req, env, url, () => ensureSchema(env))
      if (url.pathname === '/api/menu' && req.method === 'POST') return await handleMenu(req, env, ctx)
      // Sharing, link imports, the Premium list (src/social): null for every other path.
      const social = await handleSocial(req, env, url)
      if (social) return social
      if (url.pathname === '/api/event' && req.method === 'POST') return await handleEvent(req, env)
      const voice = await handleVoice(req, env, url, logEvent)
      if (voice) return voice
      if (url.pathname.startsWith('/api/me/')) { const m = await handleMe(req, env, url); if (m) return m }
      if (url.pathname !== '/api/menu' && url.pathname !== '/api/event') await ensureSchema(env)
      if (url.pathname === '/api/nearby-pick' && req.method === 'POST') {
        let body: Record<string, unknown> | null
        try { body = await req.json() as Record<string, unknown> | null } catch { return fail(400, 'bad_json', 'Request body must be JSON.') }
        const pick = body && await nearbyPick(env.DB, body)
        return pick ? json(pick) : fail(400, 'bad_request', 'Enter a short request and choose an area.')
      }
      if (url.pathname === '/api/numbers' && req.method === 'GET') return await handleNumbers(env)
      const c = await handleCommunity(req, env, url)
      if (c) return c
      const discover = await handleDiscover(req, env, url, ctx) // /api/discover/*: search, details, seed-oil
      if (discover) return discover
      if (url.pathname === '/api/places' && req.method === 'GET') {
        const out = await handlePlaces(url, env.DB, (p) => ctx?.waitUntil(p), req.headers.get('x-menu-avoid'))
        return out ? json(out) : fail(400, 'bad_position', 'Missing or invalid position.')
      }
      if (url.pathname === '/api/place' && req.method === 'GET') {
        const out = await handlePlace(url, env.DB, viewer(req).device, req.headers.get('x-menu-avoid'))
        return out ? json(out) : fail(400, 'bad_place', 'Unknown restaurant id.')
      }
      if (url.pathname === '/api/scan/attach' && req.method === 'POST') return await handleAttach(req, env)
      if (url.pathname === '/api/delivery-vote' && req.method === 'POST') {
        let body: Record<string, unknown>
        try { body = (await req.json()) as Record<string, unknown> } catch { return fail(400, 'bad_json', 'Request body must be JSON.') }
        const v = viewer(req)
        const out = await deliveryVote(env.DB, body, v.device, v.team, v.lang)
        if (out.ok) await logEvent(env, 'delivery_vote', v.device, v.team, { place: body['placeId'], value: body['value'] })
        return out.ok ? json(out.data) : fail(out.status, out.code, out.message)
      }
      const group = await handleGroup(req, env, url) // /api/group, /api/group/*: eating together (src/group)
      if (group) return group
      return fail(404, 'not_found', 'Not found.')
    } catch (err) {
      console.error('request failed', err instanceof Error ? err.message : 'unknown')
      return fail(500, 'internal', 'Server error.')
    }
  },
}
