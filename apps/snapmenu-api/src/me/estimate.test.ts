import { existsSync, readFileSync } from 'node:fs'
import { DISH_TABLE } from '../dishes.js'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { openNodeDb } from '@nutai/db-adapter/node'
import type { DbAdapter } from '@nutai/db-adapter'
import { memoryD1 } from '../../test/d1-shim.js'
import { AiError } from '../anthropic.js'
import { clearFoodCaches, FoodLookup } from '../food-lookup.js'
import worker from '../index.js'
import { PROVEN_MODEL } from '../models.js'
import type { OffHit } from '../off.js'
import type { DishEstimate, ModelComponent, ModelDish, Profile } from '../types.js'
import { LANGUAGES } from '../voice/index.js'
import { ESTIMATE_COPY, estimateErrorText, sayEstimate } from './estimate-copy.js'
import { AI_LIMIT, cacheKey, cleanRead, describeRequest, estimateTyped, foldForKey, MAX_DISHES, MAX_TEXT, tidyText, validText, wholeDish, type Describe, type EstimateInput, type TypedRead } from './estimate.js'

/**
 * "What did you eat today?", typed. Three things are pinned here: which path a
 * text takes (recipe table, cache, model), that every number is the engine's,
 * and what a person reads when there is no answer.
 */

const EVENTS_SQL = readFileSync(new URL('../../migrations/0001_events.sql', import.meta.url), 'utf8')
const CORPUS = fileURLToPath(new URL('../../data/nutrition.db', import.meta.url))
const HAVE_DB = existsSync(CORPUS)

const profile: Profile = { goal: 'lose_fat', allergies: ['eggs'], language: 'English' }
const DEVICE = 'device-0001'

const comp = (name: string, usda_key: string, typical_grams: number, more: Partial<ModelComponent> = {}): ModelComponent => ({ name, usda_key, form: 'piled', typical_grams, cooking: 'none', ...more })
const modelDish = (over: Partial<ModelDish>): ModelDish => ({
  name_original: 'x', name_translated: 'x', description_translated: '', price: null, course: 'main', dish_key: 'none',
  portion: 'regular', components: [], has_meat: false, has_fish: false, has_dairy_or_egg: false, allergen_hints: [], ...over,
})
const EGGS = modelDish({
  name_original: '2 eggs and toast with butter', name_translated: '2 eggs and toast with butter', description_translated: 'Fried eggs with buttered toast',
  components: [comp('Fried eggs', 'egg, whole, cooked, fried', 100, { form: 'discrete', cooking: 'fried' }), comp('Toast', 'bread, white, toasted', 60, { form: 'flat' }), comp('Butter', 'butter, salted', 10, { form: 'spread' })],
  has_dairy_or_egg: true, allergen_hints: [{ allergen: 'eggs', reason: 'eggs' }, { allergen: 'milk', reason: 'butter' }],
})
const read = (...dishes: ModelDish[]): TypedRead => ({ is_food: true, dishes })

/** A database with the events table and nothing else: no food corpus, like a unit test should be. */
async function freshDb() {
  const db = memoryD1()
  await db.exec(EVENTS_SQL)
  return db
}

/** Stands in for Open Food Facts, so a described component has a row without the USDA corpus. */
const offHit = (per100kcal = 200): NonNullable<EstimateInput['off']> => async (q: string): Promise<OffHit> => ({
  code: '1', name: q, brand: null, url: 'https://world.openfoodfacts.org/product/1',
  per100: { kcal: per100kcal, protein_g: 10, carbs_g: 20, fat_g: 8, fiber_g: 2, sugar_g: null, sodium_mg: null },
})

type Db = Awaited<ReturnType<typeof freshDb>>
const run = (db: Db, text: unknown, describeFn: Describe, more: Partial<EstimateInput> = {}) =>
  estimateTyped({ db, text, profile, device: DEVICE, team: false, describe: describeFn, off: offHit(), ...more })
const events = (db: Db) => db.raw.prepare("SELECT type, device, team, props FROM events WHERE type LIKE 'me_estimate%' ORDER BY id").all() as Array<{ type: string; device: string | null; team: number; props: string }>
const cacheRows = (db: Db) => {
  try { return db.raw.prepare('SELECT * FROM me_reads').all() as Array<Record<string, unknown>> } catch { return [] }
}
const neverAsked: Describe = async () => { throw new Error('the model must not be asked') }
const ok = (out: Awaited<ReturnType<typeof estimateTyped>>) => {
  if (!out.ok) throw new Error(`expected an estimate, got ${out.code}`)
  return out
}
const failed = (out: Awaited<ReturnType<typeof estimateTyped>>) => {
  if (out.ok) throw new Error('expected a failure')
  return out
}

beforeEach(() => clearFoodCaches())

describe('the typed text', () => {
  it('is tidied: whitespace collapsed, invisible characters out', () => {
    expect(tidyText('  2 eggs \n and\ttoast  ')).toBe('2 eggs and toast')
    expect(tidyText('dö​ner﻿')).toBe('döner')
    expect(tidyText('‮evil‬ pizza')).toBe('evil pizza')
    expect(tidyText(42)).toBe('')
    expect(tidyText(null)).toBe('')
  })

  it('needs two letters and at most 200 characters, in any script', () => {
    expect(validText('ei')).toBe(true)
    expect(validText('2 eggs')).toBe(true)
    expect(validText('شاورما')).toBe(true)
    expect(validText('')).toBe(false)
    expect(validText('a')).toBe(false)
    expect(validText('12 34')).toBe(false)
    expect(validText('🍕🍕🍕')).toBe(false)
    expect(validText('a'.repeat(MAX_TEXT))).toBe(true)
    expect(validText('a'.repeat(MAX_TEXT + 1))).toBe(false)
  })

  it('is turned down without asking anyone when it is empty, one letter or far too long', async () => {
    const db = await freshDb()
    for (const text of ['', '   ', 'a', '123', 'pizza '.repeat(40), undefined, 7, { text: 'döner' }]) {
      const out = failed(await run(db, text, neverAsked))
      expect(out).toMatchObject({ status: 400, code: 'bad_text', copy: 'bad_text' })
    }
    expect(events(db)).toHaveLength(0)
  })

  it('keys the cache without case and punctuation, per language, and never folds another script to nothing', async () => {
    expect(foldForKey('  Chicken, RICE!  ')).toBe('chicken rice')
    expect(await cacheKey('English', 'Chicken, rice!')).toBe(await cacheKey('English', ' chicken   RICE '))
    expect(await cacheKey('English', 'chicken rice')).not.toBe(await cacheKey('German', 'chicken rice'))
    expect(await cacheKey('English', 'Hähnchen')).not.toBe(await cacheKey('English', 'Hahnchen'))
    expect(await cacheKey('Arabic', 'شاورما')).not.toBe(await cacheKey('Arabic', 'فلافل'))
    expect(await cacheKey('English', 'x y')).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('the recipe table answers a text that is exactly one of its dishes', () => {
  it('knows a whole dish from a text that only contains one', () => {
    expect(wholeDish('döner')?.key).toBe('doner_kebab')
    expect(wholeDish('  A Döner Kebab ')?.key).toBe('doner_kebab')
    expect(wholeDish('1 Currywurst mit Pommes')?.key).toBe('currywurst_pommes')
    expect(wholeDish('Currywurst with fries')?.key).toBe('currywurst_pommes') // the table's own label
    expect(wholeDish('eine Lasagne')?.key).toBe('lasagne')
    expect(wholeDish('Döner mit extra Käse und Pommes')).toBeNull()
    expect(wholeDish('2 döner')).toBeNull()
    expect(wholeDish('Adana Kebab Teller')).toBeNull()
    expect(wholeDish('!!!')).toBeNull()
  })

  it('estimates it with no model call and no wait', async () => {
    const db = await freshDb()
    const out = ok(await run(db, ' Döner ', neverAsked))
    expect(out.source).toBe('table')
    expect(out.dishes).toHaveLength(1)
    const d = out.dishes[0]!
    expect(d.recipe?.key).toBe('doner_kebab')
    expect(d.name).toBe('Döner')
    expect(d.translated).toBe('Döner Kebab (bread)')
    // The recipe's rows are bundled with the Worker, so this works on an empty database.
    expect(d.kcal.low).toBeGreaterThan(350)
    expect(d.kcal.high).toBeLessThan(1200)
    expect(d.kcal.low).toBeLessThan(d.kcal.mid)
    expect(d.kcal.mid).toBeLessThan(d.kcal.high)
    expect(d.protein.mid).toBeGreaterThan(20)
    expect(d.diet.vegetarian).toBe(false)
    expect(typeof d.score).toBe('number')
    expect(d.why.length).toBeGreaterThan(5)
    expect(cacheRows(db)).toHaveLength(0)
  })

  it('logs the estimate without the typed text', async () => {
    const db = await freshDb()
    ok(await run(db, 'Pizza Margherita', neverAsked, { team: true }))
    const [ev] = events(db)
    expect(ev).toMatchObject({ type: 'me_estimate', device: DEVICE, team: 1 })
    const props = JSON.parse(ev!.props) as Record<string, unknown>
    expect(props).toMatchObject({ source: 'table', dishes: 1, userLanguage: 'English', recipe: 'margherita' })
    expect(ev!.props.toLowerCase()).not.toContain('pizza')
  })
})

describe('a described meal goes to the model, and the engine does the numbers', () => {
  it('sends a text that only contains a table dish to the model, and estimates what the model read', async () => {
    const db = await freshDb()
    const describeFn = vi.fn<Describe>(async () => read(modelDish({
      name_original: 'Döner mit extra Käse und Pommes', name_translated: 'Döner with extra cheese and fries', description_translated: 'Döner in bread with cheese, and fries on the side',
      components: [comp('Flatbread', 'bread, pita, white', 110), comp('Döner meat', 'lamb, ground, cooked', 120), comp('Cheese', 'cheese, gouda', 30), comp('Fries', 'potatoes, french fried', 150, { cooking: 'deep_fried' })],
      has_meat: true, has_dairy_or_egg: true,
    })))
    const out = ok(await run(db, 'Döner mit extra Käse und Pommes', describeFn))
    expect(describeFn).toHaveBeenCalledTimes(1)
    expect(describeFn).toHaveBeenCalledWith('Döner mit extra Käse und Pommes', 'English')
    expect(out.source).toBe('ai')
    const d = out.dishes[0]!
    // Not the table's plate of fries, which the name alone would have matched ("pommes").
    expect(d.recipe).toBeNull()
    expect(d.rows.map((r) => r.name)).toEqual(expect.arrayContaining(['Flatbread', 'Döner meat', 'Cheese', 'Fries']))
    expect(d.name).toBe('Döner mit extra Käse und Pommes')
    expect(d.translated).toBe('Döner with extra cheese and fries')
    expect(d.description).toBe('Döner in bread with cheese, and fries on the side')
    // The name still feeds the engine's own allergy and diet rules.
    expect(d.diet.vegetarian).toBe(false)
    expect(d.allergens.map((a) => a.allergen)).toContain('milk')
  })

  it('shows the engine\'s numbers, never a figure from the model\'s words', async () => {
    const db = await freshDb()
    const out = ok(await run(db, 'eggs on toast', async () => read(modelDish({
      name_original: 'Eggs on toast', name_translated: 'Eggs on toast', description_translated: 'Fried eggs on toast, about 450 kcal and 30 g protein',
      components: [comp('Eggs on toast', 'eggs on toast', 100)],
      allergen_hints: [{ allergen: 'eggs', reason: 'two eggs, 120 g' }],
    })), { off: offHit(200) }))
    const d = out.dishes[0]!
    // The amounts go, with their "about"; the words stay.
    expect(d.description).toBe('Fried eggs on toast, and protein')
    expect(d.description).not.toMatch(/\d|kcal/)
    expect(d.allergens.find((a) => a.allergen === 'eggs')?.reason).not.toMatch(/\d/)
    // 200 kcal per 100 g from the food database times the grams: arithmetic, not the "450" the model wrote.
    const row = d.rows[0]!
    expect(row.source.kind).toBe('off')
    expect(d.kcal.mid).toBe(Math.round((row.grams * 200) / 100 / 10) * 10)
    expect(d.kcal.mid).not.toBe(450)
    expect(d.protein.mid).toBe(Math.round((row.grams * 10) / 100))
    // The person's own allergy list is checked like on a scanned menu.
    expect(d.userAllergenHits.map((a) => a.allergen)).toEqual(['eggs'])
  })

  it('keeps the model\'s read, so the same text is not sent twice', async () => {
    const db = await freshDb()
    const describeFn = vi.fn<Describe>(async () => read(EGGS))
    const first = ok(await run(db, '2 eggs and toast with butter', describeFn))
    const again = ok(await run(db, '  2 Eggs and toast, with BUTTER! ', describeFn, { device: 'another-phone-01' }))
    expect(first.source).toBe('ai')
    expect(again.source).toBe('cache')
    expect(describeFn).toHaveBeenCalledTimes(1)
    expect(again.dishes.map((d) => [d.kcal, d.protein, d.rows.length])).toEqual(first.dishes.map((d) => [d.kcal, d.protein, d.rows.length]))
    const rows = cacheRows(db)
    expect(rows).toHaveLength(1)
    // What was typed is kept, never by whom.
    expect(Object.keys(rows[0]!).sort()).toEqual(['hits', 'key', 'lang', 'read', 'ts'])
    expect(rows[0]).toMatchObject({ lang: 'English', hits: 1 })
    expect(JSON.stringify(rows[0])).not.toContain(DEVICE)
    expect(events(db).map((e) => (JSON.parse(e.props) as { source: string }).source)).toEqual(['ai', 'cache'])
  })

  it('asks again for another language: the words of the answer are in the person\'s language', async () => {
    const db = await freshDb()
    const describeFn = vi.fn<Describe>(async () => read(EGGS))
    ok(await run(db, '2 eggs and toast with butter', describeFn))
    ok(await estimateTyped({ db, text: '2 eggs and toast with butter', profile: { ...profile, language: 'German' }, device: DEVICE, team: false, describe: describeFn, off: offHit() }))
    expect(describeFn).toHaveBeenCalledTimes(2)
    expect(describeFn).toHaveBeenLastCalledWith('2 eggs and toast with butter', 'German')
    expect(cacheRows(db)).toHaveLength(2)
  })

  it('says so when the text is not food, and keeps nothing', async () => {
    const db = await freshDb()
    const out = failed(await run(db, 'what is the weather', async () => ({ is_food: false, dishes: [] })))
    expect(out).toMatchObject({ status: 422, code: 'not_food', copy: 'not_food' })
    expect(cacheRows(db)).toHaveLength(0)
    expect(JSON.parse(events(db)[0]!.props)).toMatchObject({ source: 'ai', dishes: 0, outcome: 'not_food' })
  })

  it('says so when the food database has nothing for it, instead of showing zero calories', async () => {
    const db = await freshDb()
    const out = failed(await run(db, 'mystery stew', async () => read(modelDish({ name_original: 'Mystery stew', components: [comp('Mystery stew', 'mystery stew', 300)] })), { off: async () => null }))
    expect(out).toMatchObject({ status: 422, code: 'no_match', copy: 'no_match' })
    expect(cacheRows(db)).toHaveLength(0)
  })

  it('returns only the dishes it has numbers for', async () => {
    const db = await freshDb()
    const out = ok(await run(db, 'rice bowl and a mystery drink', async () => read(
      modelDish({ name_original: 'Rice bowl', components: [comp('Rice bowl', 'rice bowl', 300)] }),
      modelDish({ name_original: 'Mystery drink', course: 'drink', components: [comp('Mystery drink', 'mystery drink', 300, { form: 'liquid' })] }),
    ), { off: async (q) => (q.toLowerCase().includes('rice') ? offHit(150)(q) : null) }))
    expect(out.dishes.map((d) => d.name)).toEqual(['Rice bowl'])
  })
})

describe('what the model may hand to the engine', () => {
  it('is cut to a known shape: four dishes, known words, no price, no made-up weights', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ name_original: `Dish ${i}`, components: [{ name: 'Rice', usda_key: 'rice, white, cooked', form: 'piled', typical_grams: 150, cooking: 'boiled' }] }))
    expect(cleanRead({ is_food: true, dishes: many }, 'x').dishes).toHaveLength(MAX_DISHES)

    const r = cleanRead({
      is_food: true,
      dishes: [{
        name_original: '  Chicken   bowl ', name_translated: '', description_translated: 'x'.repeat(500), price: '9,90 €', course: 'brunch', dish_key: 'not_a_key', portion: 'huge',
        components: [
          { name: 'Chicken', usda_key: '', form: 'cube', typical_grams: '140', cooking: 'smoked' },
          { name: 'No weight', usda_key: 'x', form: 'piled', typical_grams: null, cooking: 'none' },
          { name: '', usda_key: 'x', form: 'piled', typical_grams: 50, cooking: 'none' },
          { name: 'Negative', usda_key: 'x', form: 'piled', typical_grams: -5, cooking: 'none' },
          'not an object',
        ],
        has_meat: 'yes', has_fish: true,
        allergen_hints: [{ allergen: 'soy', reason: 'soy sauce' }, { allergen: 'unicorn', reason: 'x' }, null],
      }, 'nope', null],
    }, 'typed')
    expect(r.is_food).toBe(true)
    expect(r.dishes).toHaveLength(1)
    const d = r.dishes[0]!
    expect(d).toMatchObject({ name_original: 'Chicken bowl', name_translated: 'Chicken bowl', price: null, course: 'main', dish_key: 'none', portion: 'regular', has_meat: false, has_fish: true, has_dairy_or_egg: false })
    expect(d.description_translated).toHaveLength(200)
    expect(d.components).toEqual([{ name: 'Chicken', usda_key: 'chicken', form: 'piled', typical_grams: 140, cooking: 'none' }])
    expect(d.allergen_hints).toEqual([{ allergen: 'soy', reason: 'soy sauce' }])
  })

  it('treats an answer without dishes, or not shaped like one, as "not food"', () => {
    expect(cleanRead({ is_food: true, dishes: [] }, 'x')).toEqual({ is_food: false, dishes: [] })
    expect(cleanRead('{"is_food":true}', 'x')).toEqual({ is_food: false, dishes: [] })
    expect(cleanRead(null, 'x')).toEqual({ is_food: false, dishes: [] })
    expect(cleanRead({ is_food: false, dishes: [{ name_original: 'Soup', components: [] }] }, 'x').is_food).toBe(false)
  })

  it('is asked as a perception device: words and components, never a calorie figure', () => {
    const req = describeRequest('claude-opus-5-5', '2 eggs and toast', 'German')
    expect(req.model).toBe('claude-opus-5-5')
    expect(req.output_config).toMatchObject({ effort: 'low', format: { type: 'json_schema' } })
    expect(req).not.toHaveProperty('thinking')
    expect(describeRequest('claude-sonnet-5-5', 'x y', 'English').thinking).toEqual({ type: 'between_tools' })
    const system = req.system[0]!
    expect(system.cache_control).toEqual({ type: 'ephemeral' })
    expect(system.text).toContain('what a person typed')
    expect(system.text).toContain('You never state calories, macros or health claims')
    expect(system.text).toContain('Write no numbers at all')
    expect(system.text).toContain('doner_kebab: Döner Kebab (bread)')
    // The scan's stand-ins tell the calls apart by this word; a typed meal is neither of them.
    expect(system.text).not.toMatch(/waiter/i)
    expect(req.messages[0]!.content).toBe("User's language: German.\nTyped text:\n2 eggs and toast")
    // The answer has no field a calorie or macro figure could travel in.
    const schema = req.output_config.format.schema as { properties: { dishes: { items: { properties: Record<string, unknown> } } } }
    expect(Object.keys(schema.properties.dishes.items.properties)).toEqual(expect.arrayContaining(['name_original', 'dish_key', 'components', 'allergen_hints']))
    expect(JSON.stringify(schema)).not.toMatch(/kcal|calorie|protein_g|macro/i)
  })
})

describe('limits', () => {
  const fill = (db: Db, n: number, device: string | null, source = 'ai', ts = Date.now()) => {
    const ins = db.raw.prepare('INSERT INTO events (ts, type, device, team, props) VALUES (?, ?, ?, 0, ?)')
    for (let i = 0; i < n; i++) ins.run(ts, 'me_estimate', device, JSON.stringify({ source }))
  }

  it('stops model-backed estimates after 40 a day on one phone, with a plain sentence', async () => {
    const db = await freshDb()
    fill(db, AI_LIMIT.perDevice - 1, DEVICE)
    const describeFn = vi.fn<Describe>(async () => read(EGGS))
    expect(ok(await run(db, 'eggs number one', describeFn)).source).toBe('ai')
    const out = failed(await run(db, 'eggs number two', describeFn))
    expect(out).toMatchObject({ status: 429, code: 'rate_limited', copy: 'slow_down' })
    expect(describeFn).toHaveBeenCalledTimes(1)
    // Another phone is not affected.
    expect(ok(await run(db, 'eggs number two', describeFn, { device: 'another-phone-01' })).source).toBe('ai')
  })

  it('does not count dishes from the table or the cache, and still answers them when the limit is reached', async () => {
    const db = await freshDb()
    const describeFn = vi.fn<Describe>(async () => read(EGGS))
    ok(await run(db, 'scrambled thing', describeFn))
    fill(db, AI_LIMIT.perDevice + 5, DEVICE, 'table')
    fill(db, AI_LIMIT.perDevice + 5, DEVICE, 'cache')
    expect(ok(await run(db, 'another scrambled thing', describeFn)).source).toBe('ai')
    fill(db, AI_LIMIT.perDevice, DEVICE)
    expect(ok(await run(db, 'döner', neverAsked)).source).toBe('table')
    expect(ok(await run(db, 'Scrambled THING', neverAsked)).source).toBe('cache')
    // A table dish inside the text is better than no answer, under the recipe's own name.
    const near = ok(await run(db, 'Döner mit extra Käse', neverAsked))
    expect(near.source).toBe('table')
    expect(near.dishes[0]!.recipe?.key).toBe('doner_kebab')
    expect(near.dishes[0]!.name).toBe(DISH_TABLE.find((d) => d.key === 'doner_kebab')!.label)
    expect(failed(await run(db, 'something new', neverAsked)).status).toBe(429)
  })

  it('forgets calls older than a day, and gives requests without a device one shared bucket', async () => {
    const db = await freshDb()
    fill(db, AI_LIMIT.perDevice + 10, DEVICE, 'ai', Date.now() - AI_LIMIT.windowMs - 60_000)
    expect(ok(await run(db, 'first today', async () => read(EGGS))).source).toBe('ai')

    fill(db, AI_LIMIT.noDevice - 1, null)
    expect(ok(await run(db, 'nameless one', async () => read(EGGS), { device: null })).source).toBe('ai')
    expect(failed(await run(db, 'nameless two', neverAsked, { device: null })).status).toBe(429)
    // A phone with an id is not held back by the shared bucket.
    expect(ok(await run(db, 'nameless two', async () => read(EGGS))).source).toBe('ai')
  })

  it('lets requests sent in the same moment through one by one, never all at once', async () => {
    const db = await freshDb()
    fill(db, AI_LIMIT.perDevice - 3, DEVICE)
    // The model takes a while: every request is under way before the first answer is back.
    const describeFn = vi.fn<Describe>(async () => { await new Promise((r) => setTimeout(r, 20)); return read(EGGS) })
    const outs = await Promise.all(Array.from({ length: 12 }, (_, i) => run(db, `burst meal number ${'abcdefghijkl'[i]}`, describeFn)))
    expect(outs.filter((o) => o.ok).length).toBe(3)
    expect(outs.filter((o) => !o.ok && o.status === 429).length).toBe(9)
    expect(describeFn).toHaveBeenCalledTimes(3)
    // A refused request does not count against the next day's window either.
    const counted = db.raw.prepare("SELECT COUNT(*) c FROM events WHERE type = 'me_estimate' AND json_extract(props,'$.source') = 'ai'").get() as { c: number }
    expect(counted.c).toBe(AI_LIMIT.perDevice)
  })

  it('asks no model when the count cannot be kept', async () => {
    const db = await freshDb()
    db.raw.exec('DROP TABLE events')
    const describeFn = vi.fn<Describe>(async () => read(EGGS))
    expect(failed(await run(db, 'something new', describeFn)).status).toBe(429)
    expect(describeFn).not.toHaveBeenCalled()
    expect(ok(await run(db, 'döner', describeFn)).source).toBe('table')
  })

  it('has one ceiling for all phones together, so many made-up device ids cannot spend without end', async () => {
    const db = await freshDb()
    // Many different "phones", each far under its own limit.
    const ins = db.raw.prepare('INSERT INTO events (ts, type, device, team, props) VALUES (?, ?, ?, 0, ?)')
    for (let i = 0; i < AI_LIMIT.everyone - 1; i++) ins.run(Date.now(), 'me_estimate', `made-up-phone-${i}`, JSON.stringify({ source: 'ai' }))
    expect(ok(await run(db, 'last one today', async () => read(EGGS))).source).toBe('ai')
    expect(failed(await run(db, 'one too many', neverAsked, { device: 'a-brand-new-phone' }))).toMatchObject({ status: 429, code: 'rate_limited' })
    // The recipe table still answers.
    expect(ok(await run(db, 'döner', neverAsked, { device: 'a-brand-new-phone' })).source).toBe('table')
  })
})

describe('when the model cannot be asked', () => {
  const down = (status: number, code: string): Describe => async () => { throw new AiError('service words stay in the log', status, code) }

  it('answers from the table when the text contains one of its dishes', async () => {
    const db = await freshDb()
    const out = ok(await run(db, 'Currywurst mit Pommes, extra scharf', down(503, 'no_key')))
    expect(out.source).toBe('table')
    expect(out.dishes[0]!.recipe?.key).toBe('currywurst_pommes')
    // The numbers are the plain recipe's, so the name says the plain recipe too, not "extra scharf".
    expect(out.dishes[0]!.name).toBe(DISH_TABLE.find((d) => d.key === 'currywurst_pommes')!.label)
    expect(out.dishes[0]!.name).not.toContain('extra scharf')
    expect(events(db).map((e) => JSON.parse(e.props) as Record<string, unknown>)).toMatchObject([{ source: 'ai', outcome: 'error', code: 'no_key' }, { source: 'table', fallback: 'no_key' }])
  })

  it('otherwise fails with the scan\'s status and code, and a sentence for the person', async () => {
    const db = await freshDb()
    expect(failed(await run(db, 'lentil soup', down(503, 'no_key')))).toEqual({ ok: false, status: 503, code: 'no_key', copy: 'setup' })
    expect(failed(await run(db, 'lentil soup', down(502, 'auth')))).toEqual({ ok: false, status: 502, code: 'auth', copy: 'setup' })
    expect(failed(await run(db, 'lentil soup', down(503, 'rate_limited')))).toEqual({ ok: false, status: 503, code: 'rate_limited', copy: 'busy' })
    expect(failed(await run(db, 'lentil soup', down(504, 'connection')))).toEqual({ ok: false, status: 504, code: 'connection', copy: 'connection' })
    expect(failed(await run(db, 'lentil soup', down(502, 'parse')))).toEqual({ ok: false, status: 502, code: 'parse', copy: 'failed' })
    expect(failed(await run(db, 'lentil soup', down(422, 'refusal')))).toEqual({ ok: false, status: 422, code: 'refusal', copy: 'not_food' })
    // A failed call is kept with its code, and it counts as asked: failing on purpose is no way around the limit.
    expect(events(db).map((e) => e.type)).toEqual(Array(6).fill('me_estimate'))
    expect(JSON.parse(events(db)[0]!.props)).toMatchObject({ source: 'ai', outcome: 'error', code: 'no_key', dishes: 0 })
    expect(events(db).every((e) => (JSON.parse(e.props) as { source: string }).source === 'ai')).toBe(true)
  })
})

describe('the sentences', () => {
  const keys = Object.keys(ESTIMATE_COPY.English) as Array<keyof typeof ESTIMATE_COPY.English>

  it('exist in all ten languages, in the app\'s voice: no numbers, no exclamation marks, no em dashes', () => {
    expect(Object.keys(ESTIMATE_COPY).sort()).toEqual(LANGUAGES.map((l) => l.id).sort())
    for (const l of LANGUAGES) {
      for (const k of keys) {
        const s = ESTIMATE_COPY[l.id][k]
        expect(s.length, `${l.id} ${k}`).toBeGreaterThan(8)
        expect(s, `${l.id} ${k}`).not.toMatch(/[!¡—–]|\p{N}/u)
        expect(s.length, `${l.id} ${k}`).toBeLessThan(140)
      }
      // Each language has its own words (nothing left in English by mistake).
      if (l.id !== 'English') for (const k of keys) expect(ESTIMATE_COPY[l.id][k], `${l.id} ${k}`).not.toBe(ESTIMATE_COPY.English[k])
    }
  })

  it('follow the person\'s language, and English when we do not talk theirs', () => {
    expect(sayEstimate('German', 'bad_text')).toBe('Schreib in ein paar Worten, was du gegessen hast.')
    expect(sayEstimate('de-AT', 'not_food')).toBe(ESTIMATE_COPY.German.not_food)
    expect(sayEstimate('Klingon', 'no_match')).toBe(ESTIMATE_COPY.English.no_match)
    expect(sayEstimate(undefined, 'failed')).toBe(ESTIMATE_COPY.English.failed)
    expect(estimateErrorText('French', 'no_key')).toBe(ESTIMATE_COPY.French.setup)
    expect(estimateErrorText('English', 'rate_limited')).toBe(ESTIMATE_COPY.English.busy)
    expect(estimateErrorText('English', 'something_new')).toBe(ESTIMATE_COPY.English.failed)
  })
})

describe('POST /api/me/estimate', () => {
  interface AiRequest { model: string; system: Array<{ text: string }>; messages: Array<{ content: string }>; max_tokens: number; beta: string | null }
  const requests: AiRequest[] = []
  const offQueries: string[] = []
  let reply: (req: AiRequest) => string | Response
  const refuse = (status: number, type: string) => new Response(JSON.stringify({ type: 'error', error: { type, message: 'nope' } }), { status, headers: { 'content-type': 'application/json' } })

  beforeAll(() => {
    vi.stubGlobal('fetch', async (url: unknown, init?: { body?: string; headers?: HeadersInit }) => {
      if (!String(url).includes('/v1/messages')) {
        // Open Food Facts: one product with complete, consistent nutrition.
        offQueries.push(new URL(String(url)).searchParams.get('q') ?? '')
        return new Response(JSON.stringify({ hits: [{ code: '4001', product_name: 'Stand-in product', brands: ['Test'], nutriments: { 'energy-kcal_100g': 150, proteins_100g: 8, carbohydrates_100g: 18, fat_100g: 5 } }] }), { headers: { 'content-type': 'application/json' } })
      }
      const req = { ...(JSON.parse(init!.body!) as AiRequest), beta: new Headers(init!.headers).get('anthropic-beta') }
      requests.push(req)
      const out = reply(req)
      if (out instanceof Response) return out
      // A model that thinks first answers with a thinking block before the text block.
      const content = [{ type: 'thinking', thinking: '', signature: 'c2ln' }, { type: 'text', text: out }]
      return new Response(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: req.model, content, stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }), { headers: { 'content-type': 'application/json' } })
    })
  })
  afterAll(() => vi.unstubAllGlobals())
  beforeEach(() => {
    requests.length = 0
    offQueries.length = 0
    reply = () => JSON.stringify(read(EGGS))
  })

  const call = async (body: unknown, env: Record<string, unknown> = {}, headers: Record<string, string> = {}) => {
    const res = await worker.fetch(
      new Request('http://x/api/me/estimate', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }),
      { DB: await freshDb(), ANTHROPIC_API_KEY: 'test', ...env },
    )
    return { status: res.status, cors: res.headers.get('access-control-allow-origin'), body: (await res.json()) as { dishes?: DishEstimate[]; source?: string; error?: { code: string; message: string } } }
  }
  const english = { goal: 'lose_fat', allergies: [], language: 'English' }

  it('answers a table dish without the AI service, and works with no AI key at all', async () => {
    const r = await call({ text: 'Döner', profile: english, deviceId: DEVICE }, { ANTHROPIC_API_KEY: undefined })
    expect(r.status).toBe(200)
    expect(r.cors).toBe('*')
    expect(r.body.source).toBe('table')
    expect(r.body.dishes).toHaveLength(1)
    expect(r.body.dishes![0]!.kcal.mid).toBeGreaterThan(400)
    expect(requests).toHaveLength(0)
  })

  it('reads a described meal with the reading model and answers with the engine\'s dishes, then from the cache', async () => {
    const db = await freshDb()
    const r = await call({ text: '2 eggs and toast with butter', profile: english, deviceId: DEVICE }, { DB: db, MODEL_READ: 'claude-sonnet-5-5', MODEL_VOICE: 'claude-opus-5-5' })
    expect(r.status).toBe(200)
    expect(r.body.source).toBe('ai')
    // The three components the model named (the engine adds the oil a fried egg soaks up as its own row).
    expect(r.body.dishes![0]!.rows.map((x) => x.name)).toEqual(expect.arrayContaining(['Fried eggs', 'Toast', 'Butter']))
    expect(r.body.dishes![0]!.kcal.mid).toBeGreaterThan(0)
    expect(requests).toHaveLength(1)
    expect(requests[0]!.model).toBe('claude-sonnet-5-5')
    expect(requests[0]!.system[0]!.text).toContain('what a person typed')
    expect(requests[0]!.messages[0]!.content).toContain('2 eggs and toast with butter')
    expect(requests[0]!.beta).toContain('server-side-fallback')
    expect(JSON.parse(events(db)[0]!.props)).toMatchObject({ source: 'ai', outcome: 'ok', readModel: 'claude-sonnet-5-5' })

    const again = await call({ text: '2 eggs and toast with butter', profile: english, deviceId: DEVICE }, { DB: db })
    expect(again.body.source).toBe('cache')
    expect(requests).toHaveLength(1)
  })

  it('sends a request the service turns down once more on the proven model', async () => {
    reply = (req) => (req.model === PROVEN_MODEL ? JSON.stringify(read(EGGS)) : refuse(400, 'invalid_request_error'))
    const db = await freshDb()
    const r = await call({ text: 'two eggs on toast', profile: english, deviceId: DEVICE }, { DB: db, MODEL_READ: 'claude-opus-5-5' })
    expect(r.status).toBe(200)
    expect(requests.map((q) => q.model)).toEqual(['claude-opus-5-5', PROVEN_MODEL])
    expect(JSON.parse(events(db)[0]!.props)).toMatchObject({ readModel: PROVEN_MODEL })
  })

  it('speaks the person\'s language: the saved one first, then the phone\'s', async () => {
    const german = await call({ text: '', profile: { ...english, language: 'German' }, locale: 'fr-FR' })
    expect(german).toMatchObject({ status: 400, body: { error: { code: 'bad_text', message: ESTIMATE_COPY.German.bad_text } } })
    const french = await call({ text: 'x', profile: { goal: 'balanced', allergies: [] }, locale: 'fr-FR' })
    expect(french.body.error).toEqual({ code: 'bad_text', message: ESTIMATE_COPY.French.bad_text })
    const header = await call({ text: 'x', profile: { goal: 'balanced', allergies: [] } }, {}, { 'x-lang': 'it-IT' })
    expect(header.body.error?.message).toBe(ESTIMATE_COPY.Italian.bad_text)

    reply = () => JSON.stringify({ is_food: false, dishes: [] })
    const notFood = await call({ text: 'wie wird das wetter', profile: { ...english, language: 'German' }, deviceId: DEVICE })
    expect(notFood).toMatchObject({ status: 422, body: { error: { code: 'not_food', message: ESTIMATE_COPY.German.not_food } } })
  })

  it('maps a failing AI service like a scan does, and says it in plain words', async () => {
    const noKey = await call({ text: 'lentil soup', profile: english, deviceId: DEVICE }, { ANTHROPIC_API_KEY: undefined })
    expect(noKey).toMatchObject({ status: 503, body: { error: { code: 'no_key', message: ESTIMATE_COPY.English.setup } } })
    reply = () => refuse(401, 'authentication_error')
    const auth = await call({ text: 'lentil soup', profile: english, deviceId: DEVICE })
    expect(auth).toMatchObject({ status: 502, body: { error: { code: 'auth', message: ESTIMATE_COPY.English.setup } } })
    reply = () => 'this is not JSON'
    const parse = await call({ text: 'lentil soup', profile: { ...english, language: 'Spanish' }, deviceId: DEVICE })
    expect(parse).toMatchObject({ status: 502, body: { error: { code: 'parse', message: ESTIMATE_COPY.Spanish.failed } } })
  })

  it('turns down a body that is not JSON, and a missing profile', async () => {
    expect(await call('nope')).toMatchObject({ status: 400, body: { error: { code: 'bad_json' } } })
    expect(await call('[1,2]')).toMatchObject({ status: 400, body: { error: { code: 'bad_json' } } })
    expect(await call({ text: 'döner' })).toMatchObject({ status: 400, body: { error: { code: 'bad_profile' } } })
    expect(await call({ text: 'döner', profile: { goal: 'win' } })).toMatchObject({ status: 400, body: { error: { code: 'bad_profile' } } })
    expect(requests).toHaveLength(0)
  })

  it('creates its cache table itself, and leaves other /api/me paths to the Worker\'s 404', async () => {
    const db = memoryD1() // no events table, no migration: a bare database
    const r = await call({ text: '2 eggs and toast with butter', profile: english, deviceId: DEVICE }, { DB: db })
    expect(r.status).toBe(200)
    expect(cacheRows(db as Db)).toHaveLength(1)

    const other = await worker.fetch(new Request('http://x/api/me/nothing', { method: 'POST', body: '{}' }), { DB: memoryD1(), ANTHROPIC_API_KEY: 'test' })
    expect(other.status).toBe(404)
    const get = await worker.fetch(new Request('http://x/api/me/estimate'), { DB: memoryD1(), ANTHROPIC_API_KEY: 'test' })
    expect(get.status).toBe(404)
  })
})

describe.skipIf(!HAVE_DB)('typed meals on the real USDA corpus', () => {
  let corpus: DbAdapter
  let lookup: FoodLookup
  beforeAll(() => {
    corpus = openNodeDb(CORPUS, { readonly: true })
  })
  beforeEach(() => {
    lookup = new FoodLookup((queries) => Promise.all(queries.map((q) => corpus.all(q.sql, q.params))))
  })
  afterAll(async () => corpus.close())

  it('"döner" is the table\'s Döner with a believable range', async () => {
    const out = ok(await estimateTyped({ db: await freshDb(), text: 'döner', profile, device: DEVICE, team: false, describe: neverAsked, lookup }))
    const d = out.dishes[0]!
    expect(out.source).toBe('table')
    expect(d.kcal.low).toBeGreaterThanOrEqual(450)
    expect(d.kcal.high).toBeLessThanOrEqual(1050)
    expect(d.protein.mid).toBeGreaterThanOrEqual(25)
    expect(d.rows.every((r) => r.counted)).toBe(true)
  })

  it('a described breakfast gets USDA rows and a believable range, the same from the cache', async () => {
    const db = await freshDb()
    const describeFn = vi.fn<Describe>(async () => read(EGGS))
    const first = ok(await estimateTyped({ db, text: '2 eggs and toast with butter', profile, device: DEVICE, team: false, describe: describeFn, lookup }))
    const d = first.dishes[0]!
    expect(first.source).toBe('ai')
    expect(d.rows.map((r) => r.source.kind)).toEqual(['usda', 'usda', 'usda'])
    expect(d.rows.map((r) => (r.source.kind === 'usda' ? r.source.name : ''))).toEqual(['Egg, whole, cooked, fried', 'Bread, white, commercially prepared, toasted', 'Butter, salted'])
    // Two fried eggs, two slices of toast and a little butter: roughly 350 to 550 kcal.
    expect(d.kcal.low).toBeGreaterThanOrEqual(250)
    expect(d.kcal.high).toBeLessThanOrEqual(700)
    expect(d.kcal.mid).toBeGreaterThanOrEqual(350)
    expect(d.kcal.mid).toBeLessThanOrEqual(550)
    expect(d.protein.mid).toBeGreaterThanOrEqual(12)
    expect(d.userAllergenHits.map((a) => a.allergen)).toEqual(['eggs'])

    const again = ok(await estimateTyped({ db, text: '2 eggs and toast with butter', profile, device: DEVICE, team: false, describe: describeFn, lookup }))
    expect(again.source).toBe('cache')
    expect(again.dishes[0]!.kcal).toEqual(d.kcal)
    expect(describeFn).toHaveBeenCalledTimes(1)
  })

  it('a text that contains a table dish is estimated from what the model read, not from the table', async () => {
    const out = ok(await estimateTyped({
      db: await freshDb(), text: 'chicken salad with avocado', profile, device: DEVICE, team: false, lookup,
      describe: async () => read(modelDish({
        name_original: 'Chicken salad with avocado', name_translated: 'Chicken salad with avocado', description_translated: 'Grilled chicken on leaves with avocado',
        components: [comp('Grilled chicken breast', 'chicken, breast, roasted', 140, { cooking: 'grilled' }), comp('Mixed salad leaves', 'lettuce, green leaf, raw', 100, { cooking: 'raw' }), comp('Avocado', 'avocados, raw', 80, { cooking: 'raw' })],
        has_meat: true,
      })),
    }))
    const d = out.dishes[0]!
    expect(d.recipe).toBeNull()
    expect(d.rows.map((r) => r.name)).toContain('Avocado')
    expect(d.name).toBe('Chicken salad with avocado')
    expect(d.kcal.mid).toBeGreaterThan(200)
    expect(d.kcal.mid).toBeLessThan(600)
  })
})
