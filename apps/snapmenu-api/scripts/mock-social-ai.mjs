#!/usr/bin/env node
/**
 * A local stand-in for the AI service that also answers link imports. No key, no cost.
 *
 *   node scripts/mock-social-ai.mjs [port=8815]
 *   npx wrangler dev --local --ip 127.0.0.1 --port 8814 --var ANTHROPIC_BASE_URL:http://127.0.0.1:8815
 *
 * A link import (src/social/identify.ts) is answered from the words in the
 * preview or in what the person typed: "döner" becomes the döner of the recipe
 * table, a post with no food word is "not food". Menu scans and the words for
 * the picks are answered like scripts/mock-anthropic.mjs does, from the same
 * fixture, so a whole scan works against this stand-in too.
 */
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const port = Number(process.argv[2] ?? 8815)
const MENU = readFileSync(join(HERE, '../test/fixtures/menu-read-24.json'), 'utf8')
const TIPS = JSON.stringify({
  picks: [
    { dish_id: 'd7', why: 'Grilled chicken with vegetables: lots of protein, and it stays light.', local: 'Per favore, il pollo con le verdure senza olio aggiunto.', translated: 'The chicken with vegetables without added oil, please.' },
    { dish_id: 'd16', why: 'Sliced beef on rocket fills you up without much else on the plate.', local: 'La tagliata con più rucola e il parmigiano a parte, per favore.', translated: 'The sliced beef with more rocket and the parmesan on the side, please.' },
    { dish_id: 'd9', why: 'Sea bass is lean and still gives you plenty of protein.', local: 'Il branzino con insalata al posto delle patate, per favore.', translated: 'The sea bass with salad instead of potatoes, please.' },
  ],
})

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
          { name: 'Grilled chicken breast', usda_key: 'chicken, breast, roasted', form: 'discrete', typical_grams: 150, cooking: 'grilled' },
          { name: 'Rice', usda_key: 'rice, white, cooked', form: 'piled', typical_grams: 180, cooking: 'boiled' },
          { name: 'Mixed vegetables', usda_key: 'vegetables, mixed, cooked', form: 'piled', typical_grams: 120, cooking: 'boiled' },
        ],
        has_meat: true, has_fish: false, has_dairy_or_egg: false, allergen_hints: [],
      },
    }
  }
  if (restaurant_name) return { is_food: true, refusal_reason: null, restaurant_name, restaurant_city: null, dish: null }
  return { is_food: false, refusal_reason: 'No meal found in this link. Type what it is.', restaurant_name: null, restaurant_city: null, dish: null }
}

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
  const said = (body.messages?.[0]?.content ?? [])
  const userText = typeof said === 'string' ? said : said.map((b) => b.text ?? '').join('\n')
  const kind = /food post someone saved from the web/.test(system) ? 'import' : /waiter/.test(system) ? 'voice' : 'menu'
  const text = kind === 'import' ? JSON.stringify(importAnswer(userText)) : kind === 'voice' ? TIPS : MENU
  const id = `msg_mock_${++calls}`
  const withImage = Array.isArray(said) && said.some((b) => b.type === 'image')
  console.log(`${new Date().toISOString().slice(11, 23)} ${kind} ${body.model} ${body.stream ? 'stream' : 'json'}${kind === 'import' ? ` image=${withImage}` : ''}`)
  const usage = { input_tokens: 1200, output_tokens: Math.ceil(text.length / 3.6), cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

  if (!body.stream) {
    // A real read takes a moment; so does this one, so the waiting screen can be seen.
    await new Promise((r) => setTimeout(r, kind === 'import' ? 900 : 300))
    res.writeHead(200, { 'content-type': 'application/json', 'request-id': id })
    res.end(JSON.stringify({ id, type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage }))
    return
  }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'request-id': id })
  const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
  send('message_start', { message: { id, type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage } })
  send('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
  for (let i = 0; i < text.length; i += 60) send('content_block_delta', { index: 0, delta: { type: 'text_delta', text: text.slice(i, i + 60) } })
  send('content_block_stop', { index: 0 })
  send('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: usage.output_tokens } })
  send('message_stop', {})
  res.end()
}).listen(port, '127.0.0.1', () => console.log(`mock AI service with link imports on http://127.0.0.1:${port}`))
