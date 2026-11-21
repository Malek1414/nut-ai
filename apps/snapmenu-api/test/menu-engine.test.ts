import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openNodeDb } from '@nutai/db-adapter/node'
import type { DbAdapter } from '@nutai/db-adapter'
import { loadFood, matchLadder, resolveByText } from '@nutai/resolver'
import { readFileSync } from 'node:fs'
import { DISH_TABLE, matchDish } from '../src/dishes.js'
import { clearFoodCaches, FOOD_BY_NAME_SQL, FOOD_BY_PREFIX_SQL, FoodLookup, type Query } from '../src/food-lookup.js'
import { estimateDish, plausibleRow, resolveFoodByKey, type EngineDeps } from '../src/menu-engine.js'
import { RECIPE_FOODS } from '../src/recipe-foods.generated.js'
import type { MenuRead, ModelDish, Profile } from '../src/types.js'

const DB = fileURLToPath(new URL('../data/nutrition.db', import.meta.url))
const HAVE_DB = existsSync(DB)

const profile: Profile = { goal: 'lose_fat', allergies: ['sesame'], language: 'English' }
const model = (over: Partial<ModelDish>): ModelDish => ({
  name_original: 'x', name_translated: 'x', description_translated: '', price: null, course: 'main', dish_key: 'none',
  portion: 'regular', components: [], has_meat: false, has_fish: false, has_dairy_or_egg: false, allergen_hints: [], ...over,
})

describe('dish table matching', () => {
  it('matches menu spellings to the right recipe', () => {
    expect(matchDish('Döner Kebab im Brot')?.key).toBe('doner_kebab')
    expect(matchDish('Hähnchen Döner')?.key).toBe('chicken_doner')
    expect(matchDish('Döner Teller mit Pommes')?.key).toBe('doner_teller')
    expect(matchDish('Currywurst mit Pommes')?.key).toBe('currywurst_pommes')
    expect(matchDish('Phở bò tái')?.key).toBe('pho_bo')
    expect(matchDish('Adana Kebab Teller')).toBeNull()
  })
  it('rejects branded chain and baby food rows', () => {
    expect(plausibleRow("APPLEBEE'S, mozzarella sticks")).toBe(false)
    expect(plausibleRow('Babyfood, vegetables, mix vegetables junior')).toBe(false)
    expect(plausibleRow('Chicken, broilers or fryers, breast, meat only, cooked, roasted')).toBe(true)
  })
})

describe.skipIf(!HAVE_DB)('menu engine on the real USDA corpus', () => {
  let db: DbAdapter
  let deps: EngineDeps
  let batches: Query[][]
  beforeAll(async () => {
    db = openNodeDb(DB, { readonly: true })
    batches = []
    deps = { lookup: new FoodLookup((queries) => { batches.push(queries); return Promise.all(queries.map((q) => db.all(q.sql, q.params))) }) }
  })
  afterAll(async () => db.close())

  it('every pinned USDA description in the dish table exists in the corpus', async () => {
    for (const d of DISH_TABLE) {
      for (const c of d.components) {
        if (!c.usda) continue
        const row = await db.get<{ id: number }>('SELECT id FROM foods WHERE name = ?', [c.usda])
        expect(row, `${d.key}: ${c.usda}`).not.toBeNull()
      }
    }
  })

  it('every table dish produces a believable calorie range', async () => {
    for (const [i, d] of DISH_TABLE.entries()) {
      const est = await estimateDish(model({ name_original: d.label, dish_key: d.key }), i, deps, profile)
      expect(est.rows.every((r) => r.counted), d.key).toBe(true)
      expect(est.kcal.low, d.key).toBeLessThan(est.kcal.mid)
      expect(est.kcal.high, d.key).toBeGreaterThan(est.kcal.mid)
      if (d.key !== 'ayran') {
        expect(est.kcal.mid, d.key).toBeGreaterThan(150)
        expect(est.kcal.mid, d.key).toBeLessThan(1500)
      }
    }
  })

  it('Döner and Pho land in believable ranges, with USDA sources', async () => {
    const doener = await estimateDish(model({ name_original: 'Döner Kebab im Brot', dish_key: 'doner_kebab', has_meat: true }), 0, deps, profile)
    expect(doener.kcal.mid).toBeGreaterThan(600)
    expect(doener.kcal.mid).toBeLessThan(900)
    expect(doener.protein.mid).toBeGreaterThan(25)
    expect(doener.rows.some((r) => r.source.kind === 'usda')).toBe(true)
    expect(doener.rows.find((r) => r.name.includes('sauce'))?.source.kind).toBe('snapmenu_estimate')

    const pho = await estimateDish(model({ name_original: 'Phở bò', dish_key: 'pho_bo' }), 1, deps, profile)
    expect(pho.kcal.mid).toBeGreaterThan(350)
    expect(pho.kcal.mid).toBeLessThan(700)
    expect(pho.allergens.map((a) => a.allergen)).not.toContain('gluten')
  })

  it('a dish without a recipe goes through the gram engine and resolver, never the model\'s calories', async () => {
    const est = await estimateDish(
      model({
        name_original: 'Pollo alla Griglia', has_meat: true,
        components: [
          { name: 'Grilled chicken breast', usda_key: 'chicken, breast, roasted', form: 'flat', size: 'medium', typical_grams: 200, cooking: 'grilled' },
          { name: 'Grilled vegetables', usda_key: 'peppers, sweet, red, raw', form: 'piled', size: 'medium', typical_grams: 150, cooking: 'grilled' },
        ],
      }),
      2, deps, profile,
    )
    const chicken = est.rows[0]!
    expect(chicken.source.kind).toBe('usda')
    expect(chicken.gramPathway).toBe('model_guess')
    expect(chicken.bandHalfPct).toBeGreaterThanOrEqual(0.3)
    expect(est.kcal.mid).toBeGreaterThan(300)
    expect(est.kcal.mid).toBeLessThan(700)
  })

  it('the sanity clamp catches an absurd gram guess', async () => {
    const est = await estimateDish(
      model({ name_original: 'Weird', components: [{ name: 'Rice', usda_key: 'rice, white, cooked', form: 'piled', size: 'medium', typical_grams: 90000, cooking: 'boiled' }] }),
      3, deps, profile,
    )
    expect(est.rows[0]!.grams).toBeLessThan(3000)
  })

  it('a user allergy shows up as a hit with its reason', async () => {
    const est = await estimateDish(model({ name_original: 'Falafel Teller', dish_key: 'falafel_teller' }), 4, deps, profile)
    expect(est.userAllergenHits.map((h) => h.allergen)).toContain('sesame')
    expect(est.diet.vegan).toBe(true)
  })

  it('the bundled recipe rows are the rows in the corpus', async () => {
    const pins = new Set(DISH_TABLE.flatMap((d) => d.components.map((c) => c.usda).filter((u): u is string => Boolean(u))))
    expect(Object.keys(RECIPE_FOODS).sort()).toEqual([...pins].sort())
    for (const [pin, row] of Object.entries(RECIPE_FOODS)) {
      // The statements the scan used before the bundle existed.
      const id = await db.get<{ id: number }>(pin.endsWith('%') ? 'SELECT id FROM foods WHERE name LIKE ? ORDER BY length(name) LIMIT 1' : 'SELECT id FROM foods WHERE name = ? LIMIT 1', [pin])
      const live = await loadFood(db, String(id!.id))
      const src = await db.get<{ source_id: string | null }>('SELECT source_id FROM foods WHERE id = ?', [id!.id])
      expect({ ...row }, pin).toEqual({
        foodId: live!.foodId, name: live!.name, energyKcal: live!.energyKcal, proteinG: live!.proteinG, fatG: live!.fatG, carbG: live!.carbG,
        fiberG: live!.fiberG, sugarG: live!.sugarG, sodiumMg: live!.sodiumMg, source: live!.source, sourceId: src!.source_id,
      })
      // A pin that is not bundled yet falls back to this query: it must name the same row.
      const fallback = await db.get<{ foodId: number }>(pin.endsWith('%') ? FOOD_BY_PREFIX_SQL : FOOD_BY_NAME_SQL, [pin])
      expect(String(fallback!.foodId), pin).toBe(row.foodId)
    }
  })

  it('a recipe dish reads no database at all', async () => {
    batches.length = 0
    await estimateDish(model({ name_original: 'Spaghetti alla Carbonara', dish_key: 'carbonara' }), 0, deps, profile)
    expect(batches).toEqual([])
  })

  it('the batched lookup picks the same row as the resolver package, for every component of a 24-dish menu', async () => {
    const read = JSON.parse(readFileSync(new URL('./fixtures/menu-read-24.json', import.meta.url), 'utf8')) as MenuRead
    const components = read.dishes.flatMap((d) => d.components)
    expect(components.length).toBeGreaterThan(50)
    for (const c of components) {
      // The original path: resolveByText, no OR rung, top candidate, loadFood.
      const r = await resolveByText(db, { canonicalFoodKey: c.usda_key, observedBrand: null, prepFacet: null, modelCategory: null, estimatedGrams: c.typical_grams })
      const orRung = r.ladderStep >= 1 && r.outcome.kind !== 'miss' && /\bOR\b/.test(matchLadder(c.usda_key)[r.ladderStep] ?? '')
      const id = orRung ? null : r.outcome.kind === 'auto_accept' ? r.outcome.match.foodId : r.outcome.kind === 'disambiguate' ? r.outcome.candidates[0]!.foodId : null
      const expected = id ? await loadFood(db, id) : null
      const got = await resolveFoodByKey(deps.lookup, c.usda_key, c.typical_grams)
      expect(got?.foodId ?? null, c.usda_key).toBe(expected?.foodId ?? null)
      expect(got?.name ?? null, c.usda_key).toBe(expected?.name ?? null)
      expect(got?.energyKcal ?? null, c.usda_key).toBe(expected?.energyKcal ?? null)
    }
  })

  it('a whole menu costs a handful of database round trips, and none when the isolate is warm', async () => {
    const read = JSON.parse(readFileSync(new URL('./fixtures/menu-read-24.json', import.meta.url), 'utf8')) as MenuRead
    clearFoodCaches()
    batches.length = 0
    const cold = new FoodLookup((queries) => { batches.push(queries); return Promise.all(queries.map((q) => db.all(q.sql, q.params))) })
    const first = await Promise.all(read.dishes.map((d, i) => estimateDish(d, i, { lookup: cold }, profile)))
    expect(first.every((d) => d.kcal.mid > 0)).toBe(true)
    expect(batches.length).toBeLessThanOrEqual(8)
    expect(cold.stats.queries).toBeLessThan(120) // was about 340 single queries

    batches.length = 0
    const again = await Promise.all(read.dishes.map((d, i) => estimateDish(d, i, { lookup: cold }, profile)))
    expect(batches).toEqual([])
    expect(again).toEqual(first)
  })
})
