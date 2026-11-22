import { aiSettings, type AiEnv } from '../ai-config.js'
import { readDiet } from '../types.js'
import { setAiBaseUrl, type Ai } from '../anthropic.js'
import type { D1Like } from '../d1-adapter.js'
import { lookupOpenFoodFacts } from '../off.js'
import type { Profile } from '../types.js'
import { userLanguage, type Lang } from '../voice/index.js'
import { sayEstimate } from './estimate-copy.js'
import { describeMeal, estimateTyped, EVENTS_SQL, ME_READS_SQL } from './estimate.js'

/**
 * The Me routes of the Worker.
 *
 *   POST /api/me/estimate   { text, profile, locale?, deviceId?, team? }
 *                           -> { dishes: DishEstimate[], source: 'table' | 'cache' | 'ai' }
 *                           a typed meal as one to four dishes, numbers from the engine (estimate.ts)
 *
 * Registered in ../index.ts with one line. Every sentence in a response is in
 * the person's language: the one saved in their profile, else the phone's.
 */

/** The part of the Worker's environment these routes read. */
export interface MeEnv extends AiEnv {
  DB: D1Like
  ANTHROPIC_API_KEY?: string
  MODEL_READ?: string
  MODEL_VOICE?: string
  ANTHROPIC_BASE_URL?: string
}

// The same headers index.ts answers with.
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, x-device, x-team, x-lang',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
const fail = (status: number, code: string, message: string) => json({ error: { code, message } }, status)

const GOALS = new Set(['lose_fat', 'build_muscle', 'balanced', 'plant_based'])

/** The profile as index.ts reads it for a scan. */
function parseProfile(raw: unknown, language: Lang): Profile | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r['goal'] !== 'string' || !GOALS.has(r['goal'])) return null
  const allergies = Array.isArray(r['allergies']) ? (r['allergies'] as unknown[]).filter((a): a is string => typeof a === 'string').slice(0, 20) : []
  const plantStyle = r['plantStyle'] === 'vegetarian' ? 'vegetarian' : 'vegan'
  const diet = readDiet(r['diet'])
  return { goal: r['goal'] as Profile['goal'], plantStyle, ...(diet ? { diet } : {}), allergies, language }
}

let ready: { db: D1Like; done: Promise<void> } | null = null
/** The cache table and the events table (the day's model calls are counted there) are made on first use, so a fresh local D1 works without a migration step. */
function ensureSchema(db: D1Like): Promise<void> {
  if (ready?.db !== db) {
    const made = { db, done: (async () => { for (const sql of [ME_READS_SQL, EVENTS_SQL]) await db.prepare(sql).run() })() }
    made.done.catch(() => { if (ready === made) ready = null })
    ready = made
  }
  return ready.done
}

async function handleEstimate(req: Request, env: MeEnv): Promise<Response> {
  setAiBaseUrl(env.ANTHROPIC_BASE_URL)
  let body: Record<string, unknown>
  try {
    const parsed: unknown = await req.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
    body = parsed as Record<string, unknown>
  } catch {
    return fail(400, 'bad_json', 'Request body must be JSON.')
  }
  const rawProfile = body['profile']
  const lang = userLanguage({
    saved: rawProfile && typeof rawProfile === 'object' ? (rawProfile as Record<string, unknown>)['language'] : undefined,
    locale: body['locale'] ?? req.headers.get('x-lang'),
    acceptLanguage: req.headers.get('accept-language'),
  })
  const profile = parseProfile(rawProfile, lang)
  if (!profile) return fail(400, 'bad_profile', 'Missing or invalid profile.')

  const id = typeof body['deviceId'] === 'string' ? body['deviceId'] : req.headers.get('x-device')
  const device = id && /^[A-Za-z0-9-]{8,64}$/.test(id) ? id : null
  // The estimate does not need the cache table: a database that cannot make it still answers.
  await ensureSchema(env.DB).catch(() => {})

  const ai: Ai = { ...aiSettings(env), served: {} }
  try {
    const out = await estimateTyped({
      db: env.DB,
      text: body['text'],
      profile,
      device,
      team: body['team'] === true,
      describe: (text, language) => describeMeal(ai, text, language),
      off: (q) => lookupOpenFoodFacts(q),
    })
    return out.ok ? json({ dishes: out.dishes, source: out.source }) : fail(out.status, out.code, sayEstimate(lang, out.copy))
  } catch (err) {
    console.error('typed meal failed', err instanceof Error ? err.message : 'unknown')
    return fail(500, 'internal', sayEstimate(lang, 'failed'))
  }
}

/** Answers a request under /api/me/, or null when the path is not one of these routes. */
export async function handleMe(req: Request, env: MeEnv, url: URL): Promise<Response | null> {
  if (url.pathname === '/api/me/estimate' && req.method === 'POST') return handleEstimate(req, env)
  return null
}
