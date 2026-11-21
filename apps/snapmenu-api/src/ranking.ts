import type { DishEstimate, Profile } from './types.js'

/**
 * Rank dishes for the user's goal. Pure and deterministic: it only reads the
 * engine's numbers (midpoints of the ranges), never anything the model said
 * about nutrition.
 */

type Scorable = Omit<DishEstimate, 'score' | 'why'>

const fmt = (n: number) => Math.round(n).toLocaleString('en-US')

export function goalScore(d: Scorable, profile: Profile): { score: number; why: string } {
  const kcal = Math.max(d.kcal.mid, 1)
  const p = d.protein.mid
  const c = d.carbs.mid
  const f = d.fat.mid
  const proteinShare = (p * 4) / kcal
  const fatShare = (f * 9) / kcal
  const carbShare = (c * 4) / kcal
  const fiberBonus = Math.min(d.fiber, 12) * 0.6

  switch (profile.goal) {
    case 'lose_fat': {
      // Protein per calorie first; meals over ~750 kcal pay a steep penalty.
      let s = proteinShare * 100 + fiberBonus
      s -= Math.max(0, kcal - 750) / 12
      s -= kcal < 250 ? 12 : 0
      s -= fatShare > 0.5 ? (fatShare - 0.5) * 60 : 0
      const why = `${fmt(p)} g protein for ${fmt(kcal)} kcal (${Math.round(proteinShare * 100)}% of calories from protein)`
      return { score: s, why }
    }
    case 'build_muscle': {
      // Absolute protein first, sensible energy, not mostly fat.
      let s = p * 1.4 + proteinShare * 40 + fiberBonus * 0.5
      s -= Math.max(0, kcal - 1100) / 15
      s -= fatShare > 0.55 ? (fatShare - 0.55) * 50 : 0
      s -= kcal < 350 ? 10 : 0
      return { score: s, why: `${fmt(p)} g protein, ${fmt(kcal)} kcal` }
    }
    case 'balanced':
    case 'plant_based': {
      // Closeness to ~25/45/30 protein/carb/fat and a 500-800 kcal meal.
      const dist = Math.abs(proteinShare - 0.25) + Math.abs(carbShare - 0.45) + Math.abs(fatShare - 0.3)
      let s = 60 - dist * 80 + fiberBonus
      if (kcal < 450) s -= (450 - kcal) / 12
      if (kcal > 850) s -= (kcal - 850) / 12
      if (profile.goal === 'plant_based') s += Math.min(p, 30) * 0.4
      const why = `${Math.round(proteinShare * 100)}% protein, ${Math.round(carbShare * 100)}% carbs, ${Math.round(fatShare * 100)}% fat at ${fmt(kcal)} kcal`
      return { score: s, why }
    }
  }
}

export function fitsDiet(d: Scorable, profile: Profile): boolean {
  if (profile.goal !== 'plant_based') return true
  return profile.plantStyle === 'vegetarian' ? d.diet.vegetarian : d.diet.vegan
}

export interface Ranking {
  dishes: DishEstimate[]
  top: string[]
  avoid: Array<{ dishId: string; reasons: string[] }>
}

export function rankDishes(input: Scorable[], profile: Profile): Ranking {
  const dishes: DishEstimate[] = input.map((d) => ({ ...d, ...goalScore(d, profile) }))
  const eligible = (d: DishEstimate) =>
    d.userAllergenHits.length === 0 && fitsDiet(d, profile) && d.rows.some((r) => r.counted) && d.kcal.mid > 0

  const byScore = (a: DishEstimate, b: DishEstimate) => b.score - a.score
  const mains = dishes.filter((d) => d.course === 'main' && eligible(d)).sort(byScore)
  const others = dishes.filter((d) => (d.course === 'starter' || d.course === 'side') && eligible(d)).sort(byScore)
  const top = [...mains, ...others].slice(0, 3).map((d) => d.id)

  const avoid: Ranking['avoid'] = []
  for (const d of dishes) {
    const reasons: string[] = []
    for (const h of d.userAllergenHits) reasons.push(`Likely contains ${h.label}: ${h.reason.split('; ')[0]!.replace(/\.$/, '')}`)
    if (!fitsDiet(d, profile) && d.course !== 'drink') reasons.push(`Not ${profile.plantStyle === 'vegetarian' ? 'vegetarian' : 'vegan'}: ${d.diet.reason ?? 'contains animal products'}`)
    if (reasons.length) avoid.push({ dishId: d.id, reasons })
  }
  // Worst two eligible mains for the goal, when they are clearly worse.
  const worst = mains.filter((d) => !top.includes(d.id)).slice(-2).reverse()
  for (const d of worst) {
    const reasons: string[] = []
    if (profile.goal === 'lose_fat' && d.kcal.mid > 800) reasons.push(`${fmt(d.kcal.low)}-${fmt(d.kcal.high)} kcal, more than a cutting meal should be`)
    if ((d.fat.mid * 9) / Math.max(d.kcal.mid, 1) > 0.5) reasons.push(`About ${Math.round(((d.fat.mid * 9) / d.kcal.mid) * 100)}% of its calories come from fat`)
    if (profile.goal === 'build_muscle' && d.protein.mid < 25) reasons.push(`Only about ${fmt(d.protein.mid)} g protein`)
    if (profile.goal === 'lose_fat' && (d.protein.mid * 4) / d.kcal.mid < 0.15) reasons.push(`Low protein for its calories (${fmt(d.protein.mid)} g for ${fmt(d.kcal.mid)} kcal)`)
    if (reasons.length && !avoid.some((a) => a.dishId === d.id)) avoid.push({ dishId: d.id, reasons })
  }

  return { dishes, top, avoid }
}
