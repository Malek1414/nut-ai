import Anthropic from '@anthropic-ai/sdk'
import { DISH_TABLE } from './dishes.js'
import type { DishEstimate, MenuRead, OrderTip, Profile } from './types.js'

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

const MENU_SCHEMA = {
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
          components: { type: 'array', items: COMPONENT_SCHEMA },
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
}

const MENU_SYSTEM = `You read restaurant menus from photos for a nutrition app used across Europe.
You are a perception device: you transcribe and translate what is printed, and you name the likely components of each dish. You never state calories, macros or health claims; a deterministic engine computes every number from databases.

For each orderable dish on the menu (skip headings, opening hours, drinks unless they are the main items; include at most 24 dishes, mains first):
- name_original: exactly as printed (keep the original language and accents).
- name_translated / description_translated: in the user's language, short and plain; mention what the dish is if the name is opaque (e.g. "Lahmacun: thin flatbread with spiced minced meat").
- price: as printed with currency, or null.
- course: main, starter, side, dessert or drink.
- dish_key: if the dish is one of the known standard dishes listed below, its key; otherwise "none". Only use a key when the dish really is that dish (a chicken döner in bread is doner_kebab; an Adana kebab skewer is "none").
- portion: "large" only if the menu says XXL/gross/large/maxi or a clearly bigger size; "small" for klein/kids/half; otherwise "regular".
- components: when dish_key is not "none", return an empty array (the app has the recipe). Otherwise 2-7 likely components of one serving, the way it is usually served in this kind of restaurant (include bread, sauce, oil/butter and sides the menu mentions or that are standard). For each:
  - name: short English name ("Grilled chicken breast").
  - usda_key: a generic lowercase, comma-separated USDA FoodData Central style search string, head noun first, no brands, e.g. "chicken, breast, roasted", "rice, white, cooked", "cheese, feta", "potatoes, french fried", "sauce, pasta, spaghetti/marinara".
  - form: discrete (countable), flat, piled, liquid, wrapped or spread.
  - size: small, medium or large relative to a normal serving of that component.
  - typical_grams: your best guess of the grams in a typical restaurant serving (the engine treats this as its lowest-trust signal).
  - cooking: grilled, fried (pan), deep_fried, boiled, raw, baked, sauce or none.
- has_meat / has_fish / has_dairy_or_egg: from the menu text and the usual recipe.
- allergen_hints: EU allergens the dish likely contains, with a short reason in the user's language. If the menu prints allergen codes or footnotes (e.g. "A, C, G" or "1,3"), decode them using the menu's own legend when visible and say so in the reason.

If the photo is not a menu or is unreadable, set is_menu=false, give refusal_reason as one short sentence in the user's language, written as app interface text (no "I"), saying what is wrong and what to do, e.g. "No menu text found in this photo. Take a closer, sharper photo of the menu.", and return no dishes.
restaurant_name: only if printed. menu_language: the language the menu is written in, in English (e.g. "German"). cuisine: one or two words.

Known standard dishes (key: label): ${DISH_TABLE.map((d) => `${d.key}: ${d.label}`).join('; ')}`

let client: Anthropic | null = null
function getClient(apiKey: string | undefined): Anthropic {
  if (!apiKey) throw new AiError('The AI key is not configured on the server (ANTHROPIC_API_KEY in .dev.vars).', 503, 'no_key')
  client ??= new Anthropic({ apiKey, maxRetries: 1, timeout: 90_000 })
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

export async function readMenu(apiKey: string | undefined, imageBase64: string, mediaType: 'image/jpeg' | 'image/png' | 'image/webp', profile: Profile): Promise<MenuRead> {
  const msg = await create(apiKey, {
    model: MODEL,
    max_tokens: 16000,
    // Reading a menu is perception, not reasoning: thinking off keeps a phone user's wait short.
    thinking: { type: 'between_tools' },
    output_config: { effort: 'low', format: { type: 'json_schema', schema: MENU_SCHEMA } },
    system: MENU_SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
          { type: 'text', text: `User's language: ${profile.language}. Read this menu.` },
        ],
      },
    ],
  })
  try {
    return JSON.parse(textOf(msg)) as MenuRead
  } catch (e) {
    if (e instanceof AiError) throw e
    throw new AiError('We could not read the AI answer. Try again.', 502, 'parse')
  }
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
