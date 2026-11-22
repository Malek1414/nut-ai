import { describe, expect, it, vi, afterEach } from 'vitest'
import worker from '../src/index.js'
import { detectDiet } from '../src/allergens.js'
import { estimateDish } from '../src/menu-engine.js'
import { FoodLookup } from '../src/food-lookup.js'
import { memoryD1 } from './d1-shim.js'
import { languageTag } from '../src/voice/index.js'
import { lookupOpenFoodFacts } from '../src/off.js'
import { takeScan } from '../src/scan-limits.js'
import type { ModelDish } from '../src/types.js'

afterEach(() => vi.unstubAllGlobals())

describe('beta review regressions', () => {
  it('a device already at its limit cannot drain the shared allowance', async () => {
    const DB = memoryD1(), now = Date.UTC(2026, 10, 22, 4)
    for (let i = 0; i < 12; i++) expect(await takeScan(DB, 'limited-device-0001', '192.0.2.1', 100, now)).toBe(true)
    expect(await takeScan(DB, 'limited-device-0001', '192.0.2.1', 100, now)).toBe(false)
    expect(DB.raw.prepare("SELECT n FROM scan_limits WHERE key LIKE 'all|%'").get()?.['n']).toBe(12)
  })
  it('rejects unrelated OFF products even when a brand matches the search', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ hits: [{ code: 'test', product_name: 'Salanova Kopfsalat', brands: 'Frischer', nutriments: { 'energy-kcal_100g': 15, proteins_100g: 1, carbohydrates_100g: 2, fat_100g: 0.3 } }] })))
    expect(await lookupOpenFoodFacts('Frischer Orangensaft', 100, fetch)).toBeNull()
  })

  it('does not use a chocolate powder as a liquid drink', async () => {
    const dish: ModelDish = { name_original: 'Heiße Schokolade', name_translated: 'Hot chocolate', description_translated: '', course: 'drink', price: null, dish_key: 'none', portion: 'regular', components: [{ name: 'Hot chocolate', usda_key: 'hot chocolate', form: 'liquid', size: 'medium', typical_grams: 250, cooking: 'none' }], has_meat: false, has_fish: false, has_dairy_or_egg: true, allergen_hints: [] }
    const result = await estimateDish(dish, 0, { lookup: new FoodLookup(async queries => queries.map(() => [])), off: async () => ({ code: 'powder', name: 'Hot chocolate powder', brand: null, url: 'https://example.test', per100: { kcal: 478, protein_g: 8, carbs_g: 70, fat_g: 18, fiber_g: null, sugar_g: null, sodium_mg: null } }) }, { goal: 'balanced', allergies: [], language: 'English' })
    expect(result.rows.every(r => !r.counted)).toBe(true)
  })
  it('uses the original language first in bilingual menu labels', () => {
    expect(languageTag('German and English')).toBe('de')
    expect(languageTag('Italian (with English translations)')).toBe('it')
  })
  it.each(['Veganer Burger', 'Seitan Döner', 'Phở Chay', 'Grünes Curry mit Tofu'])('keeps the read components for %s instead of inserting a meat recipe', async name => {
    const dish: ModelDish = { name_original: name, name_translated: name, description_translated: 'Vegan', course: 'main', price: null, dish_key: 'none', portion: 'regular', components: [{ name: 'Tofu', usda_key: 'tofu', form: 'discrete', size: 'medium', typical_grams: 150, cooking: 'raw' }], has_meat: false, has_fish: false, has_dairy_or_egg: false, allergen_hints: [] }
    const result = await estimateDish(dish, 0, { lookup: new FoodLookup(async queries => queries.map(() => [])) }, { goal: 'plant_based', allergies: [], language: 'English' })
    expect(result.recipe).toBeNull()
    expect(result.rows.map(r => r.name)).toEqual(['Tofu'])
    expect(result.diet.vegan).toBe(true)
  })

  it.each(['peanut butter', 'coconut milk', 'oat milk', 'coconut cream', 'vegetable broth'])('recognizes the plant ingredient %s', name => {
    expect(detectDiet('Bowl', '', [{ name }], { meat: false, fish: false, dairy_or_egg: false }).vegan).toBe(true)
  })

  it('still rejects an explicit vegan label when actual animal ingredients contradict it', () => {
    expect(detectDiet('Vegan bowl', '', [{ name: 'Egg' }], { dairy_or_egg: true }).vegan).toBe(false)
    expect(detectDiet('Vegetarische Platte', '', [{ name: 'Chicken' }], { meat: true }).vegetarian).toBe(false)
  })

  it('rejects forged server events and scan requests without a device before inference', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    const env = { DB: memoryD1(), OPENAI_API_KEY: 'not-real' }
    const event = await worker.fetch(new Request('http://x/api/event', { method: 'POST', body: JSON.stringify({ type: 'scan', deviceId: 'beta-device-0001', props: { dishes: 999 } }) }), env)
    expect(event.status).toBe(400)
    const scan = await worker.fetch(new Request('http://x/api/menu', { method: 'POST', body: JSON.stringify({ image: 'A'.repeat(2000), profile: { goal: 'balanced', allergies: [] } }) }), env)
    expect(scan.status).toBe(400)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('counts failed scan attempts and enforces the app daily cap before calling a provider', async () => {
    const fetch = vi.fn(async () => new Response('{}', { status: 401 })); vi.stubGlobal('fetch', fetch)
    const env = { DB: memoryD1(), OPENAI_API_KEY: 'not-real', SCAN_DAILY_CAP: '2' }
    const scan = (device: string) => worker.fetch(new Request('http://x/api/menu', { method: 'POST', headers: { 'cf-connecting-ip': '192.0.2.1' }, body: JSON.stringify({ image: 'A'.repeat(2000), profile: { goal: 'balanced', allergies: [] }, deviceId: device }) }), env)
    expect((await scan('beta-device-0001')).status).toBe(502)
    expect((await scan('beta-device-0002')).status).toBe(502)
    expect((await scan('beta-device-0003')).status).toBe(429)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
