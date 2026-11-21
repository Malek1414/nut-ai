import Anthropic from '@anthropic-ai/sdk'
import { DISH_TABLE } from './dishes.js'
import { DishStream } from './dish-stream.js'
import { PROVEN_MODEL, quickAnswer, type Models } from './models.js'
import { dishFacts } from './ranking.js'
import type { DishEstimate, MenuRead, ModelDish, OrderTip, Profile } from './types.js'
import { languageTag, modelWords, sameLanguage, voicePrompt } from './voice/index.js'

/**
 * The only two model calls in Snapmenu, each with its own model setting
 * (models.ts): MODEL_READ reads the menu photo, MODEL_VOICE writes the words
 * for the picked dishes. Both return TEXT only: dish names, translations,
 * likely components, allergen hints, why a dish suits the guest, and a sentence
 * to say to the waiter. No call is ever asked for a calorie or gram number that
 * reaches the screen; `typical_grams` is the gram engine's lowest-trust tier and
 * is replaced by our recipe table whenever a dish is known.
 */

/** What a call needs: the key, and which model does which job. `served` is filled in with the models that answered. */
export interface Ai extends Models {
  apiKey: string | undefined
  served?: { read?: string; voice?: string }
}

/**
 * A failed call. `code` is what the rest of the app acts on: the sentence a
 * person sees for it comes from the voice module (`errorText`), in their
 * language. `message` is for logs.
 */
export class AiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message)
  }
}

const str = { type: 'string' } as const
const COMPONENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'usda_key', 'form', 'size', 'typical_grams', 'cooking'],
  properties: {
    name: str,
    usda_key: str,
    form: { type: 'string', enum: ['discrete', 'flat', 'piled', 'liquid', 'wrapped', 'spread'] },
    size: { type: 'string', enum: ['small', 'medium', 'large'] },
    typical_grams: { type: 'integer' },
    cooking: { type: 'string', enum: ['grilled', 'fried', 'deep_fried', 'boiled', 'raw', 'baked', 'sauce', 'none'] },
  },
}

/**
 * The streamed read asks for less text than the first version of the prompt:
 * no component `size` (the engine never read it), a description of one short
 * phrase and allergen reasons of a few words. Output tokens are what a scan
 * waits for, so every token not written is time back.
 */
const LEAN_COMPONENT_SCHEMA = {
  ...COMPONENT_SCHEMA,
  required: COMPONENT_SCHEMA.required.filter((k) => k !== 'size'),
  properties: Object.fromEntries(Object.entries(COMPONENT_SCHEMA.properties).filter(([k]) => k !== 'size')),
}

const menuSchema = (component: object) => ({
  type: 'object',
  additionalProperties: false,
  required: ['is_menu', 'refusal_reason', 'restaurant_name', 'menu_language', 'cuisine', 'dishes'],
  properties: {
    is_menu: { type: 'boolean' },
    refusal_reason: { type: ['string', 'null'] },
    restaurant_name: { type: ['string', 'null'] },
    menu_language: str,
    cuisine: str,
    dishes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name_original', 'name_translated', 'description_translated', 'price', 'course', 'dish_key', 'portion', 'components', 'has_meat', 'has_fish', 'has_dairy_or_egg', 'allergen_hints'],
        properties: {
          name_original: str,
          name_translated: str,
          description_translated: str,
          price: { type: ['string', 'null'] },
          course: { type: 'string', enum: ['main', 'starter', 'side', 'dessert', 'drink'] },
          dish_key: { type: 'string', enum: ['none', ...DISH_TABLE.map((d) => d.key)] },
          portion: { type: 'string', enum: ['small', 'regular', 'large'] },
          components: { type: 'array', items: component },
          has_meat: { type: 'boolean' },
          has_fish: { type: 'boolean' },
          has_dairy_or_egg: { type: 'boolean' },
          allergen_hints: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['allergen', 'reason'],
              properties: {
                allergen: { type: 'string', enum: ['gluten', 'crustaceans', 'eggs', 'fish', 'peanuts', 'soy', 'milk', 'tree_nuts', 'celery', 'mustard', 'sesame', 'sulphites', 'lupin', 'molluscs'] },
                reason: str,
              },
            },
          },
        },
      },
    },
  },
})

const MENU_SCHEMA = menuSchema(COMPONENT_SCHEMA)
const LEAN_MENU_SCHEMA = menuSchema(LEAN_COMPONENT_SCHEMA)

// The texts the reading model writes for a person follow the app's voice (voice/index.ts), like every other text.
const READ_VOICE = `
Everything you write in the user's language (name_translated, description_translated, allergen reasons, refusal_reason) is read by a guest at the table. Write it in the app's voice:
${voicePrompt()}
These rules are for those texts only. The printed name and the price have their own fields and stay exactly as printed, and typical_grams is still your best guess as a number.
`

const menuSystem = (lean: boolean) => `You read restaurant menus from photos for a nutrition app used across Europe.
You are a perception device: you transcribe and translate what is printed, and you name the likely components of each dish. You never state calories, macros or health claims; a deterministic engine computes every number from databases.

For each orderable dish on the menu (skip headings, opening hours, drinks unless they are the main items; include at most 24 dishes, mains first):
- name_original: exactly as printed (keep the original language and accents).
- name_translated / description_translated: in the user's language, short and plain${lean ? ' (the description is one phrase of at most 12 words)' : ''}; mention what the dish is if the name is opaque (e.g. "Lahmacun: thin flatbread with spiced minced meat").
- price: as printed with currency, or null.
- course: main, starter, side, dessert or drink.
- dish_key: if the dish is one of the known standard dishes listed below, its key; otherwise "none". Only use a key when the dish really is that dish (a chicken döner in bread is doner_kebab; an Adana kebab skewer is "none").
- portion: "large" only if the menu says XXL/gross/large/maxi or a clearly bigger size; "small" for klein/kids/half; otherwise "regular".
- components: when dish_key is not "none", return an empty array (the app has the recipe). Otherwise 2-7 likely components of one serving, the way it is usually served in this kind of restaurant (include bread, sauce, oil/butter and sides the menu mentions or that are standard). For each:
  - name: short English name ("Grilled chicken breast").
  - usda_key: a generic lowercase, comma-separated USDA FoodData Central style search string, head noun first, no brands, e.g. "chicken, breast, roasted", "rice, white, cooked", "cheese, feta", "potatoes, french fried", "sauce, pasta, spaghetti/marinara".
  - form: discrete (countable), flat, piled, liquid, wrapped or spread.
${lean ? '' : '  - size: small, medium or large relative to a normal serving of that component.\n'}  - typical_grams: your best guess of the grams in a typical restaurant serving (the engine treats this as its lowest-trust signal).
  - cooking: grilled, fried (pan), deep_fried, boiled, raw, baked, sauce or none.
- has_meat / has_fish / has_dairy_or_egg: from the menu text and the usual recipe.
- allergen_hints: EU allergens the dish likely contains, with a ${lean ? 'reason of a few words' : 'short reason'} in the user's language. If the menu prints allergen codes or footnotes (e.g. "A, C, G" or "1,3"), decode them using the menu's own legend when visible and say so in the reason.

If the photo is not a menu or is unreadable, set is_menu=false, give refusal_reason as one short sentence in the user's language, written as app interface text (no "I"), saying what is wrong and what to do, e.g. "No menu text found in this photo. Take a closer, sharper photo of the menu.", and return no dishes.
restaurant_name: only if printed. menu_language: the language the menu is written in, in English (e.g. "German"). cuisine: one or two words.
${lean ? READ_VOICE : ''}
Known standard dishes (key: label): ${DISH_TABLE.map((d) => `${d.key}: ${d.label}`).join('; ')}`

const MENU_SYSTEM = menuSystem(false)
const LEAN_MENU_SYSTEM = menuSystem(true)

let client: Anthropic | null = null
let baseURL: string | undefined
/** Local benchmarks point the SDK at scripts/mock-anthropic.mjs (ANTHROPIC_BASE_URL); unset in production. */
export function setAiBaseUrl(url: string | undefined): void {
  if (url !== baseURL) { baseURL = url; client = null }
}
function getClient(apiKey: string | undefined): Anthropic {
  if (!apiKey) throw new AiError('The AI key is not configured on the server (ANTHROPIC_API_KEY in .dev.vars).', 503, 'no_key')
  client ??= new Anthropic({ apiKey, maxRetries: 1, timeout: 90_000, ...(baseURL ? { baseURL } : {}) })
  return client
}

/**
 * The service turned the request down as it was written: a setting the model
 * does not take (400), or a model name it does not know or offer (404, 403).
 * Such a request is sent again in the proven shape instead of failing the scan.
 */
const turnedDown = (err: unknown): boolean =>
  err instanceof Anthropic.BadRequestError || err instanceof Anthropic.NotFoundError || err instanceof Anthropic.PermissionDeniedError

function mapError(err: unknown): AiError {
  if (err instanceof AiError) return err
  if (err instanceof Anthropic.AuthenticationError) return new AiError('The AI key was rejected. Check ANTHROPIC_API_KEY in .dev.vars.', 502, 'auth')
  if (err instanceof Anthropic.RateLimitError) return new AiError('The AI service is busy right now. Try again in a moment.', 503, 'rate_limited')
  if (turnedDown(err)) return new AiError(`The AI service refused the request: ${(err as Error).message}`, 502, 'bad_request')
  if (err instanceof Anthropic.APIConnectionError) return new AiError('Could not reach the AI service. Check the internet connection.', 504, 'connection')
  if (err instanceof Anthropic.APIError) return new AiError(`AI service error (${err.status ?? 'unknown'}).`, 502, 'api')
  return new AiError('Unexpected error while reading the menu.', 500, 'unknown')
}

function textOf(msg: { content: Array<{ type: string; text?: string }>; stop_reason: string | null }): string {
  if (msg.stop_reason === 'refusal') throw new AiError('The AI declined to read this photo.', 422, 'refusal')
  // A model that thinks first answers with thinking blocks before the text: read by type, not by position.
  const t = msg.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('')
  if (!t) throw new AiError('The AI returned no answer.', 502, 'empty')
  return t
}

async function create(apiKey: string | undefined, params: Record<string, unknown>) {
  const c = getClient(apiKey)
  try {
    // Server-side refusal fallback (beta): a declined request is retried on a
    // fallback model inside the same call instead of failing.
    return (await c.beta.messages.create({
      ...(params as object),
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    } as never)) as unknown as { content: Array<{ type: string; text?: string }>; stop_reason: string | null }
  } catch (err) {
    throw mapError(err)
  }
}

type MediaType = 'image/jpeg' | 'image/png' | 'image/webp'

const menuMessages = (imageBase64: string, mediaType: MediaType, profile: Profile) => [
  {
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
      { type: 'text', text: `User's language: ${profile.language}. Read this menu.` },
    ],
  },
]

/** The menu read as it is sent to `model`. Exported for tests and for checking a model setting without a scan. */
export const menuRequest = (model: string, imageBase64: string, mediaType: MediaType, profile: Profile) => ({
  model,
  max_tokens: 16000,
  // Reading a menu is perception, not reasoning: the least thinking the model allows keeps a phone user's wait short.
  ...quickAnswer(model, LEAN_MENU_SCHEMA),
  // The instructions are the same for every scan: cached, they are not re-read each time.
  system: [{ type: 'text', text: LEAN_MENU_SYSTEM, cache_control: { type: 'ephemeral' } }],
  messages: menuMessages(imageBase64, mediaType, profile),
})

function parseMenu(text: string): MenuRead {
  try {
    return JSON.parse(text) as MenuRead
  } catch {
    throw new AiError('We could not read the AI answer. Try again.', 502, 'parse')
  }
}

/**
 * Read a menu in one response. This is the cheapest path in Worker CPU (one
 * JSON document to parse), used when the app did not ask for a stream.
 *
 * If the service turns the request down as configured, the scan falls back to
 * the proven request (`readMenuProven`), so the worst case is the old
 * behaviour, not a failed scan.
 */
export async function readMenu(ai: Ai, imageBase64: string, mediaType: MediaType, profile: Profile): Promise<MenuRead> {
  let msg: Awaited<ReturnType<typeof create>>
  try {
    msg = await create(ai.apiKey, menuRequest(ai.read, imageBase64, mediaType, profile))
  } catch (err) {
    if (err instanceof AiError && err.code === 'bad_request') return readMenuProven(ai, imageBase64, mediaType, profile, err)
    throw err
  }
  if (ai.served) ai.served.read = ai.read
  return parseMenu(textOf(msg))
}

/**
 * Read a menu and hand out every dish as soon as the model has written it.
 *
 * `onDish(dish, index, header)` runs while the answer is still streaming, so the
 * caller can estimate and show dishes seconds before the read is complete. The
 * returned MenuRead is the complete, authoritative answer.
 *
 * The SDK sends the request (key, retries, error mapping); the event stream is
 * then read here from its raw response. The SDK's own event iterator costs
 * several times more Worker CPU per event, and a menu is 1,500+ events.
 */
export async function readMenuStream(
  ai: Ai,
  imageBase64: string,
  mediaType: MediaType,
  profile: Profile,
  onDish: (dish: ModelDish, index: number, header: Partial<MenuRead>) => void,
): Promise<MenuRead> {
  const c = getClient(ai.apiKey)
  const parser = new DishStream()
  let stopReason: string | null = null
  let res: Response
  try {
    res = await c.beta.messages
      .create({ ...menuRequest(ai.read, imageBase64, mediaType, profile), betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', stream: true } as never)
      .asResponse()
  } catch (err) {
    // The request itself was turned down and nothing was shown yet: use the proven request.
    if (turnedDown(err)) return readMenuProven(ai, imageBase64, mediaType, profile, err)
    throw mapError(err)
  }
  if (ai.served) ai.served.read = ai.read
  try {
    await readEvents(res, (event, data) => {
      if (event === 'content_block_delta') {
        const delta = (JSON.parse(data) as { delta?: { type?: string; text?: string } }).delta
        // Thinking and signature deltas (a model that thinks first) carry no menu text.
        if (delta?.type !== 'text_delta' || !delta.text) return
        // After a mid-answer fallback the next model continues the same text, so all text blocks are one document.
        const first = parser.count
        const done = parser.push(delta.text)
        for (let i = 0; i < done.length; i++) onDish(done[i]!, first + i, parser.header() ?? {})
      } else if (event === 'message_delta') {
        stopReason = (JSON.parse(data) as { delta?: { stop_reason?: string | null } }).delta?.stop_reason ?? stopReason
      } else if (event === 'error') {
        const type = (JSON.parse(data) as { error?: { type?: string } }).error?.type
        throw type === 'overloaded_error' || type === 'rate_limit_error'
          ? new AiError('The AI service is busy right now. Try again in a moment.', 503, 'rate_limited')
          : new AiError('AI service error while reading the menu.', 502, 'api')
      }
    })
  } catch (err) {
    if (err instanceof AiError) throw err
    throw new AiError('Could not reach the AI service. Check the internet connection.', 504, 'connection')
  }
  if (stopReason === 'refusal') throw new AiError('The AI declined to read this photo.', 422, 'refusal')
  if (parser.length === 0) throw new AiError('The AI returned no answer.', 502, 'empty')
  try {
    return parser.finish()
  } catch {
    // Cut off mid-answer (a very long menu): keep the dishes that arrived whole.
    const head = parser.header()
    if (parser.count > 0 && head?.is_menu) return { ...(head as MenuRead), dishes: parser.dishes }
    throw new AiError('We could not read the AI answer. Try again.', 502, 'parse')
  }
}

/** Minimal server-sent-events reader: calls `on(event, data)` once per event, in order. */
async function readEvents(res: Response, on: (event: string, data: string) => void): Promise<void> {
  if (!res.body) return
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let carry = ''
  let event = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    const chunk = carry + decoder.decode(value, { stream: true })
    let start = 0
    for (;;) {
      const nl = chunk.indexOf('\n', start)
      if (nl < 0) break
      const end = nl > start && chunk.charCodeAt(nl - 1) === 13 ? nl - 1 : nl
      if (chunk.startsWith('event:', start)) event = chunk.slice(start + 6, end).trim()
      // Only the three kinds read above are sliced out; pings and block markers are skipped unparsed.
      else if (chunk.startsWith('data:', start) && (event === 'content_block_delta' || event === 'message_delta' || event === 'error')) on(event, chunk.slice(start + 5, end))
      start = nl + 1
    }
    carry = chunk.slice(start)
  }
}

/** Says once per isolate, in the Worker log, that a model setting was turned down. Never the key, only the model name and the service's reason. */
const warned = new Set<string>()
function warnTurnedDown(job: 'MODEL_READ' | 'MODEL_VOICE', model: string, why: unknown): void {
  const key = `${job}:${model}`
  if (warned.has(key)) return
  warned.add(key)
  console.warn(`${job}=${model} was turned down by the AI service; answered with ${PROVEN_MODEL} instead.`, why instanceof Error ? why.message.slice(0, 300) : '')
}

/**
 * The first version of the menu request, on the model it has always run on.
 * The fallback for the two reads above when their request is turned down.
 */
async function readMenuProven(ai: Ai, imageBase64: string, mediaType: MediaType, profile: Profile, why: unknown): Promise<MenuRead> {
  warnTurnedDown('MODEL_READ', ai.read, why)
  const msg = await create(ai.apiKey, {
    model: PROVEN_MODEL,
    max_tokens: 16000,
    ...quickAnswer(PROVEN_MODEL, MENU_SCHEMA),
    system: MENU_SYSTEM,
    messages: menuMessages(imageBase64, mediaType, profile),
  })
  if (ai.served) ai.served.read = PROVEN_MODEL
  return parseMenu(textOf(msg))
}

const VOICE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['picks'],
  properties: {
    picks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['dish_id', 'why', 'local', 'translated'],
        properties: { dish_id: str, why: str, local: str, translated: str },
      },
    },
  },
}

const VOICE_SYSTEM = `You put a food app's picks into words. A guest photographed a restaurant menu. The app's food database worked out the numbers and picked the dishes below for the guest's goal. You only write the words.

For each dish write three things:
- why: one short sentence on why this dish suits the guest, in the guest's language. Use only the facts given for the dish and add no claims of your own.
- local: one short, polite sentence the guest can say to the waiter to order the dish their way. It is for the waiter, so it is in the menu's language, the way locals say it. Ask for one concrete change that serves the goal (sauce on the side, salad instead of fries, extra meat, less oil, no cheese). Mention an allergy of the guest only for a dish that could plausibly contain it.
- translated: what the sentence for the waiter means, in plain words in the guest's language.

How to write:
${voicePrompt()}
- Call a dish by its name, never by a menu number.`

const GOAL_TEXT: Record<Profile['goal'], string> = {
  lose_fat: 'lose fat (fewer calories, keep protein high)',
  build_muscle: 'build muscle (more protein)',
  balanced: 'eat balanced',
  plant_based: 'eat plant-based',
}

/**
 * The voice call as it is sent to `model`. The model is told what the engine
 * found in words (`dishFacts`) and is never shown one of its numbers.
 */
export function voiceRequest(model: string, dishes: DishEstimate[], menuLanguage: string, profile: Profile) {
  const lines = dishes
    .map((d) => {
      const made = [...new Set(d.rows.map((r) => r.name))].join(', ')
      return `${d.id}: ${d.name}${d.translated && d.translated !== d.name ? ` (${d.translated})` : ''}. Made of: ${made || 'not known'}. Facts: ${dishFacts(d, profile.goal).join('; ')}.`
    })
    .join('\n')
  return {
    model,
    // Room for a model that thinks before it writes; the answer itself is a few sentences.
    max_tokens: 4000,
    ...quickAnswer(model, VOICE_SCHEMA),
    system: VOICE_SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Menu language: ${menuLanguage}. Guest's language: ${profile.language}. Goal: ${GOAL_TEXT[profile.goal]}${profile.goal === 'plant_based' ? ` (${profile.plantStyle ?? 'vegan'})` : ''}. Allergies: ${profile.allergies.join(', ') || 'none'}.\nDishes:\n${lines}`,
      },
    ],
  }
}

/**
 * The words for the recommended dishes: why each one, and a short sentence to
 * say to the waiter in the menu's language with its meaning in the user's.
 *
 * Whatever the model writes passes `modelWords` before it is returned: a text
 * with a numeral in it is dropped, so no number on the screen is the model's.
 */
export async function pickVoice(ai: Ai, dishes: DishEstimate[], menuLanguage: string, profile: Profile): Promise<OrderTip[]> {
  if (dishes.length === 0) return []
  let msg: Awaited<ReturnType<typeof create>>
  try {
    msg = await create(ai.apiKey, voiceRequest(ai.voice, dishes, menuLanguage, profile))
    if (ai.served) ai.served.voice = ai.voice
  } catch (err) {
    if (!(err instanceof AiError && err.code === 'bad_request') || ai.voice === PROVEN_MODEL) throw err
    warnTurnedDown('MODEL_VOICE', ai.voice, err)
    msg = await create(ai.apiKey, voiceRequest(PROVEN_MODEL, dishes, menuLanguage, profile))
    if (ai.served) ai.served.voice = PROVEN_MODEL
  }
  let picks: Array<{ dish_id?: unknown; why?: unknown; local?: unknown; translated?: unknown }>
  try {
    picks = (JSON.parse(textOf(msg)) as { picks?: typeof picks }).picks ?? []
  } catch {
    return []
  }
  const byId = new Map(dishes.map((d) => [d.id, d]))
  const sameLang = sameLanguage(menuLanguage, profile.language)
  const lang = languageTag(menuLanguage)
  const tips: OrderTip[] = []
  for (const p of picks) {
    const dish = typeof p.dish_id === 'string' ? byId.get(p.dish_id) : undefined
    if (!dish || tips.some((t) => t.dishId === dish.id)) continue
    // A numeral the menu itself prints in the dish name may be repeated; no other number may.
    const printed = `${dish.name} ${dish.translated}`
    const local = modelWords(p.local, printed)
    const meaning = modelWords(p.translated, printed)
    // No sentence for the waiter, or one the guest cannot read: no tip. The dish keeps the engine's own line.
    if (!local || (!sameLang && !meaning)) continue
    const why = modelWords(p.why, printed)
    tips.push({
      dishId: dish.id,
      local,
      translated: sameLang || !meaning || meaning.toLowerCase() === local.toLowerCase() ? '' : meaning,
      ...(why ? { why } : {}),
      ...(lang ? { lang } : {}),
    })
  }
  return tips
}
