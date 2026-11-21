#!/usr/bin/env node
/**
 * A local stand-in for the AI service for working on the Me features. No key, no cost.
 *
 *   node scripts/me-mock-ai.mjs [port=18812] [tokensPerSecond=0]
 *
 * It answers POST /v1/messages like scripts/mock-anthropic.mjs (a recorded menu
 * read, fixed words for the picked dishes, as JSON or as a stream) and, on top,
 * the call behind "What did you eat today?" (src/me/estimate.ts): a typed meal
 * comes back as dishes with likely components, the way the real model answers.
 * Like the real model it writes no calorie or macro figure: the engine does that.
 *
 * Point a dev Worker at it:
 *   npx wrangler dev --local --port 8812 --var ANTHROPIC_BASE_URL:http://127.0.0.1:18812 --var ANTHROPIC_API_KEY:test-not-a-real-key
 */
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const port = Number(process.argv[2] ?? 18812)
const tps = Number(process.argv[3] ?? 0)
const firstTokenMs = tps > 0 ? 1500 : 0

const MENU = JSON.stringify(JSON.parse(readFileSync(join(HERE, '../test/fixtures/menu-read-24.json'), 'utf8')))

const TIPS = JSON.stringify({
  picks: [
    { dish_id: 'd7', why: 'Grilled chicken with vegetables: lots of protein, and it stays light.', local: 'Per favore, il pollo con le verdure senza olio aggiunto.', translated: 'The chicken with vegetables without added oil, please.' },
    { dish_id: 'd16', why: 'Sliced beef on rocket fills you up without much else on the plate.', local: 'La tagliata con più rucola e il parmigiano a parte, per favore.', translated: 'The sliced beef with more rocket and the parmesan on the side, please.' },
    { dish_id: 'd9', why: 'Sea bass is lean and still gives you plenty of protein.', local: 'Il branzino con insalata al posto delle patate, per favore.', translated: 'The sea bass with salad instead of potatoes, please.' },
  ],
})

// ---------- A typed meal ----------

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

function describe(typed) {
  const t = typed.trim()
  const low = t.toLowerCase()
  if (!t || /asdf|weather/.test(low)) return { is_food: false, dishes: [] }
  const hit = TYPED.find(([rx]) => rx.test(low))
  return { is_food: true, dishes: [hit ? hit[1](t) : plainPlate(t)] }
}

/** The typed text out of the request: estimate.ts sends it after a "Typed text:" line. */
function typedText(body) {
  const content = body.messages?.at(-1)?.content
  const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map((b) => b.text ?? '').join('\n') : ''
  const at = text.indexOf('Typed text:')
  return at < 0 ? text : text.slice(at + 'Typed text:'.length)
}

// ---------- The service ----------

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
  // Each call is told apart by a phrase of its instructions (src/me/estimate.ts, src/anthropic.ts).
  const kind = /what a person typed/.test(system) ? 'typed' : /waiter/.test(system) ? 'voice' : 'menu'
  const text = kind === 'typed' ? JSON.stringify(describe(typedText(body))) : kind === 'voice' ? TIPS : MENU
  const outTokens = Math.ceil(text.length / 3.6)
  const id = `msg_mock_${++calls}`
  // The typed text itself is not logged, only that a call came in.
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
