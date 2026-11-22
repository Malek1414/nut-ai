import { dietOf, type DishEstimate, type Profile } from './types.js'
import { isAlcoholic } from './discover/drinks.js'
import { allergenName, say, type CopyKey } from './voice/index.js'

/**
 * Rank dishes for the user's goal. Pure and deterministic: it only reads the
 * engine's numbers (midpoints of the ranges), never anything the model said
 * about nutrition.
 *
 * The sentences it returns are the fixed ones from ./voice, in the user's
 * language. Which sentence is chosen follows from the engine's numbers, and a
 * number inside a sentence is one of the engine's.
 */

type Scorable = Omit<DishEstimate, 'score' | 'why'>

function shares(d: Scorable) {
  const kcal = Math.max(d.kcal.mid, 1)
  const p = d.protein.mid
  return { kcal, p, proteinShare: (p * 4) / kcal, fatShare: (d.fat.mid * 9) / kcal, carbShare: (d.carbs.mid * 4) / kcal }
}

/** Which sentence says why this dish does or does not fit the goal. */
export function whyKey(d: Scorable, goal: Profile['goal']): CopyKey {
  const { kcal, p, proteinShare, fatShare, carbShare } = shares(d)
  switch (goal) {
    case 'lose_fat':
      if (kcal > 750) return 'why.lose.heavy'
      if (proteinShare >= 0.25 && kcal <= 600) return 'why.lose.best'
      if (proteinShare >= 0.2) return 'why.lose.good'
      return kcal < 450 ? 'why.lose.light' : 'why.lose.ok'
    case 'build_muscle':
      if (p >= 25 && fatShare > 0.55) return 'why.muscle.fatty'
      if (p >= 35) return 'why.muscle.best'
      return p >= 25 ? 'why.muscle.good' : 'why.muscle.low'
    case 'balanced':
    case 'plant_based': {
      if (kcal < 350) return 'why.mix.small'
      if (kcal > 950) return 'why.mix.big'
      if (fatShare > 0.45) return 'why.mix.fatty'
      if (carbShare > 0.6 && proteinShare < 0.15) return 'why.mix.carby'
      const dist = Math.abs(proteinShare - 0.25) + Math.abs(carbShare - 0.45) + Math.abs(fatShare - 0.3)
      return dist < 0.3 ? 'why.mix.best' : 'why.mix.ok'
    }
  }
}

/**
 * The engine's reading of a dish in plain English words, for the voice model:
 * it gets facts to put into a sentence and never a number to repeat.
 */
export function dishFacts(d: Scorable, goal: Profile['goal']): string[] {
  const { kcal, p, fatShare, carbShare } = shares(d)
  const facts = [
    p >= 35 ? 'a lot of protein' : p >= 20 ? 'a fair amount of protein' : 'little protein',
    kcal < 450 ? 'light on calories' : kcal <= 750 ? 'a normal amount of calories for a meal' : 'heavy on calories',
  ]
  if (fatShare > 0.5) facts.push('much of it is fat')
  else if (fatShare < 0.25) facts.push('little fat')
  if (carbShare > 0.6) facts.push('mostly carbs')
  if (d.fiber >= 8) facts.push('plenty of fibre')
  facts.push(`the app's own line: "${say('English', whyKey(d, goal))}"`)
  return facts
}

export function goalScore(d: Scorable, profile: Profile): { score: number; why: string } {
  const { kcal, p, proteinShare, fatShare, carbShare } = shares(d)
  const fiberBonus = Math.min(d.fiber, 12) * 0.6
  const why = say(profile.language, whyKey(d, profile.goal))

  switch (profile.goal) {
    case 'lose_fat': {
      // Protein per calorie first; meals over ~750 kcal pay a steep penalty.
      let s = proteinShare * 100 + fiberBonus
      s -= Math.max(0, kcal - 750) / 12
      s -= kcal < 250 ? 12 : 0
      s -= fatShare > 0.5 ? (fatShare - 0.5) * 60 : 0
      return { score: s, why }
    }
    case 'build_muscle': {
      // Absolute protein first, sensible energy, not mostly fat.
      let s = p * 1.4 + proteinShare * 40 + fiberBonus * 0.5
      s -= Math.max(0, kcal - 1100) / 15
      s -= fatShare > 0.55 ? (fatShare - 0.55) * 50 : 0
      s -= kcal < 350 ? 10 : 0
      return { score: s, why }
    }
    case 'balanced':
    case 'plant_based': {
      // Closeness to ~25/45/30 protein/carb/fat and a 500-800 kcal meal.
      const dist = Math.abs(proteinShare - 0.25) + Math.abs(carbShare - 0.45) + Math.abs(fatShare - 0.3)
      let s = 60 - dist * 80 + fiberBonus
      if (kcal < 450) s -= (450 - kcal) / 12
      if (kcal > 850) s -= (kcal - 850) / 12
      if (profile.goal === 'plant_based') s += Math.min(p, 30) * 0.4
      return { score: s, why }
    }
  }
}

export function fitsDiet(d: Scorable, profile: Profile): boolean {
  const diet = dietOf(profile)
  return diet === 'any' || (diet === 'vegetarian' ? d.diet.vegetarian : d.diet.vegan)
}

export interface Ranking {
  dishes: DishEstimate[]
  top: string[]
  avoid: Array<{ dishId: string; reasons: string[] }>
}

export function rankDishes(input: Scorable[], profile: Profile): Ranking {
  const lang = profile.language
  const dishes: DishEstimate[] = input.map((d) => ({ ...d, ...goalScore(d, profile) }))
  const eligible = (d: DishEstimate) =>
    d.userAllergenHits.length === 0 && fitsDiet(d, profile) && d.rows.some((r) => r.counted) && d.kcal.mid > 0

  const byScore = (a: DishEstimate, b: DishEstimate) => b.score - a.score
  const mains = dishes.filter((d) => d.course === 'main' && eligible(d)).sort(byScore)
  const others = dishes.filter((d) => (d.course === 'starter' || d.course === 'side') && eligible(d)).sort(byScore)
  const cafe = mains.length + others.length === 0 ? dishes.filter(d => (d.course === 'dessert' || d.course === 'drink') && !isAlcoholic(d) && eligible(d)).sort(byScore) : []
  const top = [...mains, ...others, ...cafe].slice(0, 3).map((d) => d.id)

  const avoid: Ranking['avoid'] = []
  for (const d of dishes) {
    const reasons: string[] = []
    for (const h of d.userAllergenHits) {
      const allergen = allergenName(lang, h.allergen)
      const detail = h.reason.split('; ')[0]!.replace(/[.\s]+$/, '')
      reasons.push(detail ? say(lang, 'skip.allergy.detail', { allergen, detail }) : say(lang, 'skip.allergy', { allergen }))
    }
    if (!fitsDiet(d, profile) && d.course !== 'drink') {
      reasons.push(say(lang, dietOf(profile) === 'vegetarian' ? 'skip.not_vegetarian' : 'skip.not_vegan', { thing: say(lang, `thing.${d.diet.kind ?? 'animal'}`) }))
    }
    if (reasons.length) avoid.push({ dishId: d.id, reasons })
  }
  // Worst two eligible mains for the goal, when they are clearly worse.
  const worst = mains.filter((d) => !top.includes(d.id)).slice(-2).reverse()
  for (const d of worst) {
    const reasons: string[] = []
    const { kcal, proteinShare, fatShare } = shares(d)
    // The one number in these sentences is the engine's protein figure for the dish; its calorie range is on the row already.
    if (profile.goal === 'lose_fat' && kcal > 800) reasons.push(say(lang, 'skip.heavy'))
    if (fatShare > 0.5) reasons.push(say(lang, 'skip.fatty'))
    if (profile.goal === 'build_muscle' && d.protein.mid < 25) reasons.push(say(lang, 'skip.low_protein', { protein: d.protein.mid }))
    if (profile.goal === 'lose_fat' && proteinShare < 0.15) reasons.push(say(lang, 'skip.thin_protein'))
    if (reasons.length && !avoid.some((a) => a.dishId === d.id)) avoid.push({ dishId: d.id, reasons })
  }

  return { dishes, top, avoid }
}
