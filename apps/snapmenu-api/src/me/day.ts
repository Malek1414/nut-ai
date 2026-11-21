/**
 * One day of eating: which day an entry counts for, what was eaten so far, and
 * what is left of the targets.
 *
 * Pure arithmetic over the engine's numbers. No judgement comes out of here:
 * "left" may be negative, and it is then simply shown as over.
 */
import { mealTotals, portionOf } from './meal.js'
import type { LogEntry, Nutrition, Remaining, Targets } from './types.js'

/** A day starts at four in the morning: a late-night kebab still belongs to the evening before. */
export const DAY_START_HOUR = 4

const two = (n: number) => String(n).padStart(2, '0')

/**
 * The day a moment counts for, in the phone's own time: "2026-11-21".
 * Read off the local clock (before four it is still yesterday), not by taking
 * four hours off: on the two nights a year when the clocks change those differ.
 */
export function dayKey(at: Date): string {
  const d = new Date(at.getFullYear(), at.getMonth(), at.getDate() - (at.getHours() < DAY_START_HOUR ? 1 : 0))
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
}

/** The entries of one day, oldest first. */
export function entriesOf(log: readonly LogEntry[], day: string): LogEntry[] {
  return log.filter((e) => e.day === day).sort((a, b) => a.ts - b.ts)
}

/** What the entries add up to, each number as a range. */
export function eatenOf(entries: readonly LogEntry[]): Nutrition {
  return mealTotals(entries.map((e) => portionOf(e.dish, e.portion)))
}

/** Targets minus the middle of what was eaten. Negative means over. */
export function remainingOf(targets: Targets, eaten: Nutrition): Remaining {
  return {
    kcal: targets.kcal - eaten.kcal.mid,
    protein: targets.protein - eaten.protein.mid,
    carbs: targets.carbs - eaten.carbs.mid,
    fat: targets.fat - eaten.fat.mid,
  }
}

/** How many meals the rest of the day still holds, by the hour: three in the morning, two around lunch, one in the evening. */
export function mealsLeft(hour: number): 1 | 2 | 3 {
  if (hour >= DAY_START_HOUR && hour < 11) return 3
  if (hour >= 11 && hour < 16) return 2
  return 1
}

/** Log entries worth keeping: the last two weeks. */
export function pruneLog(log: readonly LogEntry[], now: Date, keepDays = 14): LogEntry[] {
  const cutoff = now.getTime() - keepDays * 86_400_000
  return log.filter((e) => e.ts >= cutoff)
}
