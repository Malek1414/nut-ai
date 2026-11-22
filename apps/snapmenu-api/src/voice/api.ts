import { aiSettings, type AiEnv } from '../ai-config.js'
import { readDiet } from '../types.js'
/**
 * The routes of the menu chat and of voice messages. One line in the Worker's
 * router hands them over (`handleVoice` in ../index.ts):
 *
 *   POST /api/chat              a question about a scanned menu -> an answer in the user's language
 *
 * Every chat message is logged as `chat_message` and every spoken one also as
 * `voice_message`, for /numbers. Neither the audio nor the words are stored.
 */
import { AiError, setAiBaseUrl, type Ai } from '../anthropic.js'
import type { D1Like } from '../d1-adapter.js'
import type { Profile } from '../types.js'
import { sayChat, type ChatKey } from './chat-copy.js'
import type { ChatReply } from './chat-types.js'
import { answerChat, CHAT_LIMITS, parseHistory, parseMenu } from './chat.js'
import { userLanguage, type Lang } from './index.js'
import { allow, VOICE_LIMITS } from './limits.js'
import { languageCode, VOICE_MESSAGE_SECONDS } from './speech.js'

/** What the voice routes read from the Worker's environment (a subset of `Env` in ../index.ts). */
export interface VoiceEnv extends AiEnv {
  DB: D1Like
  ANTHROPIC_API_KEY?: string
  MODEL_READ?: string
  MODEL_VOICE?: string
  ANTHROPIC_BASE_URL?: string
  /** Chat answers a day across the app; the default is in ./limits.ts. */
  VOICE_CHAT_DAILY?: string
}

type Log<E> = (env: E, type: string, device: string | null, team: boolean, props: Record<string, unknown>) => Promise<void>

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, x-device, x-team, x-lang',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS })
const fail = (status: number, code: string, message: string) => json({ error: { code, message } }, status)
const sorry = (status: number, code: string, lang: Lang, key: ChatKey) => fail(status, code, sayChat(lang, key))

const DEVICE = /^[A-Za-z0-9-]{8,64}$/
const GOALS = new Set(['lose_fat', 'build_muscle', 'balanced', 'plant_based'])

function parseProfile(raw: unknown, language: Lang): Profile | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r['goal'] !== 'string' || !GOALS.has(r['goal'])) return null
  const allergies = Array.isArray(r['allergies']) ? r['allergies'].filter((a): a is string => typeof a === 'string' && /^[a-z_]{2,24}$/.test(a)).slice(0, 20) : []
  const diet = readDiet(r['diet'])
  return { goal: r['goal'] as Profile['goal'], plantStyle: r['plantStyle'] === 'vegetarian' ? 'vegetarian' : 'vegan', ...(diet ? { diet } : {}), allergies, language }
}

async function handleChat<E extends VoiceEnv>(req: Request, env: E, log: Log<E>): Promise<Response> {
  setAiBaseUrl(env.ANTHROPIC_BASE_URL)
  let body: Record<string, unknown>
  try {
    const raw = await req.text()
    if (raw.length > 200_000) return fail(413, 'too_big', 'Request too large.')
    body = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return fail(400, 'bad_json', 'Request body must be JSON.')
  }
  // `null`, a list or a bare string is valid JSON but not a request.
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400, 'bad_json', 'Request body must be a JSON object.')
  const saved = (body['profile'] as { language?: unknown } | null | undefined)?.language
  const lang = userLanguage({ saved, locale: body['locale'] ?? req.headers.get('x-lang'), acceptLanguage: req.headers.get('accept-language') })
  const device = [body['deviceId'], req.headers.get('x-device')].find((d): d is string => typeof d === 'string' && DEVICE.test(d)) ?? null
  const team = body['team'] === true || req.headers.get('x-team') === '1'
  if (!device) return fail(400, 'no_device', 'Missing device id.')

  const message = typeof body['message'] === 'string' ? body['message'].replace(/\s+/g, ' ').trim().slice(0, CHAT_LIMITS.message) : ''
  if (!message) return sorry(400, 'empty', lang, 'chat.empty')
  const profile = parseProfile(body['profile'], lang)
  if (!profile) return fail(400, 'bad_profile', 'Missing or invalid profile.')
  const menu = parseMenu(body['menu'])
  if (!menu) return sorry(400, 'no_menu', lang, 'chat.no_menu')
  if (!aiSettings(env).apiKey) return sorry(503, 'no_key', lang, 'chat.off')

  const ceiling = Number(env.VOICE_CHAT_DAILY)
  const allowed = await allow(env.DB, device, Date.now(), Number.isFinite(ceiling) && ceiling > 0 ? ceiling : VOICE_LIMITS.chatCeiling)
  if (!allowed.ok) {
    await log(env, 'chat_limited', device, team, { why: allowed.why })
    return sorry(429, 'rate_limited', lang, allowed.why === 'device' ? 'chat.slow' : 'chat.busy')
  }

  const via = body['via'] === 'voice' ? 'voice' : 'text'
  const ai: Ai = { ...aiSettings(env) }
  const t0 = Date.now()
  let answer: Awaited<ReturnType<typeof answerChat>>
  try {
    answer = await answerChat(ai, { message, history: parseHistory(body['history']), menu, profile })
  } catch (err) {
    const code = err instanceof AiError ? err.code : 'internal'
    await log(env, 'chat_error', device, team, { code })
    if (!(err instanceof AiError)) console.error('chat failed', err instanceof Error ? err.message : 'unknown')
    else if (code === 'bad_request' || code === 'api' || code === 'unknown') console.error('chat failed', code, err.message.slice(0, 300))
    if (code === 'rate_limited') return sorry(503, code, lang, 'chat.busy')
    if (code === 'no_key' || code === 'auth') return sorry(503, code, lang, 'chat.off')
    return sorry(code === 'connection' ? 504 : 502, code, lang, 'chat.failed')
  }
  // Every sentence carried a number of the model's own: the dishes still answer, with the engine's numbers.
  const reply = answer.reply ?? (answer.dishIds.length > 0 ? sayChat(lang, 'chat.look') : null)
  if (!reply) {
    await log(env, 'chat_error', device, team, { code: 'no_answer' })
    return sorry(502, 'no_answer', lang, 'chat.failed')
  }

  const voice = (body['voice'] ?? {}) as Record<string, unknown>
  const seconds = typeof voice['seconds'] === 'number' && Number.isFinite(voice['seconds']) ? Math.min(VOICE_MESSAGE_SECONDS, Math.max(0, Math.round(voice['seconds']))) : null
  await log(env, 'chat_message', device, team, { via, scanId: menu.scanId, userLanguage: lang, ms: Date.now() - t0, model: answer.model, dishes: answer.dishIds.length, gated: answer.gated ? 1 : 0, turn: parseHistory(body['history']).length })
  if (via === 'voice') await log(env, 'voice_message', device, team, { context: 'chat', seconds, stt: 'browser', userLanguage: lang })
  return json({ reply, dishIds: answer.dishIds, language: lang, tag: languageCode(lang) } satisfies ChatReply)
}

/** The voice routes; null for any other path. `log` is the Worker's own event writer. */
export async function handleVoice<E extends VoiceEnv>(req: Request, env: E, url: URL, log: Log<E>): Promise<Response | null> {
  const p = url.pathname
  if (p === '/api/chat' && req.method === 'POST') return handleChat(req, env, log)
  return null
}

/** Chat and voice for /numbers: messages, spoken ones, and the people who asked (team devices excluded). */
export async function voiceNumbers(db: D1Like): Promise<{ chatMessages: number; voiceMessages: number; people: number }> {
  const rows = (await db.prepare("SELECT type, COUNT(*) c, COUNT(DISTINCT device) d FROM events WHERE type IN ('chat_message','voice_message') AND team=0 GROUP BY type").all<{ type: string; c: number; d: number }>()).results
  const of = (type: string) => rows.find((r) => r.type === type)
  return { chatMessages: of('chat_message')?.c ?? 0, voiceMessages: of('voice_message')?.c ?? 0, people: of('chat_message')?.d ?? 0 }
}
