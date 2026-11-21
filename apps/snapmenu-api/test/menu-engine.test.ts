import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openNodeDb } from '@nutai/db-adapter/node'
import type { DbAdapter } from '@nutai/db-adapter'
import type { FoodDb } from '@nutai/gram-engine'
import { DISH_TABLE, matchDish } from '../src/dishes.js'
import { estimateDish, loadFoodDb, plausibleRow } from '../src/menu-engine.js'
import type { ModelDish, Profile } from '../src/types.js'

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
  let foodDb: FoodDb
  beforeAll(async () => {
    db = openNodeDb(DB, { readonly: true })
    foodDb = await loadFoodDb(db)
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
      const est = await estimateDish(model({ name_original: d.label, dish_key: d.key }), i, { db, foodDb }, profile)
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
    const doener = await estimateDish(model({ name_original: 'Döner Kebab im Brot', dish_key: 'doner_kebab', has_meat: true }), 0, { db, foodDb }, profile)
    expect(doener.kcal.mid).toBeGreaterThan(600)
    expect(doener.kcal.mid).toBeLessThan(900)
    expect(doener.protein.mid).toBeGreaterThan(25)
    expect(doener.rows.some((r) => r.source.kind === 'usda')).toBe(true)
    expect(doener.rows.find((r) => r.name.includes('sauce'))?.source.kind).toBe('snapmenu_estimate')

    const pho = await estimateDish(model({ name_original: 'Phở bò', dish_key: 'pho_bo' }), 1, { db, foodDb }, profile)
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
      2, { db, foodDb }, profile,
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
      3, { db, foodDb }, profile,
    )
    expect(est.rows[0]!.grams).toBeLessThan(3000)
  })

  it('a user allergy shows up as a hit with its reason', async () => {
    const est = await estimateDish(model({ name_original: 'Falafel Teller', dish_key: 'falafel_teller' }), 4, { db, foodDb }, profile)
    expect(est.userAllergenHits.map((h) => h.allergen)).toContain('sesame')
    expect(est.diet.vegan).toBe(true)
  })
})
