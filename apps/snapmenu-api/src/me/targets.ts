/**
 * Daily targets: calories and grams of protein, carbs and fat.
 *
 * A default comes from the goal alone, so nobody is asked for their weight
 * before they see a result. Whoever gives body details gets the Nut AI goals
 * engine instead (Mifflin-St Jeor, activity, its safe floor, grams per kg):
 * the same arithmetic the Nut AI app uses, never a model's guess.
 *
 * Every number can be changed by hand. A target is the person's own number.
 */
// The goals package is part of the Nut AI engine. It is imported by path because
// the web app, which uses this file too, has no alias for it.
import { computeCalorieTarget, computeMacros, FLAT_FLOOR_KCAL, type ActivityLevel, type Goal as EngineGoal, type Sex } from '../../../../packages/goals/src/index.js'
import type { Goal } from '../types.js'
import type { Macro, Targets } from './types.js'

/** The engine's own floor: a calorie target never goes below it. */
export const KCAL_MIN = FLAT_FLOOR_KCAL.unspecified
export const KCAL_MAX = 4500
export const KCAL_STEP = 50
export const GRAM_STEP = 5
export const GRAM_MAX: Record<Macro, number> = { protein: 350, carbs: 700, fat: 250 }

export const KCAL_PER_GRAM: Record<Macro, number> = { protein: 4, carbs: 4, fat: 9 }

/**
 * Without body details: the EU reference intake of an average adult
 * (2,000 kcal, Regulation (EU) No 1169/2011, Annex XIII), moved by the goal, and
 * split the way the ranking already reads each goal (../ranking.ts: protein
 * first for losing fat and building muscle, about 25/45/30 for balanced).
 */
const FROM_GOAL: Record<Goal, { kcal: number; share: Record<Macro, number> }> = {
  lose_fat: { kcal: 1700, share: { protein: 0.3, carbs: 0.4, fat: 0.3 } },
  build_muscle: { kcal: 2300, share: { protein: 0.25, carbs: 0.5, fat: 0.25 } },
  balanced: { kcal: 2000, share: { protein: 0.25, carbs: 0.45, fat: 0.3 } },
  plant_based: { kcal: 2000, share: { protein: 0.25, carbs: 0.45, fat: 0.3 } },
}

/** Optional: with these the engine works out a personal target. */
export interface Body {
  sex: Sex
  weightKg: number
  heightCm: number
  ageYears: number
  activity: ActivityLevel
}

export const ACTIVITY_LEVELS: Array<{ id: ActivityLevel; label: string }> = [
  { id: 'sedentary', label: 'Mostly sitting' },
  { id: 'light', label: 'A little active' },
  { id: 'moderate', label: 'Active' },
  { id: 'active', label: 'Very active' },
]

/** The goal as the goals engine names it, with a gentle weekly rate. */
const ENGINE_GOAL: Record<Goal, { goal: EngineGoal; rateLbPerWeek: number }> = {
  lose_fat: { goal: 'lose', rateLbPerWeek: 1 },
  build_muscle: { goal: 'gain', rateLbPerWeek: 0.5 },
  balanced: { goal: 'maintain', rateLbPerWeek: 0 },
  plant_based: { goal: 'maintain', rateLbPerWeek: 0 },
}

const step = (v: number, s: number) => Math.round(v / s) * s
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export const clampKcal = (v: number) => clamp(step(v, KCAL_STEP), KCAL_MIN, KCAL_MAX)
export const clampGrams = (m: Macro, v: number) => clamp(step(v, GRAM_STEP), 0, GRAM_MAX[m])

/** Body details as they may be used: plausible adult values, else null. */
export function validBody(raw: unknown): Body | null {
  if (!raw || typeof raw !== 'object') return null
  const b = raw as Record<string, unknown>
  const sex = b['sex'] === 'male' || b['sex'] === 'female' ? b['sex'] : 'unspecified'
  const activity = ACTIVITY_LEVELS.some((a) => a.id === b['activity']) ? (b['activity'] as ActivityLevel) : 'light'
  const weightKg = b['weightKg'], heightCm = b['heightCm'], ageYears = b['ageYears']
  if (!finite(weightKg) || weightKg < 35 || weightKg > 250) return null
  if (!finite(heightCm) || heightCm < 120 || heightCm > 230) return null
  if (!finite(ageYears) || ageYears < 18 || ageYears > 100) return null
  return { sex, weightKg, heightCm, ageYears, activity }
}

/** The suggested targets for a goal. With body details they are the goals engine's; without, the reference adult's. */
export function defaultTargets(goal: Goal, body?: Body | null): Targets {
  if (body) {
    const g = ENGINE_GOAL[goal]
    const target = computeCalorieTarget({ ...body, goal: g.goal, rateLbPerWeek: g.rateLbPerWeek }).target
    const kcal = clampKcal(target)
    const m = computeMacros(kcal, body.weightKg, g.goal)
    return { kcal, protein: clampGrams('protein', m.protein_g), carbs: clampGrams('carbs', m.carbs_g), fat: clampGrams('fat', m.fat_g), custom: false }
  }
  const { kcal, share } = FROM_GOAL[goal]
  return { kcal, ...split(kcal, share), custom: false }
}

function split(kcal: number, share: Record<Macro, number>): Record<Macro, number> {
  return {
    protein: clampGrams('protein', (kcal * share.protein) / KCAL_PER_GRAM.protein),
    carbs: clampGrams('carbs', (kcal * share.carbs) / KCAL_PER_GRAM.carbs),
    fat: clampGrams('fat', (kcal * share.fat) / KCAL_PER_GRAM.fat),
  }
}

/** The calories the three macro targets add up to. */
export const macroKcal = (t: Pick<Targets, Macro>) => t.protein * KCAL_PER_GRAM.protein + t.carbs * KCAL_PER_GRAM.carbs + t.fat * KCAL_PER_GRAM.fat

/** A new calorie target. The macros keep their split and move with it. */
export function setKcal(t: Targets, kcal: number): Targets {
  const next = clampKcal(kcal)
  const had = macroKcal(t)
  if (next === t.kcal || had <= 0) return { ...t, kcal: next, custom: true }
  const share: Record<Macro, number> = {
    protein: (t.protein * KCAL_PER_GRAM.protein) / had,
    carbs: (t.carbs * KCAL_PER_GRAM.carbs) / had,
    fat: (t.fat * KCAL_PER_GRAM.fat) / had,
  }
  return { kcal: next, ...split(next, share), custom: true }
}

/** A new target for one macro. The others stay where they are. */
export function setMacro(t: Targets, macro: Macro, grams: number): Targets {
  return { ...t, [macro]: clampGrams(macro, grams), custom: true }
}

/** Targets read back from the phone: the saved ones when they are sane, else the goal's defaults. */
export function readTargets(raw: unknown, goal: Goal, body?: Body | null): Targets {
  const d = defaultTargets(goal, body)
  if (!raw || typeof raw !== 'object') return d
  const r = raw as Record<string, unknown>
  if (r['custom'] !== true) return d
  const num = (k: string) => (finite(r[k]) ? (r[k] as number) : null)
  const kcal = num('kcal'), protein = num('protein'), carbs = num('carbs'), fat = num('fat')
  if (kcal === null || protein === null || carbs === null || fat === null) return d
  return { kcal: clampKcal(kcal), protein: clampGrams('protein', protein), carbs: clampGrams('carbs', carbs), fat: clampGrams('fat', fat), custom: true }
}
