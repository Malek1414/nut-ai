import { describe, expect, it } from 'vitest'
import { goalScore, rankDishes } from '../src/ranking.js'
import type { DishEstimate, Profile } from '../src/types.js'

type D = Omit<DishEstimate, 'score' | 'why'>
const r = (mid: number) => ({ low: mid * 0.8, high: mid * 1.2, mid })

function dish(id: string, kcal: number, p: number, c: number, f: number, extra: Partial<D> = {}): D {
  return {
    id, name: id, translated: id, description: '', price: null, course: 'main', recipe: null,
    rows: [{ id: `${id}-0`, name: 'x', grams: 100, gramSource: '', gramPathway: 'model_guess', per100: { kcal, protein_g: p, carbs_g: c, fat_g: f, fiber_g: 0, sugar_g: null, sodium_mg: null }, source: { kind: 'none', note: '' }, bandHalfPct: 0.3, counted: true, isEstimate: false, hiddenFat: false }],
    kcal: r(kcal), protein: r(p), carbs: r(c), fat: r(f), fiber: 3,
    bandHalfPct: 0.2, bandTier: 'moderate', bandReasons: [],
    diet: { vegetarian: false, vegan: false, reason: 'contains meat' },
    allergens: [], userAllergenHits: [],
    ...extra,
  }
}

const P = (goal: Profile['goal'], extra: Partial<Profile> = {}): Profile => ({ goal, allergies: [], language: 'English', ...extra })

const salad = dish('chicken_salad', 380, 43, 10, 15)
const doener = dish('doener', 750, 41, 60, 34)
const currywurst = dish('currywurst_pommes', 1100, 24, 90, 75)
const pasta = dish('arrabbiata', 570, 17, 95, 12, { diet: { vegetarian: true, vegan: true, reason: null } })
const falafel = dish('falafel', 900, 32, 80, 49, {
  diet: { vegetarian: true, vegan: true, reason: null },
  allergens: [{ allergen: 'sesame', label: 'sesame', reason: 'tahini', source: 'component' }],
  userAllergenHits: [{ allergen: 'sesame', label: 'sesame', reason: 'tahini', source: 'component' }],
})

describe('goal ranking', () => {
  it('lose fat puts the lean high-protein salad first and the currywurst last', () => {
    const { top, avoid } = rankDishes([currywurst, doener, salad, pasta], P('lose_fat'))
    expect(top[0]).toBe('chicken_salad')
    expect(top).not.toContain('currywurst_pommes')
    expect(avoid.find((a) => a.dishId === 'currywurst_pommes')?.reasons.join(' ')).toMatch(/kcal|fat/)
  })

  it('build muscle prefers absolute protein over the lowest calories', () => {
    const big = dish('lasagne', 850, 52, 70, 40)
    const { top } = rankDishes([pasta, salad, big], P('build_muscle'))
    expect(top[0]).toBe('lasagne')
    expect(top.indexOf('arrabbiata')).toBe(2)
  })

  it('balanced prefers a meal near 25/45/30 over a fat-heavy one', () => {
    const balanced = dish('bowl', 620, 38, 70, 20)
    expect(goalScore(balanced as D, P('balanced')).score).toBeGreaterThan(goalScore(currywurst as D, P('balanced')).score)
  })

  it('plant-based vegan never recommends meat and lists it to avoid with the reason', () => {
    const { top, avoid } = rankDishes([salad, doener, pasta], P('plant_based', { plantStyle: 'vegan' }))
    expect(top).toEqual(['arrabbiata'])
    expect(avoid.find((a) => a.dishId === 'doener')?.reasons[0]).toMatch(/Not vegan/)
  })

  it('a dish with the user\'s allergen is never in the top 3 and is in avoid with "likely has"', () => {
    const { top, avoid } = rankDishes([falafel, pasta, salad], P('balanced', { allergies: ['sesame'] }))
    expect(top).not.toContain('falafel')
    expect(avoid.find((a) => a.dishId === 'falafel')?.reasons[0]).toBe('Likely has sesame in it: tahini.')
  })

  it('drinks and desserts never reach the top 3', () => {
    const drink = dish('cola', 200, 0, 50, 0, { course: 'drink' })
    const dessert = dish('tiramisu', 420, 8, 40, 26, { course: 'dessert' })
    const { top } = rankDishes([drink, dessert, salad], P('lose_fat'))
    expect(top).toEqual(['chicken_salad'])
  })
})
