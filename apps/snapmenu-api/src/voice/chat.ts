/**
 * "Ask about this menu": one question about a scanned menu, answered by the
 * voice model (MODEL_VOICE) in the plain friend voice and the user's language.
 *
 * The rule of the whole app holds here too: a number on the screen is the
 * engine's, never a model's. The model is told what the engine worked out so
 * it can compare dishes, and it answers in words only. A sentence it writes
 * with a numeral in it is left out (`replyWords`). The numbers a person sees
 * next to an answer are the engine's own, shown by the app for the dishes the
 * answer names (`dishIds`).
 */
import { AiError, create, textOf, type Ai } from '../anthropic.js'
import { PROVEN_MODEL, quickAnswer } from '../models.js'
import type { Profile } from '../types.js'
import { CHAT_LIMITS, type ChatDish, type ChatInput, type ChatMenu, type ChatTurn } from './chat-types.js'
import { allergenName, modelWords, voicePrompt } from './index.js'

export { CHAT_LIMITS }
export type { ChatDish, ChatInput, ChatMenu, ChatTurn }

// ---------- What the app sends (shapes: ./chat-types.ts) ----------


const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
const num = (v: unknown, max: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(0, Math.round(v))) : 0)
const ids = (v: unknown, max: number): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && /^[a-z_]{2,24}$/.test(x)).slice(0, max) : [])
const DISH_ID = /^[A-Za-z0-9_-]{1,24}$/

function parseDish(raw: unknown): ChatDish | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = typeof r['id'] === 'string' && DISH_ID.test(r['id']) ? r['id'] : ''
  const name = text(r['name'], 120)
  if (!id || !name) return null
  const kcal = (r['kcal'] ?? {}) as Record<string, unknown>
  const low = num(kcal['low'], 9000)
  return {
    id,
    name,
    translated: text(r['translated'], 120),
    description: text(r['description'], 200),
    price: text(r['price'], 24) || null,
    course: text(r['course'], 12) || 'main',
    made: Array.isArray(r['made']) ? r['made'].map((m) => text(m, 40)).filter(Boolean).slice(0, 8) : [],
    kcal: { low, high: Math.max(low, num(kcal['high'], 9000)) },
    protein: num(r['protein'], 900),
    carbs: num(r['carbs'], 900),
    fat: num(r['fat'], 900),
    vegetarian: r['vegetarian'] === true,
    vegan: r['vegan'] === true,
    allergens: ids(r['allergens'], 14),
    allergyHits: ids(r['allergyHits'], 14),
  }
}

/** The menu a question is about, as the app sent it; null when there is no dish in it. */
export function parseMenu(raw: unknown): ChatMenu | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const dishes: ChatDish[] = []
  for (const d of Array.isArray(r['dishes']) ? r['dishes'].slice(0, CHAT_LIMITS.dishes) : []) {
    const dish = parseDish(d)
    if (dish && !dishes.some((x) => x.id === dish.id)) dishes.push(dish)
  }
  if (dishes.length === 0) return null
  const known = new Set(dishes.map((d) => d.id))
  const top = Array.isArray(r['top']) ? r['top'].filter((x): x is string => typeof x === 'string' && known.has(x)).slice(0, 5) : []
  const avoid: ChatMenu['avoid'] = []
  for (const a of Array.isArray(r['avoid']) ? r['avoid'].slice(0, CHAT_LIMITS.dishes) : []) {
    const dishId = (a as { dishId?: unknown } | null)?.dishId
    if (typeof dishId === 'string' && known.has(dishId)) avoid.push({ dishId, reason: text((a as { reason?: unknown }).reason, 160) })
  }
  return {
    scanId: text(r['scanId'], 64) || null,
    restaurant: text(r['restaurant'], 80) || null,
    menuLanguage: text(r['menuLanguage'], 40) || 'unknown',
    cuisine: text(r['cuisine'], 40),
    dishes,
    top,
    avoid,
  }
}

/** The last turns of the conversation, oldest first. */
export function parseHistory(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) return []
  const turns: ChatTurn[] = []
  for (const t of raw.slice(-CHAT_LIMITS.history)) {
    const role = (t as { role?: unknown } | null)?.role
    const words = text((t as { text?: unknown } | null)?.text, CHAT_LIMITS.turn)
    if ((role === 'user' || role === 'assistant') && words) turns.push({ role, text: words })
  }
  return turns
}

// ---------- The request ----------

const CHAT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'dish_ids'],
  properties: {
    reply: { type: 'string' },
    dish_ids: { type: 'array', items: { type: 'string' } },
  },
}

const CHAT_SYSTEM = `You are the voice of a food app. A guest photographed a restaurant menu and now asks you about it, by voice or by typing. The app's food database worked out the numbers for every dish; you only put the answer into words.

What you get: the guest's goal and allergies, the dishes on the menu with what the database found, the app's own picks, and the conversation so far.

How to answer:
- Answer the guest's last message, in the guest's language, in at most three short sentences. Plain text only: no lists, no headings, no markup.
- Use only this menu and the facts given. When the menu does not say, tell them so plainly and suggest asking the waiter. Never invent a dish, an ingredient or a price.
- Compare dishes with words ("the lightest one here", "more protein than the pasta"). The numbers are there so you compare correctly; you never repeat them.
- dish_ids: the ids of the dishes your answer is about, best first, at most three. The app shows the numbers of exactly these dishes under your answer. Leave it empty when no dish is meant.
- Allergies: you can say what a dish likely contains and why. Never say a dish is safe or free of something. For an allergy question, end by saying to check with the restaurant.
- A change to a dish (sauce on the side, salad instead of fries, no cheese) is a fine thing to suggest when it serves the goal.
- Stay with this menu and with food. For anything else, say in one friendly sentence that you only help with this menu.
- Call a dish by its name, never by its id or a menu number.

How to write:
${voicePrompt()}`

const GOAL_TEXT: Record<Profile['goal'], string> = {
  lose_fat: 'lose fat (fewer calories, keep protein high)',
  build_muscle: 'build muscle (more protein)',
  balanced: 'eat balanced',
  plant_based: 'eat plant-based',
}

function dishLine(d: ChatDish, menu: ChatMenu): string {
  const pick = menu.top.indexOf(d.id)
  const skip = menu.avoid.find((a) => a.dishId === d.id)
  return [
    `${d.id}: ${d.name}${d.translated && d.translated !== d.name ? ` (${d.translated})` : ''} [${d.course}]${d.price ? `, price ${d.price}` : ''}.`,
    d.description ? `Menu says: ${d.description}.` : '',
    `Made of: ${d.made.join(', ') || 'not known'}.`,
    `Database: ${d.kcal.low} to ${d.kcal.high} kcal, protein ${d.protein} g, carbs ${d.carbs} g, fat ${d.fat} g.`,
    d.vegan ? 'Vegan.' : d.vegetarian ? 'Vegetarian, not vegan.' : 'Not vegetarian.',
    d.allergens.length ? `Likely contains: ${d.allergens.map((a) => allergenName('English', a)).join(', ')}.` : '',
    d.allergyHits.length ? `HITS THE GUEST'S ALLERGY: ${d.allergyHits.map((a) => allergenName('English', a)).join(', ')}.` : '',
    pick >= 0 ? `App pick number ${pick + 1}.` : '',
    skip ? `App says skip${skip.reason ? `: ${skip.reason}` : ''}.` : '',
  ].filter(Boolean).join(' ')
}

/** The chat call as it is sent to `model`. Exported for tests. */
export function chatRequest(model: string, input: ChatInput) {
  const { menu, profile, history, message } = input
  const talk = history.map((t) => `${t.role === 'user' ? 'Guest' : 'You'}: ${t.text}`).join('\n')
  const content = [
    `Guest's language: ${profile.language}. Menu language: ${menu.menuLanguage}.${menu.restaurant ? ` Restaurant: ${menu.restaurant}.` : ''}${menu.cuisine ? ` Cuisine: ${menu.cuisine}.` : ''}`,
    `Goal: ${GOAL_TEXT[profile.goal]}${profile.goal === 'plant_based' ? ` (${profile.plantStyle ?? 'vegan'})` : ''}. Allergies: ${profile.allergies.map((a) => a.replace(/_/g, ' ')).join(', ') || 'none'}.`,
    `Dishes:\n${menu.dishes.map((d) => dishLine(d, menu)).join('\n')}`,
    talk ? `Conversation so far:\n${talk}` : '',
    `Guest's message: ${message}`,
  ].filter(Boolean).join('\n\n')
  return {
    model,
    // Room for a model that thinks before it writes; the answer itself is a few sentences.
    max_tokens: 3000,
    ...quickAnswer(model, CHAT_SCHEMA),
    system: CHAT_SYSTEM,
    messages: [{ role: 'user', content }],
  }
}

// ---------- The gate ----------

/**
 * Markup a model adds although it is told not to. Emphasis marks go without a
 * trace ("**grilled chicken**." reads "grilled chicken.", not "grilled chicken ."),
 * heading and quote marks become a space.
 */
function plainText(raw: string): string {
  return raw
    .replace(/[*`~]+/g, '')
    .replace(/(^|[^\p{L}\p{N}_])_+(?=[\p{L}\p{N}])/gu, '$1')
    .replace(/([\p{L}\p{N}])_+(?=[^\p{L}\p{N}_]|$)/gu, '$1')
    .replace(/[#>_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * An answer the model wrote, as it may be shown: its sentences without a
 * numeral, joined again. A sentence with a number of the model's own is left
 * out; a numeral the menu itself prints in a dish name ("Pizza 4 Formaggi")
 * may be repeated. `text` is null when nothing is left; `dropped` counts the
 * sentences that were left out.
 */
export function gateReply(raw: unknown, printed = '', maxLength: number = CHAT_LIMITS.reply): { text: string | null; dropped: number } {
  if (typeof raw !== 'string') return { text: null, dropped: 0 }
  const clean = plainText(raw)
  if (!clean) return { text: null, dropped: 0 }
  const sentences = clean.match(/[^.!?؟…]+[.!?؟…]*["”’)]*\s*/gu) ?? [clean]
  const kept: string[] = []
  let length = 0
  let dropped = 0
  for (const s of sentences) {
    const ok = modelWords(s, printed, 400)
    if (!ok || length + ok.length > maxLength) { dropped++; continue }
    kept.push(ok)
    length += ok.length + 1
  }
  return { text: kept.length ? kept.join(' ') : null, dropped }
}

/** `gateReply`, the words only. */
export const replyWords = (raw: unknown, printed = '', maxLength: number = CHAT_LIMITS.reply): string | null => gateReply(raw, printed, maxLength).text

export interface ChatAnswer {
  /** The answer in words, or null when every sentence had to be left out. */
  reply: string | null
  /** The dishes the answer is about: the app shows the engine's numbers for these. */
  dishIds: string[]
  /** Whether a sentence of the model was left out for carrying a number. */
  gated: boolean
  model: string
}

/** Ask the voice model. A setting the service turns down is answered by the proven model, like every other call. */
export async function answerChat(ai: Ai, input: ChatInput): Promise<ChatAnswer> {
  let model = ai.voice
  let msg: Awaited<ReturnType<typeof create>>
  try {
    msg = await create(ai.apiKey, chatRequest(model, input))
  } catch (err) {
    if (!(err instanceof AiError && err.code === 'bad_request') || model === PROVEN_MODEL) throw err
    console.warn(`MODEL_VOICE=${model} was turned down for the menu chat; answered with ${PROVEN_MODEL} instead.`)
    model = PROVEN_MODEL
    msg = await create(ai.apiKey, chatRequest(model, input))
  }
  let out: { reply?: unknown; dish_ids?: unknown }
  try {
    out = JSON.parse(textOf(msg)) as typeof out
  } catch (err) {
    if (err instanceof AiError) throw err
    throw new AiError('The chat answer could not be read.', 502, 'parse')
  }
  const known = new Map(input.menu.dishes.map((d) => [d.id, d]))
  const dishIds: string[] = []
  for (const id of Array.isArray(out.dish_ids) ? out.dish_ids : []) {
    if (typeof id === 'string' && known.has(id) && !dishIds.includes(id) && dishIds.length < CHAT_LIMITS.dishIds) dishIds.push(id)
  }
  const printed = input.menu.dishes.map((d) => `${d.name} ${d.translated}`).join(' ')
  const gate = gateReply(out.reply, printed)
  return { reply: gate.text, dishIds, gated: gate.dropped > 0, model }
}
