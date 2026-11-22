#!/usr/bin/env node
/**
 * How long a real scan takes from upload to the finished answer, one model
 * setting against another, on the test menus.
 *
 *   npm run bench:latency -w @snapmenu/api                # prints the plan and its price, runs nothing
 *   npm run bench:latency -w @snapmenu/api -- --paid      # the real AI service (ANTHROPIC_API_KEY in .dev.vars): costs money
 *   npm run bench:latency -w @snapmenu/api -- --mock      # the local stand-in: free, checks this script, says nothing about a model
 *
 *   --models claude-opus-5-5,claude-sonnet-5-5   the settings to compare; each runs both jobs (MODEL_READ and MODEL_VOICE)
 *   --runs 3                                     scans per menu and model
 *   --menus imbiss,trattoria                     files in ../snapmenu-web/test-menus/<name>.jpg
 *
 * For every model it starts its own local Worker (`wrangler dev --local` on a
 * free port, on a throwaway copy of the local database, the model set with
 * `--var`), so nothing here touches a running dev server or its data. Scans are
 * interleaved: the models take turns on the same menu, so both see the same
 * minutes of the AI service's speed. A time is the wall clock of one
 * `POST /api/menu`, the same request the web app sends.
 *
 * It ends with the rule the defaults follow: Claude Opus 5.5 stays the default
 * for both jobs unless it is more than 1.5 times slower than the other model;
 * then the other model reads the menu and Opus 5.5 keeps writing the words.
 */
import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const API_DIR = join(HERE, '..')
const flag = (name) => process.argv.includes(`--${name}`)
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`)
  return i < 0 ? dflt : process.argv[i + 1]
}

const models = arg('models', 'claude-opus-5-5,claude-sonnet-5-5').split(',').map((s) => s.trim()).filter(Boolean)
const runs = Math.max(1, Number(arg('runs', 3)))
const menus = arg('menus', 'imbiss,trattoria').split(',').map((s) => s.trim()).filter(Boolean)
const paid = flag('paid')
const mock = flag('mock')
const SLOWER_THAN = 1.5

if (models.some((m) => m.includes('haiku'))) {
  console.error('No Haiku models in this project.')
  process.exit(2)
}

// For the price of a paid run. Input tokens per menu read were counted with the free count_tokens endpoint
// (6,114 with the photo and the instructions, 1,153 for the voice call); output is a 13-dish menu.
// US dollars per million tokens, from the Claude pricing page on 21 Nov 2026. An estimate, not a quote.
const PRICE = { 'claude-opus-5-5': [4, 20], 'claude-sonnet-5-5': [2, 10] }
const TOKENS_IN = 6114 + 1153
const TOKENS_OUT = 5000
const scans = runs * menus.length
const cost = models.reduce((sum, m) => {
  const [i, o] = PRICE[m] ?? PRICE['claude-opus-5-5']
  return sum + (scans * (TOKENS_IN * i + TOKENS_OUT * o)) / 1e6
}, 0)

console.log(`Plan: ${models.length} model settings x ${menus.length} menus x ${runs} runs = ${scans * models.length} scans (${models.join(' vs ')}; menus: ${menus.join(', ')}).`)
if (!paid && !mock) {
  console.log(`Against the real AI service this costs about ${cost.toFixed(2)} US dollars on the key in .dev.vars.`)
  console.log('Nothing was run. Add --paid to run it for real, or --mock to try the script against the local stand-in for free.')
  process.exit(0)
}
if (paid && mock) {
  console.error('Choose one of --paid and --mock.')
  process.exit(2)
}
console.log(paid ? `Real AI service. Estimated cost: about ${cost.toFixed(2)} US dollars.` : 'Local stand-in for the AI service: free. These times say nothing about a real model.')

const images = Object.fromEntries(menus.map((m) => {
  const file = join(API_DIR, '../snapmenu-web/test-menus', `${m}.jpg`)
  if (!existsSync(file)) { console.error(`No such test menu: ${file}`); process.exit(2) }
  return [m, `data:image/jpeg;base64,${readFileSync(file).toString('base64')}`]
}))

const freePort = () => new Promise((res, rej) => {
  const s = createServer()
  s.once('error', rej)
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)) })
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const children = []
const tempDirs = []
function start(cmd, args, name) {
  const child = spawn(cmd, args, { cwd: API_DIR, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
  let tail = ''
  const keep = (b) => { tail = (tail + b.toString()).slice(-4000) }
  child.stdout.on('data', keep)
  child.stderr.on('data', keep)
  children.push(child)
  // What the child printed, with anything that looks like a key taken out, for a failed start.
  child.tail = () => `${name}:\n${tail.replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-<hidden>')}`
  return child
}
function cleanup() {
  for (const c of children) { try { process.kill(-c.pid, 'SIGTERM') } catch { /* already gone */ } }
  for (const d of tempDirs) { try { rmSync(d, { recursive: true, force: true }) } catch { /* ignore */ } }
}
process.on('SIGINT', () => { cleanup(); process.exit(130) })

async function main() {
  let mockUrl = null
  if (mock) {
    const port = await freePort()
    start('node', [join(HERE, 'mock-anthropic.mjs'), String(port), '250'], 'mock AI service')
    mockUrl = `http://127.0.0.1:${port}`
  }

  // One Worker per model setting, each on its own copy of the local database (the food rows the engine reads).
  const state = join(API_DIR, '.wrangler/state/v3')
  const workers = []
  for (const model of models) {
    const dir = mkdtempSync(join(tmpdir(), 'snapmenu-bench-'))
    tempDirs.push(dir)
    if (existsSync(state)) cpSync(state, join(dir, 'v3'), { recursive: true })
    else console.log('No local database found (npm run db:setup): scans will find fewer foods, the times still count.')
    const port = await freePort()
    const child = start('npx', [
      'wrangler', 'dev', '--local', '--ip', '127.0.0.1', '--port', String(port), '--inspector-port', String(await freePort()), '--persist-to', dir,
      '--var', 'AI_PROVIDER:anthropic', '--var', `MODEL_READ:${model}`, '--var', `MODEL_VOICE:${model}`,
      // A stand-in run gets a dummy key: a call that went to the real service by mistake fails instead of costing money.
      ...(mockUrl ? ['--var', `ANTHROPIC_BASE_URL:${mockUrl}`, '--var', 'ANTHROPIC_API_KEY:test-not-a-real-key'] : []),
    ], `worker for ${model}`)
    workers.push({ model, url: `http://127.0.0.1:${port}`, child })
  }
  for (const w of workers) {
    let health = null
    for (let i = 0; i < 120 && !health; i++) {
      await sleep(500)
      try { health = await (await fetch(`${w.url}/api/health`)).json() } catch { /* not up yet */ }
    }
    if (!health) throw new Error(`The Worker for ${w.model} did not start.\n${w.child.tail()}`)
    if (!health.ai) throw new Error('No ANTHROPIC_API_KEY: put the key in apps/snapmenu-api/.dev.vars.')
    if (health.models?.read !== w.model || health.models?.voice !== w.model) throw new Error(`The Worker runs ${JSON.stringify(health.models)}, not ${w.model}.`)
  }
  console.log(`Workers are up: ${workers.map((w) => `${w.model} on ${w.url}`).join(', ')}.\n`)

  const results = []
  for (let run = 1; run <= runs; run++) {
    for (const menu of menus) {
      // The models take turns, and the one that goes first changes every round.
      const order = run % 2 ? workers : [...workers].reverse()
      for (const w of order) {
        const body = JSON.stringify({ image: images[menu], profile: { goal: 'lose_fat', allergies: ['sesame'], language: 'English' }, locale: 'en', deviceId: 'bench-latency-0001', team: true })
        const t0 = performance.now()
        let row = { model: w.model, menu, run, ok: false }
        try {
          const res = await fetch(`${w.url}/api/menu`, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
          const out = await res.json()
          const seconds = (performance.now() - t0) / 1000
          if (!res.ok) row = { ...row, seconds, error: `${res.status} ${out?.error?.code ?? ''}` }
          else row = { ...row, ok: true, seconds, dishes: out.dishes.length, tips: out.tips.length, readS: out.timings.readMs / 1000, voiceS: out.timings.tipsMs / 1000 }
        } catch (e) {
          row = { ...row, seconds: (performance.now() - t0) / 1000, error: String(e?.message ?? e).slice(0, 120) }
        }
        results.push(row)
        console.log(row.ok
          ? `run ${run} ${menu.padEnd(10)} ${w.model.padEnd(18)} ${row.seconds.toFixed(1).padStart(5)} s  (read ${row.readS.toFixed(1)} s, words ${row.voiceS.toFixed(1)} s, ${row.dishes} dishes, ${row.tips} tips)`
          : `run ${run} ${menu.padEnd(10)} ${w.model.padEnd(18)} FAILED after ${row.seconds.toFixed(1)} s: ${row.error}`)
      }
    }
  }

  const median = (xs) => {
    if (xs.length === 0) return NaN
    const s = [...xs].sort((a, b) => a - b)
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
  }
  const med = (model, menu, key = 'seconds') => median(results.filter((r) => r.ok && r.model === model && r.menu === menu).map((r) => r[key]))
  console.log(`\nMedian seconds per scan, upload to finished answer (${runs} runs each${mock ? ', LOCAL STAND-IN, not a real model' : ''}):`)
  console.log(`${'menu'.padEnd(12)}${models.map((m) => m.padStart(20)).join('')}`)
  for (const menu of menus) console.log(`${menu.padEnd(12)}${models.map((m) => med(m, menu).toFixed(1).padStart(20)).join('')}`)
  for (const key of ['readS', 'voiceS']) {
    console.log(`  of which ${key === 'readS' ? 'reading the menu' : 'writing the words'}:`)
    for (const menu of menus) console.log(`${`  ${menu}`.padEnd(12)}${models.map((m) => med(m, menu, key).toFixed(1).padStart(20)).join('')}`)
  }
  const failed = results.filter((r) => !r.ok)
  if (failed.length) console.log(`\n${failed.length} of ${results.length} scans failed: ${[...new Set(failed.map((f) => `${f.model} ${f.error}`))].join('; ')}`)

  // The rule for the defaults, on the sum of the per-menu medians.
  const [first, second] = models
  if (second && first === 'claude-opus-5-5') {
    const total = (m) => menus.reduce((sum, menu) => sum + med(m, menu), 0)
    const ratio = total(first) / total(second)
    if (!Number.isFinite(ratio)) console.log('\nNo decision: not every menu has a successful scan for both models.')
    else if (mock) console.log(`\nRatio ${ratio.toFixed(2)} (stand-in): the script works. Run it with --paid for a decision.`)
    else if (ratio > SLOWER_THAN) console.log(`\n${first} is ${ratio.toFixed(2)}x slower than ${second}: more than ${SLOWER_THAN}x.\nSet in wrangler.toml ([vars] and [env.production.vars]):  MODEL_READ = "${second}"   MODEL_VOICE = "${first}"`)
    else console.log(`\n${first} takes ${ratio.toFixed(2)}x the time of ${second}: not more than ${SLOWER_THAN}x slower.\nKeep the defaults:  MODEL_READ = "${first}"   MODEL_VOICE = "${first}"`)
  }
}

main().then(() => { cleanup(); process.exit(0) }, (err) => { console.error(String(err?.message ?? err)); cleanup(); process.exit(1) })
