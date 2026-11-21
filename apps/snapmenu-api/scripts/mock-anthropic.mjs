#!/usr/bin/env node
/**
 * A local stand-in for the AI service, for benchmarks only. No key, no cost.
 *
 *   node scripts/mock-anthropic.mjs [port=8804] [tokensPerSecond=0]
 *
 * It answers POST /v1/messages with a recorded menu read (test/fixtures) or a
 * fixed set of words for the picked dishes, as one JSON body or as a server-sent event stream
 * when the request asks for `stream: true`. tokensPerSecond > 0 paces the
 * stream like the real service; 0 sends it as fast as possible (CPU profiling).
 *
 * Point a dev Worker at it:
 *   npx wrangler dev --local --port 8803 --var ANTHROPIC_BASE_URL:http://127.0.0.1:8804
 */
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const port = Number(process.argv[2] ?? 8804)
const tps = Number(process.argv[3] ?? 0)
const firstTokenMs = tps > 0 ? 1500 : 0

const fixture = JSON.parse(readFileSync(join(HERE, '../test/fixtures/menu-read-24.json'), 'utf8'))

const MENU = JSON.stringify(fixture)

const TIPS = JSON.stringify({
  picks: [
    { dish_id: 'd7', why: 'Grilled chicken with vegetables: lots of protein, and it stays light.', local: 'Per favore, il pollo con le verdure senza olio aggiunto.', translated: 'The chicken with vegetables without added oil, please.' },
    { dish_id: 'd16', why: 'Sliced beef on rocket fills you up without much else on the plate.', local: 'La tagliata con più rucola e il parmigiano a parte, per favore.', translated: 'The sliced beef with more rocket and the parmesan on the side, please.' },
    { dish_id: 'd9', why: 'Sea bass is lean and still gives you plenty of protein.', local: 'Il branzino con insalata al posto delle patate, per favore.', translated: 'The sea bass with salad instead of potatoes, please.' },
  ],
})

/** The menu chat (src/voice/chat.ts): a short answer about the first two dishes it was given. */
function chatAnswer(content) {
  const [a, b] = [...String(content ?? '').matchAll(/^(d\d+): (.+?) \[/gm)].map((m) => ({ id: m[1], name: m[2].replace(/ \(.*\)$/, '') }))
  if (!a) return JSON.stringify({ reply: 'The menu does not say. Best ask the waiter.', dish_ids: [] })
  return JSON.stringify({ reply: `${a.name} is a good pick for your goal${b ? `. ${b.name} comes close` : ''}.`, dish_ids: [a.id, ...(b ? [b.id] : [])] })
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
  const isChat = /voice of a food app/.test(system)
  const isTips = !isChat && /waiter/.test(system)
  const text = isChat ? chatAnswer(body.messages?.[0]?.content) : isTips ? TIPS : MENU
  const outTokens = Math.ceil(text.length / 3.6)
  const id = `msg_mock_${++calls}`
  console.log(`${new Date().toISOString().slice(11, 23)} ${isChat ? 'chat' : isTips ? 'voice' : 'menu'} ${body.model} ${body.stream ? 'stream' : 'json'} thinking=${body.thinking?.type ?? 'unset'} max_tokens=${body.max_tokens} in=${Math.round(Buffer.concat(chunks).length / 1024)}KB out~${outTokens}tok`)

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
