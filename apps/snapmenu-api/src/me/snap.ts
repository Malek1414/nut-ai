/**
 * A dish as the phone keeps it (`DishSnap`), made from what the engine returned.
 * Copies the engine's numbers; computes none of its own.
 */
import { isAlcoholic } from '../discover/drinks.js'
import type { DishEstimate, DishLite, Goal, Range } from '../types.js'
import { halfOf } from './meal.js'
import { foldWords } from './taste.js'
import type { DishSnap, Nutrition } from './types.js'

// The same curve the map uses for its fit ring (../places.ts `fitScore`); a test keeps the two equal.
const MIDS: Record<Goal, [number, number]> = { lose_fat: [30, 11], build_muscle: [52, 15], balanced: [36, 12], plant_based: [40, 12] }

/** The engine's goal score squashed to 0-100. */
export function fitOf(raw: number, goal: Goal): number {
  const [mid, scale] = MIDS[goal]
  return Math.max(1, Math.min(99, Math.round(100 / (1 + Math.exp(-(raw - mid) / scale)))))
}

/** One key per dish and place: "doner kebab@imbiss am kotti". */
export function snapKey(name: string, place: string | null): string {
  const f = (s: string) => foldWords(s).replace(/[^a-z0-9]+/g, ' ').trim()
  return `${f(name)}@${f(place ?? '')}`
}

/** The words of a dish that likes and dislikes are matched against. */
export function dishWords(d: Pick<DishEstimate, 'name' | 'translated' | 'description' | 'rows'>): string {
  return [d.name, d.translated, d.description, ...new Set(d.rows.map((r) => r.name))].filter(Boolean).join(' · ').slice(0, 400)
}

/**
 * A scanned or typed dish as a snap. `numbers` replaces the dish's own when the
 * person changed it on the dish screen (smaller, no fries): those are the
 * engine's recomputed numbers for what they will actually eat.
 */
export function snapOfDish(d: DishEstimate, opts: { place: string | null; goal: Goal; from: DishSnap['from']; numbers?: { kcal: Range; protein: Range; carbs: Range; fat: Range } | undefined }): DishSnap {
  const n = opts.numbers
  const nutrition: Nutrition = n
    ? { kcal: n.kcal, protein: n.protein, carbs: n.carbs, fat: n.fat, half: halfOf(n.kcal) }
    : { kcal: d.kcal, protein: d.protein, carbs: d.carbs, fat: d.fat, half: d.bandHalfPct }
  return {
    key: snapKey(d.name, opts.place),
    name: d.name,
    translated: d.translated && d.translated !== d.name ? d.translated : null,
    place: opts.place,
    from: opts.from,
    why: d.why,
    fit: fitOf(d.score, opts.goal),
    words: dishWords(d),
    vegetarian: d.diet.vegetarian,
    vegan: d.diet.vegan,
    ...(isAlcoholic(d) ? { alcoholic: true } : {}),
    allergens: d.allergens.map((a) => a.allergen),
    ...nutrition,
  }
}

const flat = (v: number): Range => ({ low: v, high: v, mid: v })

/** A community dish from the map as a snap. Its macros arrive as single values; the calorie range tells how wide they are. */
export function snapOfLite(d: DishLite, place: string): DishSnap {
  const half = halfOf(d.kcal)
  const around = (v: number): Range => (half > 0 ? { low: Math.round(v * (1 - half)), high: Math.round(v * (1 + half)), mid: Math.round(v) } : flat(Math.round(v)))
  return {
    key: snapKey(d.name, place),
    name: d.name,
    translated: d.translated && d.translated !== d.name ? d.translated : null,
    place,
    from: 'nearby',
    why: d.why,
    fit: d.score,
    words: [d.name, d.translated].filter(Boolean).join(' · '),
    vegetarian: d.vegetarian,
    vegan: d.vegan,
    allergens: null,
    kcal: d.kcal,
    protein: around(d.protein),
    carbs: around(d.carbs),
    fat: around(d.fat),
    half,
  }
}

/** Several dishes as one entry: a built meal, logged or saved as a whole. Its numbers are `mealTotals` of its dishes. */
export function mealSnap(name: string, items: readonly DishSnap[], totals: Nutrition): DishSnap {
  const all = (pick: (d: DishSnap) => boolean | null): boolean | null => (items.some((d) => pick(d) === null) ? null : items.every((d) => pick(d) === true))
  return {
    key: `meal:${items.map((d) => d.key).sort().join('+')}`,
    name: name.trim() || items.map((d) => d.name).join(' + '),
    translated: null,
    place: null,
    from: 'meal',
    why: '',
    fit: items.length ? Math.round(items.reduce((s, d) => s + d.fit, 0) / items.length) : 0,
    words: items.map((d) => d.words).join(' · ').slice(0, 800),
    vegetarian: all((d) => d.vegetarian),
    vegan: all((d) => d.vegan),
    // One unchecked dish leaves the whole meal unchecked.
    allergens: items.some((d) => d.allergens === null) ? null : [...new Set(items.flatMap((d) => d.allergens ?? []))],
    ...totals,
  }
}
