import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { DishStream } from '../src/dish-stream.js'
import worker, { type ScanEvent } from '../src/index.js'
import type { MenuRead, MenuResult } from '../src/types.js'
import { memoryD1 } from './d1-shim.js'

const FIXTURE = readFileSync(new URL('./fixtures/menu-read-24.json', import.meta.url), 'utf8')
const read = JSON.parse(FIXTURE) as MenuRead

describe('DishStream', () => {
  it('hands out each dish as its object closes, however the text is cut', () => {
    for (const step of [1, 7, 14, 4096]) {
      const s = new DishStream()
      const got = []
      for (let i = 0; i < FIXTURE.length; i += step) got.push(...s.push(FIXTURE.slice(i, i + step)))
      expect(got, `step ${step}`).toEqual(read.dishes)
      expect(s.header()).toMatchObject({ is_menu: true, restaurant_name: 'Trattoria da Nonna', menu_language: 'Italian' })
      expect(s.finish()).toEqual(read)
    }
  })

  it('is not fooled by brackets, quotes and escapes inside strings, or by pretty-printed JSON', () => {
    const tricky: MenuRead = {
      ...read, restaurant_name: 'The "dishes": [ {Bar} ]',
      dishes: [{ ...read.dishes[0]!, name_original: 'Soup {of the day} \\ "special" ]', description_translated: 'a } b [ c' }, read.dishes[1]!],
    }
    for (const text of [JSON.stringify(tricky), JSON.stringify(tricky, null, 2)]) {
      const s = new DishStream()
      const got = []
      for (let i = 0; i < text.length; i += 3) got.push(...s.push(text.slice(i, i + 3)))
      expect(got).toEqual(tricky.dishes)
      expect(s.header()?.restaurant_name).toBe(tricky.restaurant_name)
    }
  })

  it('keeps the whole dishes of an answer that was cut off', () => {
    const s = new DishStream()
    const cut = FIXTURE.slice(0, FIXTURE.indexOf('"Risotto ai Funghi Porcini"'))
    expect(s.push(cut).length).toBe(5)
    expect(() => s.finish()).toThrow()
    expect(s.dishes).toEqual(read.dishes.slice(0, 5))
  })
})

describe('POST /api/menu', () => {
  let menuText = FIXTURE
  const calls: Array<{ stream: boolean; tips: boolean }> = []

  beforeAll(() => {
    // The AI service, answered locally: one JSON body, or an event stream of small text pieces.
    vi.stubGlobal('fetch', async (url: unknown, init: { body: string }) => {
      if (!String(url).includes('/v1/messages')) return new Response('{"hits":[]}', { headers: { 'content-type': 'application/json' } })
      const body = JSON.parse(init.body) as { stream?: boolean; system: unknown; model: string; messages: Array<{ content: string }> }
      const tips = /waiter/.test(JSON.stringify(body.system))
      calls.push({ stream: body.stream === true, tips })
      // The voice call names the picked dishes one per line ("d7: Pollo ..."); answer for each of them.
      const picks = tips ? [...body.messages[0]!.content.matchAll(/^(d\d+): /gm)].map((m) => ({ dish_id: m[1], why: 'Lots of protein, and it stays light.', local: 'Senza olio, per favore.', translated: 'Without oil, please.' })) : []
      const text = tips ? JSON.stringify({ picks }) : menuText
      if (!body.stream) {
        return new Response(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }), { headers: { 'content-type': 'application/json' } })
      }
      const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
      let sse = ev('message_start', { message: {} }) + ev('ping', {}) + ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
      for (let i = 0; i < text.length; i += 14) sse += ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: text.slice(i, i + 14) } })
      sse += ev('content_block_stop', { index: 0 }) + ev('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } }) + ev('message_stop', {})
      // Cut the bytes at awkward places: an event may arrive in several reads.
      const bytes = new TextEncoder().encode(sse)
      let at = 0
      return new Response(new ReadableStream({ pull(c) { if (at >= bytes.length) return c.close(); c.enqueue(bytes.slice(at, at + 977)); at += 977 } }), { headers: { 'content-type': 'text/event-stream' } })
    })
  })

  const image = `data:image/jpeg;base64,${'A'.repeat(2000)}`
  const post = (extra: object, env: object = {}) =>
    worker.fetch(
      new Request('http://x/api/menu', { method: 'POST', body: JSON.stringify({ image, profile: { goal: 'lose_fat', allergies: ['sesame'], language: 'English' }, deviceId: 'device-0001', team: true, ...extra }) }),
      { DB: memoryD1(), ANTHROPIC_API_KEY: 'test', ...env },
    )
  const events = async (res: Response) => (await res.text()).split('\n\n').filter(Boolean).map((b) => JSON.parse(b.replace(/^data: /, '')) as ScanEvent)
  const stable = (r: MenuResult) => ({ ...r, scanId: '', timings: {} })

  it('answers a plain request with one JSON body, read in one response', async () => {
    calls.length = 0
    const res = await post({})
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    const result = (await res.json()) as MenuResult
    expect(result.dishes.length).toBe(24)
    expect(result.top.length).toBe(3)
    // One set of words per picked dish: the sentence for the waiter (the menu is Italian), its meaning, and why.
    expect(result.tips).toEqual(result.top.map((dishId) => ({ dishId, local: 'Senza olio, per favore.', translated: 'Without oil, please.', why: 'Lots of protein, and it stays light.', lang: 'it' })))
    expect(calls).toEqual([{ stream: false, tips: false }, { stream: false, tips: true }])
  })

  it('streams the same scan dish by dish: start, menu, dishes, result, tips, done', async () => {
    const plain = (await (await post({})).json()) as MenuResult
    calls.length = 0
    const res = await post({ stream: true })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const evs = await events(res)
    expect(calls[0]).toEqual({ stream: true, tips: false })
    expect(evs.map((e) => e.type)).toEqual(['start', 'menu', ...Array<string>(24).fill('dish'), 'result', 'tips', 'done'])
    const dishes = evs.filter((e) => e.type === 'dish')
    expect(dishes.map((e) => e.index).sort((a, b) => a - b)).toEqual([...Array(24).keys()])
    const result = evs.find((e) => e.type === 'result')!.result
    expect(result.tips).toEqual([])
    // Each dish event is the dish of the final result, and the final result is the plain answer.
    for (const d of dishes) expect(d.dish).toEqual(result.dishes[d.index])
    const tips = evs.find((e) => e.type === 'tips')!.tips
    expect(stable({ ...result, tips })).toEqual(stable(plain))
    expect(evs.at(-1)).toMatchObject({ type: 'done', timings: { totalMs: expect.any(Number) } })
  })

  it('SCAN_STREAM=off answers a stream request with the plain JSON body', async () => {
    const res = await post({ stream: true }, { SCAN_STREAM: 'off' })
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(((await res.json()) as MenuResult).dishes.length).toBe(24)
  })

  it('reports a photo that is not a menu: status 422, or an error event when streaming', async () => {
    menuText = JSON.stringify({ is_menu: false, refusal_reason: 'No menu text found in this photo.', restaurant_name: null, menu_language: '', cuisine: '', dishes: [] })
    try {
      const plain = await post({})
      expect(plain.status).toBe(422)
      expect(await plain.json()).toEqual({ error: { code: 'not_menu', message: 'No menu text found in this photo.' } })
      const evs = await events(await post({ stream: true }))
      expect(evs.map((e) => e.type)).toEqual(['start', 'error'])
      expect(evs[1]).toEqual({ type: 'error', status: 422, error: { code: 'not_menu', message: 'No menu text found in this photo.' } })
    } finally {
      menuText = FIXTURE
    }
  })

  it('rejects a bad request before any stream starts', async () => {
    const res = await worker.fetch(new Request('http://x/api/menu', { method: 'POST', body: JSON.stringify({ image, stream: true }) }), { DB: memoryD1(), ANTHROPIC_API_KEY: 'test' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('bad_profile')
  })
})
