/**
 * Several dishes as one meal: totals for calories, protein, carbs and fat, each
 * as a range.
 *
 * The totals are arithmetic over the engine's numbers. How wide the range of the
 * whole meal is comes from the Nut AI confidence package (`mealBand`): errors of
 * separate dishes combine in quadrature, weighted by calories, and a meal is
 * never shown as more certain than its biggest dish allows.
 */
// Imported by path: the web app, which uses this file too, has no alias for the package.
import { bandTier, mealBand } from '../../../../packages/confidence/src/index.js'
import type { Range } from '../types.js'
import type { Nutrition } from './types.js'

/** A value with its range, rounded the way the engine rounds a dish (calories to 10, grams to 1). */
export function rangeAround(value: number, half: number, round: number): Range {
  const r = (v: number) => Math.round(v / round) * round
  return { low: r(value * (1 - half)), high: r(value * (1 + half)), mid: r(value) }
}

/** How wide a range is, as a share of its middle. For numbers that arrive without it. */
export function halfOf(r: Range): number {
  return r.mid > 0 ? Math.max(0, Math.min(0.6, (r.high - r.low) / (2 * r.mid))) : 0
}

const times = (r: Range, k: number, round: number): Range => {
  const f = (v: number) => Math.round((v * k) / round) * round
  return { low: f(r.low), high: f(r.high), mid: f(r.mid) }
}

/** A share of a dish: half a plate, a plate and a half. The range stays as wide in percent. */
export function portionOf<T extends Nutrition>(d: T, portion: number): T {
  if (portion === 1) return d
  return { ...d, kcal: times(d.kcal, portion, 10), protein: times(d.protein, portion, 1), carbs: times(d.carbs, portion, 1), fat: times(d.fat, portion, 1) }
}

export const NOTHING: Nutrition = { kcal: { low: 0, high: 0, mid: 0 }, protein: { low: 0, high: 0, mid: 0 }, carbs: { low: 0, high: 0, mid: 0 }, fat: { low: 0, high: 0, mid: 0 }, half: 0 }

/** The totals of several dishes, each number as a range. */
export function mealTotals(items: readonly Nutrition[]): Nutrition {
  if (items.length === 0) return NOTHING
  if (items.length === 1) return { kcal: items[0]!.kcal, protein: items[0]!.protein, carbs: items[0]!.carbs, fat: items[0]!.fat, half: items[0]!.half }
  const sum = (pick: (n: Nutrition) => number) => items.reduce((s, n) => s + pick(n), 0)
  const half = mealBand(items.map((n) => ({ kcal: n.kcal.mid, band: { halfPct: n.half, tier: bandTier(n.half), reasons: [] } }))).halfPct
  return {
    kcal: rangeAround(sum((n) => n.kcal.mid), half, 10),
    protein: rangeAround(sum((n) => n.protein.mid), half, 1),
    carbs: rangeAround(sum((n) => n.carbs.mid), half, 1),
    fat: rangeAround(sum((n) => n.fat.mid), half, 1),
    half,
  }
}
