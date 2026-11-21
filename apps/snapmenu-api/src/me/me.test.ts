import { describe, expect, it } from 'vitest'
import { computeCalorieTarget, computeMacros } from '../../../../packages/goals/src/index.js'
import { mealBand, bandTier } from '@nutai/confidence'
import { fitScore } from '../places.js'
import { rankDishes } from '../ranking.js'
import type { DishEstimate, DishLite, MenuResult, Profile, Range } from '../types.js'
import { LANGUAGES } from '../voice/index.js'
import { ME_COPY, sayMe, type MeKey } from './copy.js'
import { dayKey, eatenOf, entriesOf, mealsLeft, pruneLog, remainingOf } from './day.js'
import { halfOf, mealTotals, portionOf, rangeAround } from './meal.js'
import { personalize, readDay, suggest, type Candidate } from './rank.js'
import { fitOf, snapKey, snapOfDish, snapOfLite } from './snap.js'
import { cleanWord, firstHit, likesCuisine, readTaste } from './taste.js'
import { defaultTargets, KCAL_MIN, macroKcal, readTargets, setKcal, setMacro, validBody } from './targets.js'
import { NO_TASTE, type DishSnap, type LogEntry } from './types.js'

const rng = (mid: number, half = 0.2, round = 1): Range => rangeAround(mid, half, round)

function dish(over: Partial<DishEstimate> & { id: string; name: string }, n: { kcal: number; p: number; c: number; f: number }, half = 0.2): Omit<DishEstimate, 'score' | 'why'> {
  return {
    translated: over.name, description: '', price: null, course: 'main', recipe: null,
    rows: [{ id: `${over.id}-c0`, name: 'Something', grams: 100, gramSource: '', gramPathway: 'model_guess', per100: { kcal: 100, protein_g: 1, carbs_g: 1, fat_g: 1, fiber_g: null, sugar_g: null, sodium_mg: null }, source: { kind: 'none', note: '' }, bandHalfPct: half, counted: true, isEstimate: false, hiddenFat: false }],
    kcal: rng(n.kcal, half, 10), protein: rng(n.p, half), carbs: rng(n.c, half), fat: rng(n.f, half), fiber: 4,
    bandHalfPct: half, bandTier: 'moderate', bandReasons: [], diet: { vegetarian: false, vegan: false, reason: null }, allergens: [], userAllergenHits: [],
    ...over,
  }
}

const profile: Profile = { goal: 'lose_fat', allergies: [], language: 'English' }

function menu(p: Profile = profile): MenuResult {
  const input = [
    dish({ id: 'd0', name: 'Grilled chicken salad', description: 'Chicken breast, leaves, tomato' }, { kcal: 420, p: 42, c: 18, f: 18 }),
    dish({ id: 'd1', name: 'Spaghetti Carbonara', description: 'Pasta, egg, guanciale' }, { kcal: 880, p: 34, c: 96, f: 38 }),
    dish({ id: 'd2', name: 'Tagliata di manzo', description: 'Sliced beef, rocket, parmesan' }, { kcal: 620, p: 52, c: 6, f: 40 }),
    dish({ id: 'd3', name: 'Risotto ai funghi', description: 'Rice with porcini mushrooms' }, { kcal: 560, p: 14, c: 82, f: 18 }),
    dish({ id: 'd4', name: 'Branzino al forno', description: 'Baked sea bass with potatoes', allergens: [{ allergen: 'fish', label: 'fish', reason: 'sea bass', source: 'rule' }] }, { kcal: 480, p: 40, c: 30, f: 20 }),
  ]
  const ranking = rankDishes(input, p)
  return {
    scanId: 's1', restaurant: 'Trattoria Test', menuLanguage: 'Italian', cuisine: 'Italian', profile: p, dishes: ranking.dishes, top: ranking.top, avoid: ranking.avoid,
    tips: ranking.top.slice(0, 1).map((dishId) => ({ dishId, local: 'Senza olio, per favore.', translated: 'Without oil, please.', why: 'Lean and filling.' })), notes: [], timings: {},
  }
}

describe('copy', () => {
  const keys = Object.keys(ME_COPY.English) as MeKey[]
  it('has every sentence in every language of the app', () => {
    for (const l of LANGUAGES) {
      expect(Object.keys(ME_COPY[l.id]).sort(), l.id).toEqual([...keys].sort())
      for (const k of keys) expect(ME_COPY[l.id][k].length, `${l.id} ${k}`).toBeGreaterThan(3)
    }
  })
  it('types no number, keeps the placeholders and follows the voice rules', () => {
    for (const l of LANGUAGES) {
      for (const k of keys) {
        const s = ME_COPY[l.id][k]
        expect(/\p{N}/u.test(s), `${l.id} ${k} has a digit`).toBe(false)
        expect(/[!—–]/.test(s), `${l.id} ${k} has ! or a dash`).toBe(false)
        expect((s.match(/\{\w+\}/g) ?? []).sort(), `${l.id} ${k}`).toEqual((ME_COPY.English[k].match(/\{\w+\}/g) ?? []).sort())
      }
    }
  })
  it('fills a number the way the screen writes it, and falls back to English', () => {
    expect(sayMe('English', 'day.fits', { kcal: 1240 })).toBe('Fits the 1,240 calories you have left today.')
    expect(sayMe('German', 'day.over', { kcal: 300 })).toContain('300 Kalorien')
    expect(sayMe('Klingon', 'taste.like', { thing: 'Tofu' })).toBe('Has Tofu, which you like.')
  })
})

describe('targets', () => {
  it('gives every goal a default whose macros add up to its calories', () => {
    for (const goal of ['lose_fat', 'build_muscle', 'balanced', 'plant_based'] as const) {
      const t = defaultTargets(goal)
      expect(t.custom).toBe(false)
      expect(Math.abs(macroKcal(t) - t.kcal) / t.kcal, goal).toBeLessThan(0.03)
      expect(t.kcal % 50).toBe(0)
      expect(t.protein % 5 + t.carbs % 5 + t.fat % 5).toBe(0)
    }
    expect(defaultTargets('lose_fat').kcal).toBeLessThan(defaultTargets('balanced').kcal)
    expect(defaultTargets('build_muscle').kcal).toBeGreaterThan(defaultTargets('balanced').kcal)
    expect(defaultTargets('lose_fat').protein / defaultTargets('lose_fat').kcal).toBeGreaterThan(defaultTargets('balanced').protein / defaultTargets('balanced').kcal)
  })
  it('uses the goals engine when body details are given', () => {
    const body = { sex: 'female' as const, weightKg: 62, heightCm: 168, ageYears: 29, activity: 'light' as const }
    const engine = computeCalorieTarget({ ...body, goal: 'lose', rateLbPerWeek: 1 })
    const t = defaultTargets('lose_fat', body)
    expect(Math.abs(t.kcal - engine.target)).toBeLessThanOrEqual(25)
    expect(Math.abs(t.protein - computeMacros(t.kcal, 62, 'lose').protein_g)).toBeLessThanOrEqual(2.5)
    // A small person on a cut hits the engine's floor, never less.
    const small = defaultTargets('lose_fat', { sex: 'female', weightKg: 45, heightCm: 150, ageYears: 60, activity: 'sedentary' })
    expect(small.kcal).toBeGreaterThanOrEqual(KCAL_MIN)
  })
  it('moves the macros with the calories and keeps their split', () => {
    const t = defaultTargets('balanced')
    const up = setKcal(t, 2500)
    expect(up.kcal).toBe(2500)
    expect(up.custom).toBe(true)
    expect(up.protein / up.kcal).toBeCloseTo(t.protein / t.kcal, 2)
    expect(Math.abs(macroKcal(up) - 2500) / 2500).toBeLessThan(0.03)
  })
  it('never goes below the floor or above the ceiling, and steps cleanly', () => {
    expect(setKcal(defaultTargets('lose_fat'), 300).kcal).toBe(KCAL_MIN)
    expect(setKcal(defaultTargets('lose_fat'), 99999).kcal).toBe(4500)
    expect(setMacro(defaultTargets('lose_fat'), 'protein', -20).protein).toBe(0)
    expect(setMacro(defaultTargets('lose_fat'), 'protein', 152).protein).toBe(150)
    expect(setMacro(defaultTargets('lose_fat'), 'fat', 61).carbs).toBe(defaultTargets('lose_fat').carbs)
  })
  it('reads saved targets only when they are the person\'s own and sane', () => {
    expect(readTargets(null, 'balanced')).toEqual(defaultTargets('balanced'))
    expect(readTargets({ kcal: 1800, protein: 140, carbs: 160, fat: 60, custom: false }, 'balanced')).toEqual(defaultTargets('balanced'))
    expect(readTargets({ kcal: 1800, protein: 140, carbs: 160, fat: 60, custom: true }, 'balanced')).toEqual({ kcal: 1800, protein: 140, carbs: 160, fat: 60, custom: true })
    expect(readTargets({ kcal: 'lots', custom: true }, 'lose_fat')).toEqual(defaultTargets('lose_fat'))
    expect(readTargets({ kcal: 10, protein: 9999, carbs: 100, fat: 50, custom: true }, 'lose_fat')).toMatchObject({ kcal: KCAL_MIN, protein: 350 })
  })
  it('accepts only plausible adult body details', () => {
    expect(validBody({ sex: 'male', weightKg: 80, heightCm: 180, ageYears: 30, activity: 'moderate' })).toMatchObject({ sex: 'male', activity: 'moderate' })
    expect(validBody({ weightKg: 80, heightCm: 180, ageYears: 30 })).toMatchObject({ sex: 'unspecified', activity: 'light' })
    expect(validBody({ weightKg: 8, heightCm: 180, ageYears: 30 })).toBeNull()
    expect(validBody({ weightKg: 80, heightCm: 180, ageYears: 12 })).toBeNull()
    expect(validBody('x')).toBeNull()
  })
})

const snap = (name: string, n: { kcal: number; p: number; c: number; f: number }, over: Partial<DishSnap> = {}, half = 0.2): DishSnap => ({
  key: snapKey(name, over.place ?? null), name, translated: null, place: null, from: 'scan', why: 'Good protein for the calories.', fit: 60, words: name,
  vegetarian: false, vegan: false, allergens: [], kcal: rng(n.kcal, half, 10), protein: rng(n.p, half), carbs: rng(n.c, half), fat: rng(n.f, half), half, ...over,
})

describe('meal totals', () => {
  it('adds the middles and takes the width of the range from the engine', () => {
    const a = snap('Döner', { kcal: 700, p: 35, c: 60, f: 32 }, {}, 0.2)
    const b = snap('Ayran', { kcal: 100, p: 5, c: 7, f: 5 }, {}, 0.4)
    const t = mealTotals([a, b])
    expect(t.kcal.mid).toBe(800)
    expect(t.protein.mid).toBe(40)
    const engine = mealBand([{ kcal: 700, band: { halfPct: 0.2, tier: bandTier(0.2), reasons: [] } }, { kcal: 100, band: { halfPct: 0.4, tier: bandTier(0.4), reasons: [] } }]).halfPct
    expect(t.half).toBeCloseTo(engine, 6)
    expect(t.kcal.low).toBe(Math.round((800 * (1 - engine)) / 10) * 10)
    expect(t.kcal.high).toBe(Math.round((800 * (1 + engine)) / 10) * 10)
    // Never the naive sum of lows and highs, and never a single point.
    expect(t.kcal.high - t.kcal.low).toBeGreaterThan(0)
    expect(t.kcal.high - t.kcal.low).toBeLessThan(a.kcal.high + b.kcal.high - a.kcal.low - b.kcal.low)
    expect(t.fat.low).toBeLessThan(t.fat.mid)
  })
  it('keeps one dish as it is and nothing as zero', () => {
    const a = snap('Falafel', { kcal: 520, p: 18, c: 60, f: 22 })
    expect(mealTotals([a]).kcal).toEqual(a.kcal)
    expect(mealTotals([]).kcal).toEqual({ low: 0, high: 0, mid: 0 })
  })
  it('scales a portion and keeps the range as wide in percent', () => {
    const a = snap('Pizza', { kcal: 900, p: 36, c: 110, f: 32 })
    const h = portionOf(a, 0.5)
    expect(h.kcal.mid).toBe(450)
    expect(h.protein.mid).toBe(18)
    expect(halfOf(h.kcal)).toBeCloseTo(halfOf(a.kcal), 1)
    expect(portionOf(a, 1)).toBe(a)
  })
})

describe('day', () => {
  it('counts the small hours for the evening before', () => {
    expect(dayKey(new Date(2026, 10, 21, 13, 0))).toBe('2026-11-21')
    expect(dayKey(new Date(2026, 10, 22, 1, 30))).toBe('2026-11-21')
    expect(dayKey(new Date(2026, 10, 22, 4, 0))).toBe('2026-11-22')
    expect(dayKey(new Date(2026, 0, 1, 2, 0))).toBe('2025-12-31')
  })
  it('adds up what was eaten and what is left', () => {
    const at = new Date(2026, 10, 21, 13, 0)
    const log: LogEntry[] = [
      { id: 'a', day: dayKey(at), ts: at.getTime(), portion: 1, dish: snap('Döner', { kcal: 700, p: 35, c: 60, f: 32 }) },
      { id: 'b', day: dayKey(at), ts: at.getTime() + 1, portion: 0.5, dish: snap('Baklava', { kcal: 400, p: 6, c: 50, f: 20 }) },
      { id: 'c', day: '2026-11-20', ts: at.getTime() - 86_400_000, portion: 1, dish: snap('Pizza', { kcal: 900, p: 36, c: 110, f: 32 }) },
    ]
    const today = entriesOf(log, dayKey(at))
    expect(today.map((e) => e.id)).toEqual(['a', 'b'])
    const eaten = eatenOf(today)
    expect(eaten.kcal.mid).toBe(900)
    expect(eaten.kcal.low).toBeLessThan(900)
    const left = remainingOf(defaultTargets('lose_fat'), eaten)
    expect(left.kcal).toBe(800)
    expect(left.protein).toBe(defaultTargets('lose_fat').protein - 38)
    // Over is simply negative: no clamp, no judgement.
    expect(remainingOf({ kcal: 500, protein: 10, carbs: 10, fat: 10, custom: true }, eaten).kcal).toBe(-400)
    expect(pruneLog(log, new Date(at.getTime() + 20 * 86_400_000)).length).toBe(0)
    expect(pruneLog(log, at).length).toBe(3)
  })
  it('knows how many meals the rest of the day holds', () => {
    expect(mealsLeft(8)).toBe(3)
    expect(mealsLeft(13)).toBe(2)
    expect(mealsLeft(19)).toBe(1)
    expect(mealsLeft(1)).toBe(1)
  })
})

describe('taste', () => {
  it('finds likes in any of the dish words, accents or not', () => {
    expect(firstHit('Hähnchen Döner · Chicken doner', ['chicken'])).toBe('Chicken')
    expect(firstHit('Pilzrahmschnitzel', ['mushrooms'])).toBe('Mushrooms')
    expect(firstHit('Risotto ai funghi porcini', ['beef', 'mushrooms'])).toBe('Mushrooms')
    expect(firstHit('Margherita', ['mushrooms'])).toBeNull()
  })
  it('does not mistake olive oil for olives or eggplant for eggs', () => {
    expect(firstHit('Salad · Olive oil · Oil, olive', ['olives'])).toBeNull()
    expect(firstHit('Insalata greca · Olivenöl', ['olives'])).toBeNull()
    expect(firstHit('Greek salad with olives and feta', ['olives'])).toBe('Olives')
    expect(firstHit('Grilled eggplant', ['eggs'])).toBeNull()
    expect(firstHit('Two fried eggs', ['eggs'])).toBe('Eggs')
    expect(firstHit('Thunfischsteak', ['beef'])).toBeNull()
  })
  it('matches a typed word where a word starts', () => {
    expect(firstHit('Linsensuppe mit Kreuzkümmel', ['Kreuzkümmel'])).toBe('Kreuzkümmel')
    expect(firstHit('Sauerkraut', ['kraut'])).toBeNull()
    expect(firstHit('Burger (a+b)', ['a+b'])).toBe('a+b')
  })
  it('reads a cuisine from the menu reader or an OpenStreetMap tag', () => {
    expect(likesCuisine('italian;pizza', { cuisines: ['italian'] })).toBe(true)
    expect(likesCuisine('kebab', { cuisines: ['turkish'] })).toBe(true)
    expect(likesCuisine('Vietnamese', { cuisines: ['italian'] })).toBe(false)
    expect(likesCuisine(null, { cuisines: ['italian'] })).toBe(false)
  })
  it('keeps only clean words and lists', () => {
    expect(cleanWord('  <b>Koriander</b> ')).toBe('bKoriander/b')
    expect(cleanWord('1')).toBeNull()
    expect(readTaste({ cuisines: ['italian', 'italian', 7], likes: 'no', dislikes: ['x'.repeat(40), 'onions'] })).toEqual({ cuisines: ['italian'], likes: [], dislikes: ['onions'] })
    expect(readTaste(null)).toEqual(NO_TASTE)
  })
})

describe('ranking for the person and the day', () => {
  it('changes nothing until there is a taste or something was logged', () => {
    const m = menu()
    expect(personalize(m, { taste: NO_TASTE, day: null })).toBe(m)
  })
  it('reads a dish against the rest of the day', () => {
    const day = { left: { kcal: 600, protein: 60, carbs: 50, fat: 20 }, mealsLeft: 1 }
    expect(readDay({ kcal: 420, protein: 42 }, day).key).toBe('day.fits')
    // The protein sentence is for a dish that leaves room for the rest of the day.
    expect(readDay({ kcal: 500, protein: 55 }, day).key).toBe('day.fits')
    expect(readDay({ kcal: 500, protein: 55 }, { ...day, left: { ...day.left, kcal: 1400 } }).key).toBe('day.protein')
    expect(readDay({ kcal: 880, protein: 34 }, day).key).toBe('day.over')
    expect(readDay({ kcal: 880, protein: 34 }, day).shift).toBeLessThan(readDay({ kcal: 420, protein: 42 }, day).shift)
    expect(readDay({ kcal: 500, protein: 30 }, { ...day, mealsLeft: 2 }).key).toBe('day.tight')
    expect(readDay({ kcal: 400, protein: 30 }, { left: { kcal: -50, protein: 0, carbs: 0, fat: 0 }, mealsLeft: 1 }).key).toBe('day.reached')
    expect(readDay({ kcal: 420, protein: 42 }, day).vars).toEqual({ kcal: 600 })
  })
  it('moves a big dish down and says why once little is left today', () => {
    const m = menu({ ...profile, goal: 'build_muscle' })
    // For building muscle the beef is the engine's first pick.
    expect(m.top[0]).toBe('d2')
    const out = personalize(m, { taste: NO_TASTE, day: { left: { kcal: 450, protein: 40, carbs: 40, fat: 10 }, mealsLeft: 1 } })
    expect(out.top[0]).toBe('d0')
    expect(out.dishes.find((d) => d.id === 'd0')!.why).toContain('Fits the 450 calories you have left today.')
    expect(out.dishes.find((d) => d.id === 'd1')!.why).toContain('More than the 450 calories you have left today.')
    // The engine's own sentence stays in front.
    expect(out.dishes.find((d) => d.id === 'd0')!.why.startsWith(m.dishes.find((d) => d.id === 'd0')!.why)).toBe(true)
    // Numbers are untouched.
    expect(out.dishes.map((d) => d.kcal)).toEqual(m.dishes.map((d) => d.kcal))
    expect(m.top[0]).toBe('d2')
  })
  it('puts the day into the sentence of a pick that has the voice model\'s words', () => {
    const m = menu()
    const out = personalize(m, { taste: NO_TASTE, day: { left: { kcal: 900, protein: 70, carbs: 80, fat: 30 }, mealsLeft: 1 } })
    const tip = out.tips.find((t) => t.dishId === m.tips[0]!.dishId)!
    expect(tip.why!.startsWith('Lean and filling.')).toBe(true)
    expect(tip.why).toMatch(/today\.$/)
    expect(tip.local).toBe(m.tips[0]!.local)
  })
  it('sends a disliked dish to Skip and lifts a liked one', () => {
    const m = menu()
    const out = personalize(m, { taste: { cuisines: [], likes: ['fish'], dislikes: ['mushrooms'] }, day: null })
    expect(out.top).not.toContain('d3')
    expect(out.avoid.find((a) => a.dishId === 'd3')!.reasons).toContain('Has Mushrooms, which you would rather skip.')
    expect(out.dishes.find((d) => d.id === 'd4')!.why).toContain('Has Fish, which you like.')
    expect(out.dishes.find((d) => d.id === 'd4')!.score).toBeGreaterThan(m.dishes.find((d) => d.id === 'd4')!.score)
    expect(out.top).toContain('d4')
  })
  it('never recommends a dish the engine ruled out for an allergy', () => {
    const p: Profile = { ...profile, allergies: ['fish'] }
    const input = menu().dishes.map((d) => (d.id === 'd4' ? { ...d, userAllergenHits: d.allergens } : d))
    const ranking = rankDishes(input, p)
    const m: MenuResult = { ...menu(p), dishes: ranking.dishes, top: ranking.top, avoid: ranking.avoid, tips: [] }
    const out = personalize(m, { taste: { cuisines: [], likes: ['fish'], dislikes: [] }, day: { left: { kcal: 500, protein: 60, carbs: 40, fat: 15 }, mealsLeft: 1 } })
    expect(out.top).not.toContain('d4')
    expect(out.avoid.some((a) => a.dishId === 'd4')).toBe(true)
  })
  it('talks in the language of the scan', () => {
    const out = personalize(menu({ ...profile, language: 'German' }), { taste: NO_TASTE, day: { left: { kcal: 450, protein: 40, carbs: 40, fat: 10 }, mealsLeft: 1 } })
    expect(out.dishes.find((d) => d.id === 'd0')!.why).toContain('Passt in die 450 Kalorien')
  })
})

describe('today for you', () => {
  const cand = (name: string, n: { kcal: number; p: number; c: number; f: number }, over: Partial<Candidate> & { snap?: Partial<DishSnap> } = {}): Candidate => ({
    dish: snap(name, n, over.snap), from: over.from ?? 'scan', distance: over.distance ?? null, cuisine: over.cuisine ?? null, example: over.example ?? false, placeId: over.placeId ?? null,
  })
  const pool = [
    cand('Chicken bowl', { kcal: 520, p: 45, c: 50, f: 14 }, { snap: { fit: 80, place: 'Bowl Bar' }, from: 'nearby', distance: 300, cuisine: 'bowl' }),
    cand('Salmon bowl', { kcal: 600, p: 38, c: 55, f: 22 }, { snap: { fit: 78, place: 'Bowl Bar', allergens: null }, from: 'nearby', distance: 300 }),
    cand('Pad Thai', { kcal: 780, p: 28, c: 100, f: 26 }, { snap: { fit: 55, place: 'Thai Kitchen', allergens: ['peanuts'] } }),
    cand('Mushroom pizza', { kcal: 820, p: 30, c: 100, f: 30 }, { snap: { fit: 50, place: 'Pizzeria', words: 'Pizza funghi mushrooms' }, cuisine: 'italian;pizza' }),
    cand('Lentil soup', { kcal: 320, p: 18, c: 44, f: 6 }, { snap: { fit: 62, vegan: true, vegetarian: true }, from: 'saved' }),
  ]
  it('picks the best fits, one per restaurant', () => {
    const out = suggest(pool, { profile, taste: NO_TASTE, day: null })
    expect(out.map((s) => s.dish.name)).toEqual(['Chicken bowl', 'Lentil soup', 'Pad Thai'])
    // Nothing logged yet: the engine's own sentence for the goal.
    expect(out[0]!.line).toBe('Good protein for the calories.')
  })
  it('never suggests an allergy hit, a diet break or a dislike', () => {
    const allergic = suggest(pool, { profile: { ...profile, allergies: ['peanuts'] }, taste: NO_TASTE, day: null }, 5)
    expect(allergic.map((s) => s.dish.name)).not.toContain('Pad Thai')
    const vegan = suggest(pool, { profile: { goal: 'plant_based', plantStyle: 'vegan', allergies: [], language: 'English' }, taste: NO_TASTE, day: null }, 5)
    expect(vegan.map((s) => s.dish.name)).toEqual(['Lentil soup'])
    const picky = suggest(pool, { profile, taste: { cuisines: [], likes: [], dislikes: ['mushrooms'] }, day: null }, 5)
    expect(picky.map((s) => s.dish.name)).not.toContain('Mushroom pizza')
  })
  it('uses what is left today and says so', () => {
    const out = suggest(pool, { profile, taste: NO_TASTE, day: { left: { kcal: 400, protein: 30, carbs: 30, fat: 10 }, mealsLeft: 1 } })
    expect(out[0]!.dish.name).toBe('Lentil soup')
    expect(out[0]!.line).toBe('Fits the 400 calories you have left today.')
  })
  it('lifts a liked cuisine and prefers the closer place', () => {
    const italian = suggest(pool, { profile, taste: { cuisines: ['italian'], likes: [], dislikes: [] }, day: null }, 5)
    expect(italian.find((s) => s.dish.name === 'Mushroom pizza')!.line).toBe('A cuisine you like.')
    const near = cand('Wrap', { kcal: 500, p: 30, c: 50, f: 16 }, { snap: { fit: 70, place: 'Near' }, from: 'nearby', distance: 100 })
    const far = cand('Wrap', { kcal: 500, p: 30, c: 50, f: 16 }, { snap: { fit: 70, place: 'Far' }, from: 'nearby', distance: 2400 })
    expect(suggest([far, near], { profile, taste: NO_TASTE, day: null })[0]!.dish.place).toBe('Near')
  })
})

describe('snaps', () => {
  it('scores fit exactly like the map does', () => {
    for (const goal of ['lose_fat', 'build_muscle', 'balanced', 'plant_based'] as const) {
      for (const raw of [-20, 0, 12, 30, 36, 52, 75, 140]) expect(fitOf(raw, goal)).toBe(fitScore(raw, goal))
    }
  })
  it('keeps the engine\'s numbers and the words to match taste against', () => {
    const m = menu()
    const d = m.dishes.find((x) => x.id === 'd3')!
    const s = snapOfDish(d, { place: m.restaurant, goal: 'lose_fat', from: 'scan' })
    expect(s.kcal).toEqual(d.kcal)
    expect(s.half).toBe(d.bandHalfPct)
    expect(s.key).toBe('risotto ai funghi@trattoria test')
    expect(firstHit(s.words, ['mushrooms'])).toBe('Mushrooms')
    const changed = snapOfDish(d, { place: null, goal: 'lose_fat', from: 'scan', numbers: { kcal: { low: 380, high: 460, mid: 420 }, protein: rng(10), carbs: rng(60), fat: rng(14) } })
    expect(changed.kcal.mid).toBe(420)
    expect(changed.half).toBeCloseTo(40 / 420, 3)
  })
  it('turns a map dish into ranges as wide as its calories', () => {
    const lite: DishLite = { name: 'Phở bò', translated: 'Beef noodle soup', kcal: { low: 400, mid: 500, high: 600 }, protein: 30, carbs: 60, fat: 12, price: null, priceEur: null, vegetarian: false, vegan: false, score: 71, why: 'Good protein for the calories.', example: true, ts: 0 }
    const s = snapOfLite(lite, 'Pho House')
    expect(s.half).toBeCloseTo(0.2, 5)
    expect(s.protein).toEqual({ low: 24, high: 36, mid: 30 })
    expect(s.fit).toBe(71)
    expect(s.allergens).toBeNull()
    expect(snapKey('Phở bò', 'Pho House')).toBe('pho bo@pho house')
  })
})
