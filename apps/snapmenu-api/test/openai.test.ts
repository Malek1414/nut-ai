import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker from '../src/index.js'
import { aiSettings } from '../src/ai-config.js'
import { create, readMenuStream, textOf } from '../src/anthropic.js'
import { askNeeds } from '../src/group/ai.js'
import { describeMeal } from '../src/me/estimate.js'
import { identifyMeal } from '../src/social/identify.js'
import { menuForChat } from '../src/voice/chat-types.js'
import type { MenuRead, MenuResult, Profile } from '../src/types.js'
import { memoryD1 } from './d1-shim.js'
import { handleAccount } from '../src/account.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/menu-read-24.json', import.meta.url), 'utf8')) as MenuRead
const profile: Profile = { goal: 'balanced', allergies: [], language: 'English' }
const requests: Record<string, any>[] = []
let status = 200
let finish = 'stop'
let refusal: string | null = null
let answer: (system: string, body: Record<string, any>) => unknown
const ai = () => aiSettings({ OPENAI_API_KEY: 'test-openai' })

beforeEach(() => {
  requests.length = 0; status = 200; finish = 'stop'; refusal = null
  answer = (system, body) => {
    if (system.includes('voice of a food app')) return { reply: 'The grilled dish is a good choice. It has 999 kcal.', dish_ids: ['d1'] }
    if (system.includes('waiter')) return { picks: ['d1', 'd2', 'd3'].map(dish_id => ({ dish_id, why: 'Only 999 kcal.', local: 'Senza olio, per favore.', translated: 'Without oil, please.' })) }
    if (system.includes('fill in a short form')) return { diet: 'vegan', allergies: [], goal: 'balanced', budget_eur: 20, name: null }
    if (system.includes('what a person typed')) return { is_food: true, refusal_reason: null, dishes: [fixture.dishes[0]] }
    if (system.includes('food post someone saved')) return { is_food: true, refusal_reason: null, restaurant_name: 'Test', restaurant_city: 'Berlin', dish: fixture.dishes[0] }
    return fixture
  }
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init: RequestInit) => {
    if (String(url) !== 'https://api.openai.com/v1/chat/completions') throw new Error('Unexpected external request')
    const body = JSON.parse(String(init.body)); requests.push(body)
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer test-openai')
    return new Response(JSON.stringify(status === 200 ? { choices: [{ message: { content: JSON.stringify(answer(body.messages[0].content, body)), refusal }, finish_reason: finish }] } : { error: { message: 'sensitive provider text test-openai' } }), { status })
  }))
})
afterEach(() => vi.unstubAllGlobals())

describe('OpenAI provider', () => {
  it('defaults to OpenAI, selects only its key/model, and retains explicit Anthropic settings', () => {
    expect(aiSettings({ OPENAI_API_KEY: 'open', ANTHROPIC_API_KEY: 'ant', MODEL_READ: 'claude-opus-5-5' })).toMatchObject({ provider: 'openai', apiKey: 'open', read: 'gpt-5.4-mini', voice: 'gpt-5.4-mini' })
    expect(aiSettings({ OPENAI_MODEL: 'gpt-4.1-mini' }).read).toBe('gpt-4.1-mini')
    expect(aiSettings({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'ant', OPENAI_API_KEY: 'open', MODEL_READ: 'claude-sonnet-5-5' })).toMatchObject({ provider: 'anthropic', apiKey: 'ant', read: 'claude-sonnet-5-5', voice: 'claude-opus-5-5' })
    expect(aiSettings({ ANTHROPIC_API_KEY: 'ant' }).apiKey).toBeUndefined()
  })

  it('runs a vision scan and menu chat through the Worker with engine-only nutrition', async () => {
    const DB = memoryD1(), env = { DB, OPENAI_API_KEY: 'test-openai' }
    const scan = await worker.fetch(new Request('http://x/api/menu', { method: 'POST', body: JSON.stringify({ image: `data:image/jpeg;base64,${'A'.repeat(2000)}`, profile, deviceId: 'openai-test-0001', team: true }) }), env)
    expect(scan.status).toBe(200)
    const menu = await scan.json() as MenuResult
    expect(menu.dishes.length).toBeGreaterThan(0)
    expect(JSON.stringify(menu)).not.toContain('999 kcal')
    expect(menu.dishes.every(d => Number.isFinite(d.kcal.low) && d.kcal.high >= d.kcal.low)).toBe(true)
    const read = requests[0]!
    expect(read['model']).toBe('gpt-5.4-mini')
    expect(read['messages'][1].content[0]).toEqual({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${'A'.repeat(2000)}` } })
    expect(read['response_format']).toMatchObject({ type: 'json_schema', json_schema: { strict: true } })
    expect(read).toMatchObject({ reasoning_effort: 'none', store: false, max_completion_tokens: 16000 })
    expect(read).not.toHaveProperty('thinking'); expect(read).not.toHaveProperty('output_config')
    const chat = await worker.fetch(new Request('http://x/api/chat', { method: 'POST', body: JSON.stringify({ message: 'What should I order?', menu: menuForChat(menu), profile, deviceId: 'openai-test-0001', team: true }) }), env)
    expect(chat.status).toBe(200)
    expect(await chat.json()).toMatchObject({ reply: 'The grilled dish is a good choice.', dishIds: ['d1'] })
    expect(requests).toHaveLength(3)
    const place = { id: 'n1234', name: 'Test restaurant', lat: 52.52, lng: 13.4, kind: 'restaurant', cuisine: 'Italian' }
    const attach = await worker.fetch(new Request('http://x/api/scan/attach', { method: 'POST', body: JSON.stringify({ scanId: menu.scanId, deviceId: 'openai-test-0001', place, dishes: [{ name: 'Fake dish', kcal: { low: 1, mid: 2, high: 3 }, protein: 999 }] }) }), env)
    expect(attach.status).toBe(200)
    const stored = DB.raw.prepare('SELECT name, kcal_mid FROM place_dishes WHERE scan_id=?').all(menu.scanId)
    expect(stored.length).toBeGreaterThan(0)
    expect(stored.some(d => d['name'] === 'Fake dish')).toBe(false)
    const chosen = menu.dishes.find(d => d.course === 'main')!
    const post = await worker.fetch(new Request('http://x/api/posts', { method: 'POST', headers: { 'x-device': 'openai-test-0001' }, body: JSON.stringify({ kind: 'order', community: 'Mitte', nickname: 'LunchPal', title: 'My best lunch order', scanId: menu.scanId, scanDevice: 'openai-test-0001', dishId: chosen.id, dish: { name: 'Fake dish', kcalLow: 1, kcalHigh: 2, protein: 999 } }) }), env)
    expect(post.status).toBe(200)
    expect((await post.json() as any).dish).toMatchObject({ name: chosen.name, kcalLow: chosen.kcal.low, kcalHigh: chosen.kcal.high, protein: Math.round(chosen.protein.mid) })
  })

  it('uses OpenAI for group needs, typed meals and vision link imports', async () => {
    expect(await askNeeds(ai(), 'Vegan, under twenty euros')).toMatchObject({ diet: 'vegan' })
    expect((await describeMeal(ai(), 'Lunch with chicken', 'English')).dishes.length).toBe(1)
    expect(await identifyMeal(ai(), null, { dish: 'Lunch', restaurant: 'Test' }, 'English', { data: 'AAAA', mediaType: 'image/png' })).toMatchObject({ is_food: true })
    expect(requests).toHaveLength(3)
    expect(requests[2]!['messages'][1].content[0]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } })
  })

  it('also supplies dishes to callers using the scan event interface', async () => {
    const dishes: string[] = []
    const result = await readMenuStream(ai(), 'AAAA', 'image/jpeg', profile, dish => dishes.push(dish.name_original))
    expect(dishes).toEqual(result.dishes.map(d => d.name_original))
    expect(requests).toHaveLength(1)
  })

  it.each([[401, 'auth'], [403, 'auth'], [429, 'rate_limited'], [400, 'bad_request'], [500, 'api']])('maps HTTP %s safely without retries or Anthropic fallback', async (code, expected) => {
    status = Number(code)
    await expect(askNeeds(ai(), 'Vegan please')).rejects.toMatchObject({ code: expected })
    expect(requests).toHaveLength(1)
  })

  it('handles missing keys, refusals, truncated and malformed answers without exposing provider text', async () => {
    await expect(create(aiSettings({}), { model: 'gpt-5.4-mini', messages: [] })).rejects.toMatchObject({ code: 'no_key' })
    expect(requests).toHaveLength(0)
    refusal = 'No'; await expect(askNeeds(ai(), 'Vegan')).rejects.toMatchObject({ code: 'refusal' })
    refusal = null; finish = 'length'; await expect(askNeeds(ai(), 'Vegan')).rejects.toMatchObject({ code: 'parse' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not JSON')))
    await expect(create(ai(), { model: ai().read, messages: [] })).rejects.toMatchObject({ code: 'parse' })
  })

  it('supports the plain assistant without requiring a JSON schema', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'Try a lentil salad.' }, finish_reason: 'stop' }] }))))
    expect(textOf(await create(ai(), { model: ai().voice, max_tokens: 620, system: 'Meal assistant', messages: [{ role: 'user', content: 'Lunch ideas' }] }))).toBe('Try a lentil salad.')
  })

  it('routes the signed-in meal assistant through OpenAI and drops invented numbers', async () => {
    const DB = memoryD1(), env = { DB, AUTH_ORIGIN: 'https://platepal.example', OPENAI_API_KEY: 'test-openai' }
    const call = (path: string, body: object, cookie = '') => {
      const url = new URL(`/api/account/${path}`, env.AUTH_ORIGIN)
      return handleAccount(new Request(url, { method: 'POST', headers: { origin: env.AUTH_ORIGIN, 'content-type': 'application/json', cookie }, body: JSON.stringify(body) }), env, url, async () => {})
    }
    const signup = await call('password', { mode: 'signup', username: 'openai_reader', password: 'local-test-password' })
    const cookie = signup.headers.get('set-cookie')!.split(';')[0]!
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'Try a lentil salad. It has 999 kcal.' }, finish_reason: 'stop' }] }))))
    const result = await call('chat', { messages: [{ role: 'user', text: 'Lunch ideas?' }] }, cookie)
    expect(result.status).toBe(200)
    expect(await result.json()).toEqual({ text: 'Try a lentil salad.' })
  })
})
