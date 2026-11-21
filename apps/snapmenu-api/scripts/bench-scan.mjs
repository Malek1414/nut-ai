#!/usr/bin/env node
/**
 * Wall-clock timings and a function-level profile of menu scans on a local
 * `wrangler dev` (V8 sampling profiler over the inspector port). The AI service
 * is the local mock (scripts/mock-anthropic.mjs), so a run costs nothing.
 *
 *   node scripts/mock-anthropic.mjs 8804 &            # add a rate, e.g. `8804 250`, to pace it like the real service
 *   npx wrangler dev --local --ip 127.0.0.1 --port 8803 --inspector-port 9233 \
 *     --var ANTHROPIC_BASE_URL:http://127.0.0.1:8804 &
 *   node scripts/bench-scan.mjs [--api http://127.0.0.1:8803] [--inspector 9233] [--runs 10] [--stream] [--image path.jpg] [--interval 1000]
 *
 * Use it for: time to the first dish, time to the ranked menu, and which
 * functions are busy. Its "busy" total is NOT CPU time: workerd's profiler
 * counts time spent waiting inside an awaited fetch or database call as busy.
 * For CPU time per scan use scripts/cpu-scan.mjs.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`)
  return i < 0 ? dflt : process.argv[i + 1]
}
const api = arg('api', 'http://127.0.0.1:8803')
const inspectorPort = Number(arg('inspector', 9233))
const runs = Number(arg('runs', 10))
const stream = process.argv.includes('--stream')
const imagePath = arg('image', join(HERE, '../../snapmenu-web/test-menus/trattoria.jpg'))
const top = Number(arg('top', 14))
// Sampling costs CPU itself: 1000 us keeps the profiler's own share small.
const interval = Number(arg('interval', 1000))

const image = `data:image/jpeg;base64,${readFileSync(imagePath).toString('base64')}`
const body = JSON.stringify({ image, profile: { goal: 'lose_fat', allergies: ['sesame'], language: 'English' }, deviceId: 'bench-device-0001', team: true, ...(stream ? { stream: true } : {}) })

async function inspector() {
  const targets = await (await fetch(`http://127.0.0.1:${inspectorPort}/json`)).json()
  // wrangler's inspector proxy only accepts DevTools origins.
  const ws = new WebSocket(targets[0].webSocketDebuggerUrl, { headers: { Origin: 'https://devtools.devprod.cloudflare.dev' } })
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('inspector connection failed')) })
  let id = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  }
  const send = (method, params = {}) => new Promise((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })) })
  return { send, close: () => ws.close() }
}

/** Sum the profile's sample time by function, leaving out idle time. */
function summarize(profile) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]))
  const self = new Map()
  let cpuUs = 0
  for (let i = 0; i < profile.samples.length; i++) {
    const node = byId.get(profile.samples[i])
    const dt = profile.timeDeltas[i] ?? 0
    const fn = node.callFrame.functionName || '(anonymous)'
    if (fn === '(idle)') continue
    cpuUs += dt
    const file = node.callFrame.url.split('/').slice(-2).join('/')
    const key = `${fn}${file ? `  ${file}:${node.callFrame.lineNumber + 1}` : ''}`
    self.set(key, (self.get(key) ?? 0) + dt)
  }
  return { cpuMs: cpuUs / 1000, self: [...self.entries()].sort((a, b) => b[1] - a[1]) }
}

async function scan() {
  const t0 = performance.now()
  const res = await fetch(`${api}/api/menu`, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
  let firstDishMs = null
  let rankedMs = null
  let dishes = 0
  if (stream && res.headers.get('content-type')?.includes('text/event-stream')) {
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
    let buf = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += value
      let end
      while ((end = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, end); buf = buf.slice(end + 2)
        if (!block.startsWith('data: ')) continue
        const ev = JSON.parse(block.slice(6))
        if (ev.type === 'dish' && firstDishMs == null) firstDishMs = performance.now() - t0
        if (ev.type === 'result') { dishes = ev.result.dishes.length; rankedMs = performance.now() - t0 }
        if (ev.type === 'error') throw new Error(`scan failed: ${ev.error.code}`)
      }
    }
  } else {
    const out = await res.json()
    if (!res.ok) throw new Error(`scan failed: ${res.status} ${JSON.stringify(out).slice(0, 200)}`)
    dishes = out.dishes.length
  }
  return { ms: performance.now() - t0, firstDishMs, rankedMs, dishes }
}

const insp = await inspector()
await insp.send('Profiler.enable')
await insp.send('Profiler.setSamplingInterval', { interval })

async function profiled(n) {
  await insp.send('Profiler.start')
  const out = []
  for (let i = 0; i < n; i++) out.push(await scan())
  const { result } = await insp.send('Profiler.stop')
  return { ...summarize(result.profile), scans: out }
}

const cold = await profiled(1)
const warm = await profiled(runs)
insp.close()

const f = (n) => n.toFixed(1)
console.log(`\nimage ${Math.round(image.length / 1024)} KB base64, ${warm.scans[0].dishes} dishes, mode ${stream ? 'stream' : 'json'}`)
console.log(`first scan after start: ${f(cold.cpuMs)} ms busy (includes waiting on I/O; for CPU see cpu-scan.mjs)`)
console.log(`warm scans (${runs}):       ${f(warm.cpuMs / runs)} ms busy per scan`)
const avg = (k) => f(warm.scans.reduce((n, s) => n + (s[k] ?? 0), 0) / runs)
console.log(`wall time per scan:      ${stream ? `first dish ${avg('firstDishMs')} ms, ranked menu ${avg('rankedMs')} ms, ` : ''}complete ${avg('ms')} ms`)
console.log(`\ntop self time, warm, ms per scan:`)
for (const [k, us] of warm.self.slice(0, top)) console.log(`  ${f(us / 1000 / runs).padStart(6)}  ${k}`)
process.exit(0)
