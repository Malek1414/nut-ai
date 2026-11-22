#!/usr/bin/env node
/**
 * A local stand-in for the AI service, for benchmarks and for walking the whole
 * app without a key. No key, no cost.
 *
 *   node scripts/mock-anthropic.mjs [port=8804] [tokensPerSecond=0]
 *
 * It answers POST /v1/messages for every call the Worker makes, told apart by a
 * phrase of each call's instructions:
 *
 *   menu    a recorded menu read (test/fixtures)                       src/anthropic.ts
 *   voice   fixed words for the picked dishes                          src/anthropic.ts
 *   chat    a short answer about the first two dishes it was given     src/voice/chat.ts
 *   typed   a typed meal as dishes with likely components              src/me/estimate.ts
 *   import  the meal and the place of a saved link                     src/social/identify.ts
 *   needs   a person's food needs out of one sentence                  src/group/ai.ts
 *
 * Like the real model it writes no calorie or macro figure: the engine does that.
 * The answer comes as one JSON body, or as a server-sent event stream when the
 * request asks for `stream: true`. tokensPerSecond > 0 paces it like the real
 * service; 0 sends it as fast as possible (CPU profiling).
 *
 * MOCK_DRINKS=1 swaps the last four dishes of the recorded menu for drinks (two alcoholic).
 *
 * Point a dev Worker at it:
 *   npx wrangler dev --local --port 8803 --var ANTHROPIC_BASE_URL:http://127.0.0.1:8804 --var ANTHROPIC_API_KEY:test-not-a-real-key
 */
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const port = Number(process.argv[2] ?? 8804)
const tps = Number(process.argv[3] ?? 0)
const firstTokenMs = tps > 0 ? 1500 : 0

const menu = JSON.parse(readFileSync(join(HERE, '../test/fixtures/menu-read-24.json'), 'utf8'))
// MOCK_DRINKS=1 puts four drinks on the recorded menu, two of them alcoholic, to walk the drinks list and the 18+ question.
// They take the place of the last four dishes: a scan reads 24 dishes at most, and the picks keep their ids.
if (process.env.MOCK_DRINKS === '1') {
  const drink = (name_original, name_translated, price, usda_key, typical_grams) => ({
    name_original, name_translated, description_translated: '', price, course: 'drink', dish_key: 'none', portion: 'regular',
    components: [{ name: name_translated, usda_key, form: 'liquid', size: 'medium', typical_grams, cooking: 'none' }],
    has_meat: false, has_fish: false, has_dairy_or_egg: false, allergen_hints: [],
  })
  menu.dishes.splice(-4, 4,
    drink('Acqua minerale', 'Mineral water', '3 €', 'water, bottled, generic', 500),
    drink('Aranciata', 'Orange soda', '3,50 €', 'beverages, orange soda', 330),
    drink('Birra Moretti', 'Moretti beer', '4,50 €', 'alcoholic beverage, beer, regular, all', 330),
    drink('Vino rosso della casa', 'House red wine', '5 €', 'alcoholic beverage, wine, table, red', 150),
  )
}
const MENU = JSON.stringify(menu)

const TIPS = JSON.stringify({
  picks: [
    { dish_id: 'd7', why: 'Grilled chicken with vegetables: lots of protein, and it stays light.', local: 'Per favore, il pollo con le verdure senza olio aggiunto.', translated: 'The chicken with vegetables without added oil, please.' },
    { dish_id: 'd16', why: 'Sliced beef on rocket fills you up without much else on the plate.', local: 'La tagliata con più rucola e il parmigiano a parte, per favore.', translated: 'The sliced beef with more rocket and the parmesan on the side, please.' },
    { dish_id: 'd9', why: 'Sea bass is lean and still gives you plenty of protein.', local: 'Il branzino con insalata al posto delle patate, per favore.', translated: 'The sea bass with salad instead of potatoes, please.' },
  ],
})

/** The words a person sent, whatever shape the request carries them in. */
function userText(body) {
  const content = body.messages?.at(-1)?.content
  return typeof content === 'string' ? content : Array.isArray(content) ? content.map((b) => b.text ?? '').join('\n') : ''
}

// ---------- The menu chat (src/voice/chat.ts) ----------

/** A short answer about the first two dishes it was given. */
function chatAnswer(content) {
  const [a, b] = [...String(content ?? '').matchAll(/^(d\d+): (.+?) \[/gm)].map((m) => ({ id: m[1], name: m[2].replace(/ \(.*\)$/, '') }))
  if (!a) return { reply: 'The menu does not say. Best ask the waiter.', dish_ids: [] }
  return { reply: `${a.name} is a good pick for your goal${b ? `. ${b.name} comes close` : ''}.`, dish_ids: [a.id, ...(b ? [b.id] : [])] }
}

// ---------- A typed meal (src/me/estimate.ts) ----------

const c = (name, usda_key, form, typical_grams, cooking = 'none') => ({ name, usda_key, form, typical_grams, cooking })
const hint = (allergen, reason) => ({ allergen, reason })
const dish = (name, description, components, more = {}) => ({
  name_original: name, name_translated: name, description_translated: description, price: null, course: 'main', dish_key: 'none', portion: 'regular',
  components, has_meat: false, has_fish: false, has_dairy_or_egg: false, allergen_hints: [], ...more,
})
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)

/** Typed texts with a prepared answer. First match wins; anything else gets the plain plate at the end. */
const TYPED = [
  [/egg.*toast|toast.*egg/, (t) => dish(cap(t), 'Fried eggs with buttered toast', [
    c('Fried eggs', 'egg, whole, cooked, fried', 'discrete', 100, 'fried'),
    c('Toast', 'bread, white, toasted', 'flat', 60),
    c('Butter', 'butter, salted', 'spread', 10),
  ], { has_dairy_or_egg: true, allergen_hints: [hint('eggs', 'eggs'), hint('gluten', 'toast is wheat bread'), hint('milk', 'butter')] })],
  // A drink is one component, the drink as a whole: the engine then asks Open Food Facts for it by name.
  [/latte|flat white|cappuccino/, (t) => dish(cap(t), /oat|hafer/.test(t.toLowerCase()) ? 'Espresso with steamed oat drink' : 'Espresso with steamed milk', [
    c(cap(t), 'coffee, latte', 'liquid', 300),
  ], { course: 'drink', has_dairy_or_egg: !/oat|hafer|soy|almond/.test(t.toLowerCase()) })],
  [/chicken.*salad|salad.*chicken/, (t) => dish(cap(t), 'Grilled chicken on mixed leaves with dressing', [
    c('Grilled chicken breast', 'chicken, breast, roasted', 'piled', 140, 'grilled'),
    c('Mixed salad leaves', 'lettuce, green leaf, raw', 'piled', 100, 'raw'),
    c('Tomato', 'tomatoes, red, ripe, raw', 'piled', 60, 'raw'),
    c('Olive oil dressing', 'oil, olive, salad or cooking', 'liquid', 12, 'sauce'),
  ], { has_meat: true })],
  [/bolognese|ragu/, (t) => dish(cap(t), 'Spaghetti with minced beef and tomato sauce', [], { dish_key: 'bolognese', has_meat: true })],
  [/avocado.*(toast|bread)/, (t) => dish(cap(t), 'Toasted bread with mashed avocado', [
    c('Sourdough toast', 'bread, wheat, toasted', 'flat', 80),
    c('Avocado', 'avocados, raw', 'spread', 80, 'raw'),
    c('Olive oil', 'oil, olive, salad or cooking', 'liquid', 5),
  ], { allergen_hints: [hint('gluten', 'bread')] })],
  [/^(a |one |1 )?banana$/, (t) => dish(cap(t), 'A banana', [c('Banana', 'bananas, raw', 'discrete', 120, 'raw')], { course: 'side' })],
]

const plainPlate = (t) => dish(cap(t), '', [
  c('White rice', 'rice, white, cooked', 'piled', 180, 'boiled'),
  c('Chicken breast', 'chicken, breast, roasted', 'piled', 120, 'grilled'),
  c('Mixed vegetables', 'vegetables, mixed, cooked', 'piled', 100, 'boiled'),
], { has_meat: true })

function typedAnswer(text) {
  // estimate.ts sends the typed text after a "Typed text:" line.
  const at = text.indexOf('Typed text:')
  const t = (at < 0 ? text : text.slice(at + 'Typed text:'.length)).trim()
  const low = t.toLowerCase()
  if (!t || /asdf|weather/.test(low)) return { is_food: false, dishes: [] }
  const hit = TYPED.find(([rx]) => rx.test(low))
  return { is_food: true, dishes: [hit ? hit[1](t) : plainPlate(t)] }
}

// ---------- A saved link (src/social/identify.ts) ----------

/** Food words -> a dish of the recipe table (src/dishes.ts). First match wins. */
const KNOWN = [
  [/d[öo]ner|kebab|kebap/i, 'chicken_doner', 'Hähnchen Döner', 'Chicken doner kebab', 'Chicken in flatbread with salad and sauce', { meat: true, dairy: true }, [['gluten', 'Flatbread'], ['milk', 'Yogurt sauce']]],
  [/smash|burger/i, 'burger', 'Smash Burger', 'Smash burger', 'Beef patty in a bun with cheese and sauce', { meat: true, dairy: true }, [['gluten', 'Bun'], ['milk', 'Cheese']]],
  [/currywurst/i, 'currywurst', 'Currywurst', 'Curry sausage', 'Sliced sausage in curry ketchup', { meat: true }, [['mustard', 'Often in the sauce']]],
  [/carbonara/i, 'carbonara', 'Spaghetti Carbonara', 'Spaghetti carbonara', 'Pasta with egg, cheese and cured pork', { meat: true, dairy: true }, [['gluten', 'Pasta'], ['eggs', 'Egg sauce'], ['milk', 'Cheese']]],
  [/pizza|margherita/i, 'margherita', 'Pizza Margherita', 'Margherita pizza', 'Pizza with tomato and mozzarella', { dairy: true }, [['gluten', 'Dough'], ['milk', 'Mozzarella']]],
  [/ramen/i, 'ramen', 'Ramen', 'Ramen', 'Noodle soup with pork and egg', { meat: true, dairy: true }, [['gluten', 'Noodles'], ['eggs', 'Egg'], ['soy', 'Broth']]],
  [/falafel/i, 'falafel_wrap', 'Falafel Wrap', 'Falafel wrap', 'Falafel in flatbread with salad and tahini', {}, [['gluten', 'Flatbread'], ['sesame', 'Tahini']]],
  [/pad ?thai/i, 'pad_thai', 'Pad Thai', 'Pad thai', 'Fried rice noodles with egg and peanuts', { dairy: true }, [['peanuts', 'Peanuts on top'], ['eggs', 'Egg']]],
  [/sushi/i, 'sushi_mix', 'Sushi Mix', 'Mixed sushi', 'Rice rolls with raw fish', { fish: true }, [['fish', 'Raw fish'], ['soy', 'Soy sauce']]],
  [/schnitzel/i, 'schnitzel', 'Wiener Schnitzel', 'Breaded cutlet', 'Breaded, fried cutlet with potatoes', { meat: true, dairy: true }, [['gluten', 'Breading'], ['eggs', 'Breading']]],
  [/\bph[oở]\b/i, 'pho_bo', 'Phở Bò', 'Beef noodle soup', 'Rice noodle soup with beef', { meat: true }, []],
  [/bowl/i, 'buddha_bowl', 'Buddha Bowl', 'Buddha bowl', 'Grains, vegetables and a dressing', {}, [['sesame', 'Dressing']]],
  [/salat|salad/i, 'grilled_chicken_salad', 'Hähnchenbrust Salat', 'Grilled chicken salad', 'Grilled chicken on leaves', { meat: true }, []],
  [/tiramis[uù]/i, 'tiramisu', 'Tiramisù', 'Tiramisu', 'Coffee and mascarpone dessert', { dairy: true }, [['milk', 'Mascarpone'], ['eggs', 'Egg cream'], ['gluten', 'Biscuits']]],
]

const field = (text, label) => new RegExp(`^${label}: (.+)$`, 'm').exec(text)?.[1]?.trim() ?? null

/** Answered from the words in the preview or in what the person typed: "döner" is the döner of the recipe table, a post with no food word is "not food". */
function importAnswer(text) {
  const typedDish = field(text, 'The person says the dish is')
  const typedPlace = field(text, 'The person says the place is')
  const about = typedDish ?? [field(text, 'Title'), field(text, 'Caption'), text.includes('Page notes:') ? text.slice(text.indexOf('Page notes:')) : ''].filter(Boolean).join(' ')
  const at = / (?:at|bei|im|@) ([A-ZÄÖÜ][\p{L}'’&.-]+(?: [A-ZÄÖÜ&][\p{L}'’&.-]*){0,3})/u.exec(field(text, 'Title') ?? '')?.[1] ?? null
  const restaurant_name = typedPlace ?? at
  const hit = KNOWN.find(([re]) => re.test(about))
  if (hit) {
    const [, dish_key, name, translated, description, has, hints] = hit
    return {
      is_food: true, refusal_reason: null, restaurant_name, restaurant_city: /berlin/i.test(text) ? 'Berlin' : null,
      dish: {
        name_original: typedDish ?? name, name_translated: translated, description_translated: description, price: null, course: dish_key === 'tiramisu' ? 'dessert' : 'main', dish_key,
        portion: /xxl|huge|giant|riesig/i.test(about) ? 'large' : 'regular', components: [],
        has_meat: Boolean(has.meat), has_fish: Boolean(has.fish), has_dairy_or_egg: Boolean(has.dairy),
        allergen_hints: hints.map(([allergen, reason]) => ({ allergen, reason })),
      },
    }
  }
  if (typedDish) {
    // Something the table does not know: a plain plate of chicken, rice and vegetables stands in.
    return {
      is_food: true, refusal_reason: null, restaurant_name, restaurant_city: null,
      dish: {
        name_original: typedDish, name_translated: typedDish, description_translated: 'As described', price: null, course: 'main', dish_key: 'none', portion: 'regular',
        components: [
          c('Grilled chicken breast', 'chicken, breast, roasted', 'discrete', 150, 'grilled'),
          c('Rice', 'rice, white, cooked', 'piled', 180, 'boiled'),
          c('Mixed vegetables', 'vegetables, mixed, cooked', 'piled', 120, 'boiled'),
        ],
        has_meat: true, has_fish: false, has_dairy_or_egg: false, allergen_hints: [],
      },
    }
  }
  if (restaurant_name) return { is_food: true, refusal_reason: null, restaurant_name, restaurant_city: null, dish: null }
  return { is_food: false, refusal_reason: 'No meal found in this link. Type what it is.', restaurant_name: null, restaurant_city: null, dish: null }
}

// ---------- A person's needs (src/group/ai.ts) ----------

const NEEDS_ALLERGIES = [
  ['peanuts', /peanut|erdnuss/i], ['tree_nuts', /\bnuts?\b|n[üu]sse|almond|hazel|walnut/i], ['sesame', /sesam|tahin/i], ['gluten', /gluten|celiac|z[öo]liakie|wheat|weizen/i],
  ['milk', /lactose|laktose|dairy|\bmilk\b|milch/i], ['eggs', /\beggs?\b|\beier?\b/i], ['soy', /\bsoy\b|\bsoja\b/i], ['shellfish', /shellfish|shrimp|prawn|garnele|meeresfr/i], ['fish', /\bfish\b|\bfisch\b/i],
]

/** The form of src/group/ai.ts, filled in from the words of the sentence. Fixed lists only, like the real answer. */
function needsAnswer(text) {
  const said = text.slice(text.indexOf('\n') + 1)
  const budget = /(\d{1,3})\s*(?:€|euros?\b|eur\b)|€\s*(\d{1,3})/i.exec(said)
  // A name starts with a capital: "Ich bin vegan" names nobody.
  const name = /(?:\b[Ii] am|\b[Ii]'m|\b[Mm]y name is|\b[Ii]ch bin|\b[Ii]ch hei(?:ss|ß)e)\s+([A-ZÄÖÜ][\p{L}]{1,20})/u.exec(said)
  return {
    diet: /vegan/i.test(said) ? 'vegan' : /vegetari|veggie|no meat|kein fleisch/i.test(said) ? 'vegetarian' : /eat everything|esse alles|anything/i.test(said) ? 'any' : 'unknown',
    allergies: NEEDS_ALLERGIES.filter(([, rx]) => rx.test(said)).map(([id]) => id),
    goal: /protein|muscle|muskel|bulk/i.test(said) ? 'build_muscle' : /\blight\b|lose|abnehm|\bcut\b|leicht/i.test(said) ? 'lose_fat' : /balanced|normal|ausgewogen/i.test(said) ? 'balanced' : 'unknown',
    budget_eur: budget ? Number(budget[1] ?? budget[2]) : 0,
    name: name ? name[1] : null,
  }
}

// ---------- The service ----------

/** Each call is told apart by a phrase of its instructions. */
function kindOf(system) {
  if (/voice of a food app/.test(system)) return 'chat'
  if (/what a person typed/.test(system)) return 'typed'
  if (/food post someone saved from the web/.test(system)) return 'import'
  if (/fill in a short form for a restaurant app/.test(system)) return 'needs'
  return /waiter/.test(system) ? 'voice' : 'menu'
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const usage = (out) => ({ input_tokens: 2400, output_tokens: out, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 })

let calls = 0
createServer(async (req, res) => {
  if (req.method !== 'POST' || !req.url.startsWith('/v1/messages')) {
    res.writeHead(404, { 'content-type': 'application/json' }).end('{"type":"error","error":{"type":"not_found_error","message":"mock"}}')
    return
  }
  const chunks = []
  for await (const ch of req) chunks.push(ch)
  let body
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { body = {} }
  const system = typeof body.system === 'string' ? body.system : JSON.stringify(body.system ?? '')
  const kind = kindOf(system)
  const said = userText(body)
  const text = kind === 'chat' ? JSON.stringify(chatAnswer(said))
    : kind === 'typed' ? JSON.stringify(typedAnswer(said))
    : kind === 'import' ? JSON.stringify(importAnswer(said))
    : kind === 'needs' ? JSON.stringify(needsAnswer(said))
    : kind === 'voice' ? TIPS : MENU
  const outTokens = Math.ceil(text.length / 3.6)
  const id = `msg_mock_${++calls}`
  // What a person wrote is never logged, only that a call came in.
  console.log(`${new Date().toISOString().slice(11, 23)} ${kind} ${body.model} ${body.stream ? 'stream' : 'json'} thinking=${body.thinking?.type ?? 'unset'} max_tokens=${body.max_tokens} in=${Math.round(Buffer.concat(chunks).length / 1024)}KB out~${outTokens}tok`)

  if (!body.stream) {
    if (tps > 0) await sleep(firstTokenMs + (outTokens / tps) * 1000)
    res.writeHead(200, { 'content-type': 'application/json', 'request-id': id })
    res.end(JSON.stringify({ id, type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: usage(outTokens) }))
    return
  }

  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'request-id': id })
  const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
  if (firstTokenMs) await sleep(firstTokenMs)
  send('message_start', { message: { id, type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: usage(1) } })
  send('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
  // The real service sends a few tokens per event; ~14 characters is typical.
  const STEP = 14
  const perEventMs = tps > 0 ? ((STEP / 3.6) / tps) * 1000 : 0
  let due = Date.now()
  for (let i = 0; i < text.length; i += STEP) {
    send('content_block_delta', { index: 0, delta: { type: 'text_delta', text: text.slice(i, i + STEP) } })
    if (perEventMs) {
      due += perEventMs
      const wait = due - Date.now()
      if (wait > 1) await sleep(wait)
    }
  }
  send('content_block_stop', { index: 0 })
  send('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: outTokens } })
  send('message_stop', {})
  res.end()
}).listen(port, '127.0.0.1', () => console.log(`mock AI service on http://127.0.0.1:${port} (${tps > 0 ? `${tps} tokens/s` : 'unpaced'})`))
