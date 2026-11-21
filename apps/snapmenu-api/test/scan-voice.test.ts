import { readFileSync } from 'node:fs'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createComment } from '../src/community-api.js'
import worker, { type ScanEvent } from '../src/index.js'
import type { DishEstimate, MenuRead, MenuResult } from '../src/types.js'
import { COPY } from '../src/voice/copy.js'
import { VOICE_RULES } from '../src/voice/index.js'
import { memoryD1 } from './d1-shim.js'

/**
 * A whole scan against a local stand-in for the AI service: which language a
 * person is answered in, that no number on the screen is the model's, and which
 * model does which job.
 */

const FIXTURE = readFileSync(new URL('./fixtures/menu-read-24.json', import.meta.url), 'utf8')
const read = JSON.parse(FIXTURE) as MenuRead

interface AiRequest {
  model: string
  stream?: boolean
  system: unknown
  thinking?: { type: string }
  output_config?: { effort?: string; format?: { type?: string } }
  fallbacks?: unknown
  /** The request's `anthropic-beta` header (not part of the body). */
  beta: string | null
  messages: Array<{ content: string | Array<{ type: string; text?: string }> }>
}
interface Pick { dish_id: string; why: string; local: string; translated: string }

const requests: AiRequest[] = []
/** What the stand-in answers: a text, or a whole Response (an error). */
let reply: (req: AiRequest, voice: boolean) => string | Response
const isVoice = (req: AiRequest) => /waiter/.test(JSON.stringify(req.system))
const pickedIds = (req: AiRequest) => [...String(req.messages[0]!.content).matchAll(/^(d\d+): /gm)].map((m) => m[1]!)
const cleanPick = (dish_id: string): Pick => ({ dish_id, why: 'Lots of protein, and it stays light.', local: 'Senza olio, per favore.', translated: 'Without oil, please.' })
const answerWith = (menu: string, picks: (ids: string[]) => Pick[] = (ids) => ids.map(cleanPick)) => (req: AiRequest, voice: boolean) => (voice ? JSON.stringify({ picks: picks(pickedIds(req)) }) : menu)
const refuse = (status: number, type: string, message: string) => new Response(JSON.stringify({ type: 'error', error: { type, message } }), { status, headers: { 'content-type': 'application/json' } })

beforeAll(() => {
  vi.stubGlobal('fetch', async (url: unknown, init: { body: string; headers?: HeadersInit }) => {
    if (!String(url).includes('/v1/messages')) return new Response('{"hits":[]}', { headers: { 'content-type': 'application/json' } })
    const req = { ...(JSON.parse(init.body) as AiRequest), beta: new Headers(init.headers).get('anthropic-beta') }
    requests.push(req)
    const out = reply(req, isVoice(req))
    if (out instanceof Response) return out
    if (req.stream) {
      // A model that thinks first streams a thinking block before the text; the reader has to skip it.
      const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
      let sse = ev('message_start', { message: {} }) + ev('content_block_start', { index: 0, content_block: { type: 'thinking', thinking: '' } })
      sse += ev('content_block_delta', { index: 0, delta: { type: 'signature_delta', signature: 'c2ln' } }) + ev('content_block_stop', { index: 0 })
      sse += ev('content_block_start', { index: 1, content_block: { type: 'text', text: '' } })
      for (let i = 0; i < out.length; i += 400) sse += ev('content_block_delta', { index: 1, delta: { type: 'text_delta', text: out.slice(i, i + 400) } })
      sse += ev('content_block_stop', { index: 1 }) + ev('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } }) + ev('message_stop', {})
      return new Response(sse, { headers: { 'content-type': 'text/event-stream' } })
    }
    // In one response, a model that thinks first answers with a thinking block before the text block.
    const content = [{ type: 'thinking', thinking: '', signature: 'c2ln' }, { type: 'text', text: out }]
    return new Response(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: req.model, content, stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }), { headers: { 'content-type': 'application/json' } })
  })
})

beforeEach(() => {
  requests.length = 0
  reply = answerWith(FIXTURE)
})

const image = `data:image/jpeg;base64,${'A'.repeat(2000)}`
const post = (profile: object, extra: object = {}, env: object = {}, headers: Record<string, string> = {}) =>
  worker.fetch(
    new Request('http://x/api/menu', { method: 'POST', headers, body: JSON.stringify({ image, profile, deviceId: 'device-0001', team: true, ...extra }) }),
    { DB: memoryD1(), ANTHROPIC_API_KEY: 'test', ...env },
  )
const scan = async (...args: Parameters<typeof post>) => {
  const res = await post(...args)
  expect(res.status).toBe(200)
  return (await res.json()) as MenuResult
}
const readRequest = () => requests.find((r) => !isVoice(r))!
const voiceRequest = () => requests.find(isVoice)!
const userText = (req: AiRequest) => {
  const c = req.messages[0]!.content
  return typeof c === 'string' ? c : c.map((b) => b.text ?? '').join(' ')
}
const whyLines = (lang: keyof typeof COPY) => new Set(Object.entries(COPY[lang]).filter(([k]) => k.startsWith('why.')).map(([, v]) => v))
const digits = /\p{N}/u

describe('the language a scan answers in', () => {
  it('is the language saved in the interview, before the phone and the browser', async () => {
    const r = await scan({ goal: 'lose_fat', allergies: ['milk'], language: 'German' }, { locale: 'fr-FR' }, {}, { 'accept-language': 'it-IT,it;q=0.9' })
    expect(r.profile.language).toBe('German')
    const german = whyLines('German')
    for (const d of r.dishes) expect(german.has(d.why), `${d.name}: ${d.why}`).toBe(true)
    // Skip reasons and allergen names are German too.
    const reasons = r.avoid.flatMap((a) => a.reasons)
    expect(reasons.length).toBeGreaterThan(0)
    expect(reasons.some((x) => x.startsWith('Enthält wahrscheinlich Milch'))).toBe(true)
    expect(r.dishes.flatMap((d) => d.allergens).filter((a) => a.allergen === 'milk').every((a) => a.label === 'Milch')).toBe(true)
  })

  it('is the phone locale the web app sends when nothing was saved', async () => {
    const r = await scan({ goal: 'build_muscle', allergies: [] }, { locale: 'fr-FR' }, {}, { 'accept-language': 'it-IT,it;q=0.9' })
    expect(r.profile.language).toBe('French')
    const french = whyLines('French')
    for (const d of r.dishes) expect(french.has(d.why), d.why).toBe(true)
  })

  it('is the browser language when the app sent neither, and English when nothing is known', async () => {
    expect((await scan({ goal: 'balanced', allergies: [] }, {}, {}, { 'accept-language': 'it-IT,it;q=0.9,en;q=0.8' })).profile.language).toBe('Italian')
    expect((await scan({ goal: 'balanced', allergies: [] }, {}, {}, { 'x-lang': 'tr-TR' })).profile.language).toBe('Turkish')
    const r = await scan({ goal: 'balanced', allergies: [], language: 'Klingon' })
    expect(r.profile.language).toBe('English')
    const english = whyLines('English')
    for (const d of r.dishes) expect(english.has(d.why), d.why).toBe(true)
  })

  it('both models are told the user\'s language and the rules of the voice', async () => {
    await scan({ goal: 'lose_fat', allergies: ['sesame'], language: 'German' })
    expect(userText(readRequest())).toContain("User's language: German")
    expect(userText(voiceRequest())).toContain("Menu language: Italian. Guest's language: German.")
    for (const req of [readRequest(), voiceRequest()]) {
      for (const rule of VOICE_RULES) expect(JSON.stringify(req.system)).toContain(JSON.stringify(rule).slice(1, -1))
    }
  })

  it('the sentence for the waiter stays in the menu\'s language, with its meaning in the user\'s language', async () => {
    reply = answerWith(FIXTURE, (ids) => ids.map((dish_id) => ({ dish_id, why: 'Viel Eiweiß und trotzdem leicht.', local: 'Senza olio, per favore.', translated: 'Ohne Öl, bitte.' })))
    const r = await scan({ goal: 'lose_fat', allergies: ['sesame'], language: 'German' })
    expect(r.menuLanguage).toBe('Italian')
    expect(r.tips.map((t) => t.dishId)).toEqual(r.top)
    for (const t of r.tips) expect(t).toEqual({ dishId: t.dishId, local: 'Senza olio, per favore.', translated: 'Ohne Öl, bitte.', why: 'Viel Eiweiß und trotzdem leicht.', lang: 'it' })
    // The voice model is asked for exactly that.
    expect(JSON.stringify(voiceRequest().system)).toMatch(/It is for the waiter, so it is in the menu's language/)
  })

  it('a menu in the user\'s own language needs no second line', async () => {
    const r = await scan({ goal: 'lose_fat', allergies: [], language: 'Italian' })
    expect(r.tips.length).toBe(r.top.length)
    for (const t of r.tips) expect(t).toMatchObject({ local: 'Senza olio, per favore.', translated: '' })
  })

  it('a failed scan says so in the user\'s language', async () => {
    // No photo: answered before the AI service is asked.
    const none = await worker.fetch(new Request('http://x/api/menu', { method: 'POST', body: JSON.stringify({ image: '', profile: { goal: 'lose_fat', allergies: [] }, locale: 'de-DE' }) }), { DB: memoryD1(), ANTHROPIC_API_KEY: 'test' })
    expect(await none.json()).toEqual({ error: { code: 'no_image', message: COPY.German['error.no_photo'] } })
    // The AI key is rejected.
    reply = () => refuse(401, 'authentication_error', 'invalid x-api-key')
    const auth = await post({ goal: 'lose_fat', allergies: [], language: 'Spanish' })
    expect(auth.status).toBe(502)
    expect(await auth.json()).toEqual({ error: { code: 'auth', message: COPY.Spanish['error.setup'] } })
    // The same failure in a streamed scan.
    const evs = (await (await post({ goal: 'lose_fat', allergies: [], language: 'Polish' }, { stream: true })).text()).split('\n\n').filter(Boolean).map((b) => JSON.parse(b.replace(/^data: /, '')) as ScanEvent)
    expect(evs.at(-1)).toEqual({ type: 'error', status: 502, error: { code: 'auth', message: COPY.Polish['error.setup'] } })
    // A photo without a menu and without a reason from the model.
    reply = answerWith(JSON.stringify({ is_menu: false, refusal_reason: null, restaurant_name: null, menu_language: '', cuisine: '', dishes: [] }))
    const notMenu = await post({ goal: 'lose_fat', allergies: [], language: 'Dutch' })
    expect(await notMenu.json()).toEqual({ error: { code: 'not_menu', message: COPY.Dutch['error.not_menu'] } })
  })

  it('the community answers in the viewer\'s language too', async () => {
    const out = await createComment(memoryD1(), { nickname: 'lena', body: '   ', postId: 'p1' }, { device: 'device-aaaa-1', team: false, lang: 'German' })
    expect(out).toEqual({ ok: false, status: 400, code: 'too_short', message: 'Schreib erst etwas.' })
  })
})

describe('numbers on screen are the engine\'s, never the model\'s', () => {
  const profile = { goal: 'lose_fat', allergies: ['sesame'], language: 'English' }
  const numbersOf = (d: DishEstimate) => ({ id: d.id, kcal: d.kcal, protein: d.protein, carbs: d.carbs, fat: d.fat, fiber: d.fiber, score: d.score, rows: d.rows.map((r) => [r.grams, r.per100]) })

  it('a number the voice model writes never reaches a person', async () => {
    reply = answerWith(FIXTURE, (ids) => [
      // A number in "why": the sentence for the waiter stays, the dish keeps the engine's own line.
      { dish_id: ids[0]!, why: 'Has 45 g protein and only 500 kcal.', local: 'Senza olio, per favore.', translated: 'Without oil, please.' },
      // A number in the sentence for the waiter: no tip for this dish at all.
      { dish_id: ids[1]!, why: 'Light and filling.', local: 'Il numero 12 con 2 uova, per favore.', translated: 'Number 12 with 2 eggs, please.' },
      // A number only in the translation: the guest could not read the sentence, so no tip either.
      { dish_id: ids[2]!, why: 'Light and filling.', local: 'Senza olio, per favore.', translated: 'Without oil, about 30% lighter.' },
    ])
    const r = await scan(profile)
    expect(r.top.length).toBe(3)
    expect(r.tips).toEqual([{ dishId: r.top[0], local: 'Senza olio, per favore.', translated: 'Without oil, please.', lang: 'it' }])
    for (const t of r.tips) expect(digits.test(`${t.local} ${t.translated} ${t.why ?? ''}`)).toBe(false)
    // Every dish still has a line why: the fixed one, chosen from the engine's numbers.
    const english = whyLines('English')
    for (const d of r.dishes) expect(english.has(d.why)).toBe(true)
  })

  it('what the voice model says changes no number', async () => {
    const quiet = await scan(profile)
    reply = answerWith(FIXTURE, (ids) => ids.map((dish_id) => ({ dish_id, why: '999 kcal and 99 g protein, 0% fat.', local: 'Per favore, 3000 calorie.', translated: '3000 calories, please.' })))
    const loud = await scan(profile)
    expect(loud.tips).toEqual([])
    expect(loud.dishes.map(numbersOf)).toEqual(quiet.dishes.map(numbersOf))
    expect(loud.dishes.map((d) => d.why)).toEqual(quiet.dishes.map((d) => d.why))
    expect({ top: loud.top, avoid: loud.avoid }).toEqual({ top: quiet.top, avoid: quiet.avoid })
  })

  it('the voice model is given words about a dish, never one of the engine\'s numbers', async () => {
    const r = await scan(profile)
    const asked = userText(voiceRequest())
    // The only digits in the request are the dish ids ("d7: ...") the answer refers back to.
    expect(digits.test(asked.replace(/^d\d+: /gm, ''))).toBe(false)
    for (const id of r.top) expect(asked).toMatch(new RegExp(`^${id}: .*Facts: .*protein`, 'm'))
    // And the answer it is asked for has no field a number could go in.
    expect(JSON.stringify(voiceRequest().output_config)).not.toMatch(/"(integer|number)"/)
  })

  it('an amount in what the reading model writes about a dish is not shown', async () => {
    const plain = await scan(profile)
    const menu: MenuRead = JSON.parse(FIXTURE) as MenuRead
    // Spaghetti alla Carbonara: a dish the app has a recipe for, so the engine has numbers for it here.
    menu.dishes[2] = {
      ...menu.dishes[2]!,
      description_translated: 'Pasta (250 g, about 900 kcal) with egg yolk and pecorino',
      allergen_hints: [{ allergen: 'gluten', reason: 'pasta, 30% wheat flour' }],
    }
    reply = answerWith(JSON.stringify(menu))
    const r = await scan(profile)
    const dish = r.dishes[2]!
    expect(dish.name).toBe(read.dishes[2]!.name_original)
    expect(dish.description).toBe('Pasta with egg yolk and pecorino')
    // The model's reason comes first, without its amount; the app's own hint may follow it.
    const gluten = dish.allergens.find((a) => a.allergen === 'gluten')!.reason
    expect(gluten.split('; ')[0]).toBe('pasta, wheat flour')
    expect(/[\d%]/.test(`${dish.description} ${gluten}`)).toBe(false)
    // The engine worked the dish out by itself: the same numbers as without the model's figures.
    expect(dish.kcal.mid).toBeGreaterThan(0)
    expect(dish.kcal).toEqual(plain.dishes[2]!.kcal)
    expect(dish.rows.map((x) => x.grams)).toEqual(plain.dishes[2]!.rows.map((x) => x.grams))
  })

  it('a number in a fixed sentence is one the engine computed for that dish', async () => {
    for (const goal of ['lose_fat', 'build_muscle', 'balanced'] as const) {
      const r = await scan({ goal, allergies: ['milk'], language: 'German' })
      const byId = new Map(r.dishes.map((d) => [d.id, d]))
      for (const d of r.dishes) expect(digits.test(d.why), d.why).toBe(false)
      for (const a of r.avoid) {
        const d = byId.get(a.dishId)!
        const own = new Set([d.kcal.low, d.kcal.high, d.kcal.mid, d.protein.mid].map((n) => String(Math.round(n))))
        for (const reason of a.reasons) {
          for (const n of reason.match(/\d[\d,]*/g) ?? []) expect(own.has(n.replace(/,/g, '')), `${d.name}: ${reason}`).toBe(true)
        }
      }
    }
  })
})

describe('which model does which job', () => {
  const profile = { goal: 'lose_fat', allergies: [], language: 'English' }

  it('both run on Claude Opus 5.5 by default, with the request that model accepts', async () => {
    await scan(profile)
    expect(requests.map((r) => r.model)).toEqual(['claude-opus-5-5', 'claude-opus-5-5'])
    for (const req of requests) {
      // Opus 5.5 answers 400 to `between_tools` and `disabled`: no thinking field, low effort.
      expect('thinking' in req).toBe(false)
      expect(req.output_config).toMatchObject({ effort: 'low', format: { type: 'json_schema' } })
      // A refused request is retried on a fallback model inside the same call, as before.
      expect(req.beta).toContain('server-side-fallback-2026-07-01')
      expect(req.fallbacks).toBe('default')
    }
    const health = (await (await worker.fetch(new Request('http://x/api/health'), { DB: memoryD1(), ANTHROPIC_API_KEY: 'test' })).json()) as { models: unknown }
    expect(health.models).toEqual({ read: 'claude-opus-5-5', voice: 'claude-opus-5-5' })
  })

  it('MODEL_READ and MODEL_VOICE switch a model without a code change', async () => {
    await scan(profile, {}, { MODEL_READ: 'claude-sonnet-5-5' })
    expect(readRequest()).toMatchObject({ model: 'claude-sonnet-5-5', thinking: { type: 'between_tools' } })
    expect(voiceRequest().model).toBe('claude-opus-5-5')
    expect('thinking' in voiceRequest()).toBe(false)
    requests.length = 0
    // A streamed scan: read the stream to its end, the voice call is the last thing in it.
    await (await post(profile, { stream: true }, { MODEL_READ: 'claude-opus-5-5', MODEL_VOICE: 'claude-sonnet-5-5' })).text()
    expect(readRequest()).toMatchObject({ model: 'claude-opus-5-5', stream: true })
    expect(voiceRequest()).toMatchObject({ model: 'claude-sonnet-5-5', thinking: { type: 'between_tools' } })
  })

  it('a Haiku model is never used, whatever the variable says', async () => {
    await scan(profile, {}, { MODEL_READ: 'claude-haiku-5-5', MODEL_VOICE: 'claude-haiku-4-5' })
    expect(requests.map((r) => r.model)).toEqual(['claude-opus-5-5', 'claude-opus-5-5'])
  })

  it('a model setting the service turns down falls back to the proven request instead of failing the scan', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const normal = answerWith(FIXTURE)
      reply = (req, voice) => (req.model === 'claude-opus-9-9' ? refuse(404, 'not_found_error', 'model: claude-opus-9-9') : normal(req, voice))
      const r = await scan(profile, {}, { MODEL_READ: 'claude-opus-9-9', MODEL_VOICE: 'claude-opus-9-9' })
      expect(r.dishes.length).toBe(24)
      expect(r.tips.length).toBe(3)
      expect(requests.map((x) => x.model)).toEqual(['claude-opus-9-9', 'claude-sonnet-5-5', 'claude-opus-9-9', 'claude-sonnet-5-5'])
      expect(requests[1]).toMatchObject({ thinking: { type: 'between_tools' } })
      // The log names the setting and the model, never a key.
      expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([
        'MODEL_READ=claude-opus-9-9 was turned down by the AI service; answered with claude-sonnet-5-5 instead.',
        'MODEL_VOICE=claude-opus-9-9 was turned down by the AI service; answered with claude-sonnet-5-5 instead.',
      ])

      // A streamed scan falls back the same way, and a 400 (a setting the model does not take) counts too.
      requests.length = 0
      reply = (req, voice) => (req.model === 'claude-opus-8-8' ? refuse(400, 'invalid_request_error', '"thinking.type.between_tools" is not supported for this model.') : normal(req, voice))
      const evs = (await (await post(profile, { stream: true }, { MODEL_READ: 'claude-opus-8-8' })).text()).split('\n\n').filter(Boolean).map((b) => JSON.parse(b.replace(/^data: /, '')) as ScanEvent)
      expect(evs.map((e) => e.type)).toEqual(['start', 'result', 'tips', 'done'])
      expect(requests.map((x) => x.model)).toEqual(['claude-opus-8-8', 'claude-sonnet-5-5', 'claude-opus-5-5'])
    } finally {
      warn.mockRestore()
    }
  })
})
