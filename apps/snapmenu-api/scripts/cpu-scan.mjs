#!/usr/bin/env node
/**
 * CPU time of one menu scan, measured with a real CPU clock. Costs nothing: the
 * AI service and Open Food Facts are answered in-process from test/fixtures.
 *
 *   node scripts/cpu-scan.mjs [--app <path to a snapmenu-api checkout>] [--runs 40] [--stream] [--image path.jpg]
 *
 * The Worker (src/index.ts) is bundled with esbuild exactly as wrangler does and
 * run in Node, the same V8 that runs it on Cloudflare. What is counted:
 *   + every line of Worker code, the AI SDK, JSON in and out, the engine
 *   + parsing each database result (the D1 binding does this inside the Worker)
 *   - SQLite itself (on Cloudflare the query runs in D1, not on the Worker's CPU)
 * What it cannot count is the D1 binding's own plumbing per round trip, so the
 * true cost of a round trip is higher than shown: fewer round trips matter more
 * on Cloudflare than here. `--app` points at another checkout to compare.
 */
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { build } from 'esbuild'

const HERE = dirname(fileURLToPath(import.meta.url))
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`)
  return i < 0 ? dflt : process.argv[i + 1]
}
const APP = resolve(arg('app', join(HERE, '..')))
const runs = Number(arg('runs', 40))
const stream = process.argv.includes('--stream')
const imagePath = arg('image', join(HERE, '../../snapmenu-web/test-menus/trattoria.jpg'))
const fixture = readFileSync(join(HERE, '../test/fixtures/menu-read-24.json'), 'utf8')

// ---- bundle the Worker like wrangler does (aliases from wrangler.toml) ----
const pkg = (n) => join(APP, '../../packages', n, 'src/index.ts')
const work = mkdtempSync(join(tmpdir(), 'snapmenu-cpu-'))
const outfile = join(work, 'worker.mjs')
await build({
  entryPoints: [join(APP, 'src/index.ts')], bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', outfile, logLevel: 'error',
  mainFields: ['module', 'main'], conditions: ['worker', 'browser', 'import'], external: ['node:*'],
  alias: Object.fromEntries(['core-schema', 'gram-engine', 'resolver', 'totals', 'confidence', 'repair', 'db-adapter', 'clamp'].map((n) => [`@nutai/${n}`, pkg(n)])),
})
const worker = (await import(pathToFileURL(outfile).href)).default

// ---- D1 over node:sqlite: SQLite time is taken out, result parsing stays in ----
function corpus() {
  const built = join(HERE, '../data/nutrition.db')
  if (existsSync(built)) return built
  const d1 = join(HERE, '../.wrangler/state/v3/d1/miniflare-D1DatabaseObject')
  const file = existsSync(d1) ? readdirSync(d1).find((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite') : null
  if (!file) throw new Error('No corpus found. Run `npm run db:setup` first.')
  return join(d1, file)
}
const dbFile = join(work, 'd1.sqlite')
copyFileSync(corpus(), dbFile)
const sqlite = new DatabaseSync(dbFile)
sqlite.exec('CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, type TEXT, device TEXT, team INTEGER, props TEXT)')
const cache = new Map()
const prep = (sql) => cache.get(sql) ?? (cache.set(sql, sqlite.prepare(sql)), cache.get(sql))
const d1 = { cpuUs: 0, trips: 0, queries: 0 }
/** Run fn outside the scan's CPU count. */
function outside(fn) {
  const c0 = process.cpuUsage()
  try { return fn() } finally { const c = process.cpuUsage(c0); d1.cpuUs += c.user + c.system }
}
const exec = (sql, params, reader) => {
  d1.queries++
  // The binding receives JSON text: producing it is D1's work, parsing it is the Worker's.
  const text = outside(() => JSON.stringify(reader ? prep(sql).all(...params) : (prep(sql).run(...params), [])))
  return { results: JSON.parse(text), meta: {} }
}
const isRead = (sql) => /^\s*(select|with)\b/i.test(sql)
const stmt = (sql, params = []) => ({
  sql, params,
  bind: (...v) => stmt(sql, v.map((p) => (typeof p === 'boolean' ? (p ? 1 : 0) : p ?? null))),
  all: async () => { d1.trips++; return exec(sql, params, true) },
  first: async () => { d1.trips++; return exec(sql, params, true).results[0] ?? null },
  run: async () => { d1.trips++; return exec(sql, params, isRead(sql)) },
})
const DB = {
  prepare: (sql) => stmt(sql),
  exec: async (sql) => { d1.trips++; outside(() => sqlite.exec(sql)) },
  batch: async (stmts) => { d1.trips++; return stmts.map((s) => exec(s.sql, s.params, isRead(s.sql))) },
}

// ---- the AI service and Open Food Facts, answered in-process ----
const TIPS = JSON.stringify({ picks: [{ dish_id: 'd7', why: 'Lots of protein, and it stays light.', local: 'Per favore, senza olio aggiunto.', translated: 'Without added oil, please.' }, { dish_id: 'd16', why: 'Filling, with little else on the plate.', local: 'Il parmigiano a parte, per favore.', translated: 'The parmesan on the side, please.' }, { dish_id: 'd9', why: 'Lean fish with plenty of protein.', local: 'Con insalata al posto delle patate.', translated: 'With salad instead of potatoes.' }] })
const message = (text, model) => ({ id: 'msg_local', type: 'message', role: 'assistant', model, content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 2400, output_tokens: Math.ceil(text.length / 3.6) } })
const enc = new TextEncoder()
function sse(text, model) {
  const ev = (type, data) => enc.encode(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
  const chunks = outside(() => {
    const out = [ev('message_start', { message: { ...message('', model), content: [] } }), ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })]
    // One event per chunk of ~14 characters, like the real service: every chunk wakes the Worker.
    for (let i = 0; i < text.length; i += 14) out.push(ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: text.slice(i, i + 14) } }))
    out.push(ev('content_block_stop', { index: 0 }), ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } }), ev('message_stop', {}))
    return out
  })
  let i = 0
  return new ReadableStream({ pull(c) { if (i < chunks.length) c.enqueue(chunks[i++]); else c.close() } })
}
globalThis.fetch = async (url, init) => {
  const u = String(url instanceof Request ? url.url : url)
  if (!u.includes('/v1/messages')) return new Response('{"hits":[]}', { headers: { 'content-type': 'application/json' } })
  const body = outside(() => JSON.parse(typeof init.body === 'string' ? init.body : new TextDecoder().decode(init.body)))
  const text = /waiter/.test(JSON.stringify(body.system)) ? TIPS : fixture
  if (body.stream) return new Response(sse(text, body.model), { headers: { 'content-type': 'text/event-stream' } })
  return new Response(JSON.stringify(message(text, body.model)), { headers: { 'content-type': 'application/json' } })
}

// ---- measure ----
const image = `data:image/jpeg;base64,${readFileSync(imagePath).toString('base64')}`
const payload = JSON.stringify({ image, profile: { goal: 'lose_fat', allergies: ['sesame'], language: 'English' }, deviceId: 'bench-device-0001', team: true, ...(stream ? { stream: true } : {}) })
const env = { DB, ANTHROPIC_API_KEY: 'local-bench', ANTHROPIC_BASE_URL: 'http://ai.invalid' }

async function scan() {
  Object.assign(d1, { cpuUs: 0, trips: 0, queries: 0 })
  const waits = []
  const req = new Request('http://local/api/menu', { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload })
  const c0 = process.cpuUsage()
  const res = await worker.fetch(req, env, { waitUntil: (p) => waits.push(p) })
  const text = await res.text()
  await Promise.all(waits)
  const c = process.cpuUsage(c0)
  if (!res.ok || !(stream ? text.includes('"type":"done"') : text.includes('"dishes"'))) throw new Error(`scan failed: ${res.status} ${text.slice(0, 300)}`)
  return { cpuMs: (c.user + c.system - d1.cpuUs) / 1000, trips: d1.trips, queries: d1.queries, outKb: text.length / 1024 }
}

const first = await scan()
const warm = []
for (let i = 0; i < runs; i++) warm.push(await scan())
const sorted = warm.map((s) => s.cpuMs).sort((a, b) => a - b)
const median = sorted[Math.floor(sorted.length / 2)]
const f = (n) => n.toFixed(1)
console.log(`${APP}`)
console.log(`mode ${stream ? 'stream' : 'json'}, image ${Math.round(image.length / 1024)} KB, 24 dishes, response ${Math.round(warm[0].outKb)} KB`)
console.log(`first scan of the isolate: ${f(first.cpuMs)} ms CPU, ${first.trips} database round trips (${first.queries} queries)`)
console.log(`warm scan, median of ${runs}:  ${f(median)} ms CPU (min ${f(sorted[0])}, p90 ${f(sorted[Math.floor(sorted.length * 0.9)])}), ${warm[0].trips} database round trips (${warm[0].queries} queries)`)
process.exit(0)
