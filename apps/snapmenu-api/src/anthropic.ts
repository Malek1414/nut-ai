import Anthropic from '@anthropic-ai/sdk'
import { DISH_TABLE } from './dishes.js'
import { DishStream } from './dish-stream.js'
import type { DishEstimate, MenuRead, ModelDish, OrderTip, Profile } from './types.js'

/**
 * The only two model calls in Snapmenu. Both return TEXT and perception only:
 * dish names, translations, likely components, allergen hints, and a sentence
 * to say to the waiter. No call is ever asked for a calorie or gram number that
 * reaches the screen; `typical_grams` is the gram engine's lowest-trust tier and
 * is replaced by our recipe table whenever a dish is known.
 */

export const MODEL = 'claude-sonnet-5-5'

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

function mapError(err: unknown): AiError {
  if (err instanceof AiError) return err
  if (err instanceof Anthropic.AuthenticationError) return new AiError('The AI key was rejected. Check ANTHROPIC_API_KEY in .dev.vars.', 502, 'auth')
  if (err instanceof Anthropic.RateLimitError) return new AiError('The AI service is busy right now. Try again in a moment.', 503, 'rate_limited')
  if (err instanceof Anthropic.BadRequestError) return new AiError(`The AI service refused the request: ${err.message}`, 502, 'bad_request')
  if (err instanceof Anthropic.APIConnectionError) return new AiError('Could not reach the AI service. Check the internet connection.', 504, 'connection')
  if (err instanceof Anthropic.APIError) return new AiError(`AI service error (${err.status ?? 'unknown'}).`, 502, 'api')
  return new AiError('Unexpected error while reading the menu.', 500, 'unknown')
}

function textOf(msg: { content: Array<{ type: string; text?: string }>; stop_reason: string | null }): string {
  if (msg.stop_reason === 'refusal') throw new AiError('The AI declined to read this photo.', 422, 'refusal')
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

const leanMenuParams = (imageBase64: string, mediaType: MediaType, profile: Profile) => ({
  model: MODEL,
  max_tokens: 16000,
  // Reading a menu is perception, not reasoning: thinking off keeps a phone user's wait short.
  thinking: { type: 'between_tools' },
  output_config: { effort: 'low', format: { type: 'json_schema', schema: LEAN_MENU_SCHEMA } },
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
 * If the service rejects the request outright, the scan falls back to the
 * first version of the request (`readMenuLegacy`), so the worst case is the
 * old behaviour, not a failed scan.
 */
export async function readMenu(apiKey: string | undefined, imageBase64: string, mediaType: MediaType, profile: Profile): Promise<MenuRead> {
  let msg: Awaited<ReturnType<typeof create>>
  try {
    msg = await create(apiKey, leanMenuParams(imageBase64, mediaType, profile))
  } catch (err) {
    if (err instanceof AiError && err.code === 'bad_request') return readMenuLegacy(apiKey, imageBase64, mediaType, profile)
    throw err
  }
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
  apiKey: string | undefined,
  imageBase64: string,
  mediaType: MediaType,
  profile: Profile,
  onDish: (dish: ModelDish, index: number, header: Partial<MenuRead>) => void,
): Promise<MenuRead> {
  const c = getClient(apiKey)
  const parser = new DishStream()
  let stopReason: string | null = null
  let res: Response
  try {
    res = await c.beta.messages
      .create({ ...leanMenuParams(imageBase64, mediaType, profile), betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', stream: true } as never)
      .asResponse()
  } catch (err) {
    // The request itself was refused and nothing was shown yet: use the proven request shape.
    if (err instanceof Anthropic.BadRequestError) return readMenuLegacy(apiKey, imageBase64, mediaType, profile)
    throw mapError(err)
  }
  try {
    await readEvents(res, (event, data) => {
      if (event === 'content_block_delta') {
        const delta = (JSON.parse(data) as { delta?: { type?: string; text?: string } }).delta
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

/** The first version of the menu request, kept as the fallback for the two reads above. */
async function readMenuLegacy(apiKey: string | undefined, imageBase64: string, mediaType: MediaType, profile: Profile): Promise<MenuRead> {
  const msg = await create(apiKey, {
    model: MODEL,
    max_tokens: 16000,
    // Reading a menu is perception, not reasoning: thinking off keeps a phone user's wait short.
    thinking: { type: 'between_tools' },
    output_config: { effort: 'low', format: { type: 'json_schema', schema: MENU_SCHEMA } },
    system: MENU_SYSTEM,
    messages: menuMessages(imageBase64, mediaType, profile),
  })
  return parseMenu(textOf(msg))
}

const TIP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tips'],
  properties: {
    tips: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['dish_id', 'local', 'translated'],
        properties: { dish_id: str, local: str, translated: str },
      },
    },
  },
}

const GOAL_TEXT: Record<Profile['goal'], string> = {
  lose_fat: 'lose fat (fewer calories, keep protein high)',
  build_muscle: 'build muscle (more protein)',
  balanced: 'eat balanced',
  plant_based: 'eat plant-based',
}

/** One short sentence per recommended dish, to say to the waiter in the menu's language. */
export async function orderTips(apiKey: string | undefined, dishes: DishEstimate[], menuLanguage: string, profile: Profile): Promise<OrderTip[]> {
  if (dishes.length === 0) return []
  const lines = dishes
    .map((d) => `${d.id}: ${d.name} — components: ${d.rows.map((r) => `${r.name} ${r.grams} g`).join(', ')}${d.userAllergenHits.length ? ` — user allergy: ${d.userAllergenHits.map((h) => h.allergen).join(', ')}` : ''}`)
    .join('\n')
  const msg = await create(apiKey, {
    model: MODEL,
    max_tokens: 2000,
    thinking: { type: 'between_tools' },
    output_config: { effort: 'low', format: { type: 'json_schema', schema: TIP_SCHEMA } },
    system:
      'You write one short, polite sentence a guest can say to a waiter to order a dish their way. Write it in the menu language (natural, how locals say it), plus a translation in the user\'s language. Make one concrete change that serves the goal (e.g. sauce on the side, extra salad instead of fries, extra meat, less oil, no cheese). Mention the user\'s allergy only for a dish that could plausibly contain it. No numbers, no health claims, no em dashes.',
    messages: [
      {
        role: 'user',
        content: `Menu language: ${menuLanguage}. User language: ${profile.language}. Goal: ${GOAL_TEXT[profile.goal]}${profile.goal === 'plant_based' ? ` (${profile.plantStyle ?? 'vegan'})` : ''}. Allergies: ${profile.allergies.join(', ') || 'none'}.\nDishes:\n${lines}`,
      },
    ],
  })
  try {
    const parsed = JSON.parse(textOf(msg)) as { tips: Array<{ dish_id: string; local: string; translated: string }> }
    return parsed.tips.map((t) => ({ dishId: t.dish_id, local: t.local, translated: t.translated }))
  } catch {
    return []
  }
}
