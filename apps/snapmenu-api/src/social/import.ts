import { readDiet } from '../types.js'
import { AiError, setAiBaseUrl, type Ai } from '../anthropic.js'
import type { D1Like } from '../d1-adapter.js'
import { d1Runner, FoodLookup } from '../food-lookup.js'
import { estimateDish } from '../menu-engine.js'
import { modelSettings } from '../models.js'
import { lookupOpenFoodFacts } from '../off.js'
import { goalScore } from '../ranking.js'
import type { DishEstimate, Profile } from '../types.js'
import { errorText, noAmounts, type Lang } from '../voice/index.js'
import { saySocial } from './copy.js'
import { cleanRead, identifyMeal, type Hint, type ImportRead } from './identify.js'
import { cleanUrl, extractUrl, PLATFORM_LABEL, platformOf, safeUrl, type Platform } from './links.js'
import { fetchMeta, fetchPreviewImage, type FetchLike, type LinkMeta } from './meta.js'
import { bad, logSocial, recentCount, SOCIAL_LIMITS, type Out } from './schema.js'
import type { ImportResult, ImportSource, ImportStatus } from './types.js'

/**
 * Save a meal from a link: Instagram, TikTok, YouTube, Facebook or any page.
 *
 *   1. the link's public preview (meta.ts): oEmbed or OpenGraph, nothing behind a login;
 *   2. the reading model names the meal and the restaurant (identify.ts);
 *   3. the Nut AI engine computes every number, exactly like a scanned dish.
 *
 * A source that does not answer is not an error: the person is told so in one
 * sentence and asked what the meal is, and what they type goes through steps 2
 * and 3 the same way.
 */

export interface ImportEnv {
  DB: D1Like
  ANTHROPIC_API_KEY?: string
  MODEL_READ?: string
  MODEL_VOICE?: string
  ANTHROPIC_BASE_URL?: string
}

export interface Importer { device: string | null; team: boolean; lang: Lang }

const GOALS = new Set(['lose_fat', 'build_muscle', 'balanced', 'plant_based'])
const CACHE_MS = 7 * 24 * 3600_000

/** The profile sent along, or a neutral one: an import works before the interview too. */
export function importProfile(raw: unknown, language: Lang): Profile {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const goal = typeof r['goal'] === 'string' && GOALS.has(r['goal']) ? (r['goal'] as Profile['goal']) : 'balanced'
  const allergies = Array.isArray(r['allergies']) ? r['allergies'].filter((a): a is string => typeof a === 'string').slice(0, 20) : []
  const diet = readDiet(r['diet'])
  return { goal, plantStyle: r['plantStyle'] === 'vegetarian' ? 'vegetarian' : 'vegan', ...(diet ? { diet } : {}), allergies, language }
}

const hintText = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined
  const t = v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
  return t || undefined
}

async function cacheKey(url: string, lang: string, hint: Hint): Promise<string> {
  const data = new TextEncoder().encode(`${url}|${lang}|${(hint.dish ?? '').toLowerCase()}|${(hint.restaurant ?? '').toLowerCase()}`)
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data))
  return [...hash.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const sourceOf = (meta: LinkMeta | null, platform: Platform, url: string): ImportSource => ({
  platform,
  label: platform === 'web' ? meta?.site ?? hostOf(url) : PLATFORM_LABEL[platform],
  url: meta?.url ?? url,
  title: meta?.title ?? null,
  author: meta?.author ?? null,
  image: meta?.image ?? null,
})

const hostOf = (url: string): string => {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return 'Web' }
}

export async function importLink(env: ImportEnv, body: Record<string, unknown>, who: Importer, doFetch: FetchLike = fetch): Promise<Out<ImportResult>> {
  const link = safeUrl(extractUrl(body['url']) ?? extractUrl(body['text']))
  if (!link) return bad(400, 'bad_link', saySocial(who.lang, 'bad_link'))

  const { max, windowMs } = SOCIAL_LIMITS.import
  if ((await recentCount(env.DB, 'import', who.device, Date.now() - windowMs)) >= max) return bad(429, 'rate_limited', saySocial(who.lang, 'slow'))

  const rawHint = body['hint'] && typeof body['hint'] === 'object' ? (body['hint'] as Record<string, unknown>) : {}
  const hint: Hint = { dish: hintText(rawHint['dish']), restaurant: hintText(rawHint['restaurant']) }
  const hasHint = Boolean(hint.dish || hint.restaurant)
  const profile = importProfile(body['profile'], who.lang)
  let platform = platformOf(link)
  const url = cleanUrl(link)
  const log = (status: string, extra: Record<string, unknown> = {}) => logSocial(env.DB, 'import', who.device, who.team, { platform, status, hint: hasHint, ...extra })

  // A link read before, in this language, is not fetched or sent to the model again.
  const key = await cacheKey(url, who.lang, hint)
  let meta: LinkMeta | null = null
  let read: ImportRead | null = null
  const cached = await env.DB.prepare('SELECT meta, read, ts FROM import_cache WHERE key = ?').bind(key).first<{ meta: string | null; read: string; ts: number }>()
  if (cached && cached.ts > Date.now() - CACHE_MS) {
    try {
      meta = cached.meta ? (JSON.parse(cached.meta) as LinkMeta) : null
      read = cleanRead(JSON.parse(cached.read))
      if (meta) platform = meta.platform
    } catch { meta = null; read = null }
  }
  const fromCache = read !== null

  if (!read) {
    const got = await fetchMeta(link, doFetch)
    if (got.ok) { meta = got.meta; platform = got.meta.platform } else platform = got.platform
    if (!got.ok && !hasHint) {
      await log('blocked', { reason: got.reason })
      const site = platform === 'web' ? hostOf(url) : PLATFORM_LABEL[platform]
      return { ok: true, data: { status: 'blocked', source: sourceOf(null, platform, got.url), restaurant: null, dish: null, message: saySocial(who.lang, got.reason === 'blocked' ? 'blocked' : 'unreachable', { site }), fromHint: false } }
    }

    setAiBaseUrl(env.ANTHROPIC_BASE_URL)
    const ai: Ai = { apiKey: env.ANTHROPIC_API_KEY, ...modelSettings(env), served: {} }
    try {
      // The preview picture helps most where the caption says least. Not needed once the person said what it is.
      const image = meta?.image && !hint.dish ? await fetchPreviewImage(meta.image, doFetch) : null
      read = await identifyMeal(ai, meta, hint, who.lang, image)
    } catch (err) {
      const code = err instanceof AiError ? err.code : 'internal'
      await log('error', { code })
      if (!(err instanceof AiError)) console.error('import failed', err instanceof Error ? err.message : 'unknown')
      else if (code === 'bad_request' || code === 'api' || code === 'unknown') console.error('import failed', code, err.message.slice(0, 300))
      const known = code === 'rate_limited' || code === 'no_key' || code === 'auth' || code === 'connection'
      return bad(err instanceof AiError ? err.status : 500, code, known ? errorText(who.lang, code).message : saySocial(who.lang, 'failed'))
    }
  }

  const source = sourceOf(meta, platform, url)
  const restaurant = read.restaurant_name ? { name: read.restaurant_name, city: read.restaurant_city } : hint.restaurant ? { name: hint.restaurant, city: null } : null

  if (!read.is_food && !read.dish) {
    await log('not_food')
    // The model says what is missing in the person's language; without that, the fixed sentence.
    return { ok: true, data: { status: 'not_food', source, restaurant: null, dish: null, message: noAmounts(read.refusal_reason) || saySocial(who.lang, 'not_food'), fromHint: hasHint } }
  }

  if (!fromCache) {
    await env.DB.prepare('INSERT INTO import_cache (key, ts, platform, meta, read) VALUES (?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET ts = excluded.ts, platform = excluded.platform, meta = excluded.meta, read = excluded.read')
      .bind(key, Date.now(), platform, meta ? JSON.stringify(meta) : null, JSON.stringify(read))
      .run()
      .catch(() => { /* a cache that could not be written costs one more read next time */ })
  }

  if (!read.dish) {
    await log('needs_dish')
    return { ok: true, data: { status: 'needs_dish', source, restaurant, dish: null, message: saySocial(who.lang, 'needs_dish'), fromHint: hasHint } }
  }

  // Every number from here on is the engine's: the model named the dish and its parts, nothing more.
  const lookup = new FoodLookup(d1Runner(env.DB))
  const estimate = await estimateDish(read.dish, 0, { lookup, off: (q: string) => lookupOpenFoodFacts(q) }, profile)
  const dish: DishEstimate = { ...estimate, ...goalScore(estimate, profile) }
  await log('ok', { cached: fromCache, recipe: dish.recipe?.key ?? null, via: meta?.via ?? null })
  return { ok: true, data: { status: 'ok', source, restaurant, dish, message: null, fromHint: Boolean(hint.dish) } }
}

export type { ImportResult, ImportSource, ImportStatus }
