// The "best dishes near you" ranking that the map carousel and sheet share: one filter and one title,
// so both always show the same order. Adapted from the team's wohin app (apps/web/src/lib/ranking.ts).
import type { DishLite, Place, Profile } from '../../../snapmenu-api/src/types'
import { distance, type LatLng } from '../lib/position'

export const BUDGET_EUR = 12
export const PROTEIN_GOAL_G = 30

export const KIEZE = ['Mitte', 'Kreuzberg', 'Prenzlauer Berg', 'Friedrichshain', 'Neukölln'] as const
export type Kiez = (typeof KIEZE)[number]

/** Kiez centres: choosing one moves the map there and loads its restaurants. */
export const KIEZ_CENTRE: Record<Kiez, LatLng> = {
  Mitte: { lat: 52.5235, lng: 13.404 },
  Kreuzberg: { lat: 52.4977, lng: 13.4108 },
  'Prenzlauer Berg': { lat: 52.539, lng: 13.424 },
  Friedrichshain: { lat: 52.5125, lng: 13.454 },
  Neukölln: { lat: 52.4811, lng: 13.435 },
}

export interface MapChoice {
  kiez: Kiez | null
  underBudget: boolean
  proteinPlus: boolean
}

export interface DishResult {
  dish: DishLite
  place: Place
  /** Metres from the user, null until the position is shared. */
  distance: number | null
  /** How many dishes the community scanned at this place. */
  dishes: number
  example: boolean
}

export function rankResults(places: Place[], scored: Record<string, { best: DishLite; dishes: number; example: boolean }>, choice: MapChoice, user: LatLng | null): DishResult[] {
  const out: DishResult[] = []
  for (const place of places) {
    const s = scored[place.id]
    if (!s) continue
    if (choice.underBudget && s.best.priceEur !== null && s.best.priceEur > BUDGET_EUR) continue
    if (choice.proteinPlus && s.best.protein < PROTEIN_GOAL_G) continue
    out.push({ dish: s.best, place, distance: user ? distance(user, place) : null, dishes: s.dishes, example: s.example })
  }
  return out.sort((a, b) => b.dish.score - a.dish.score || b.dish.protein - a.dish.protein)
}

const GOAL_WORD: Record<Profile['goal'], string> = {
  lose_fat: 'to lose fat',
  build_muscle: 'for protein',
  balanced: 'for a balanced meal',
  plant_based: 'plant-based',
}

/** "Best dishes for protein under 12 € near you", adapted to the active choices. */
export function rankingTitle(choice: Pick<MapChoice, 'kiez' | 'underBudget'>, profile: Profile | null): string {
  const goal = profile ? GOAL_WORD[profile.goal] : 'for you'
  const budget = choice.underBudget ? ` under ${BUDGET_EUR} €` : ''
  const where = choice.kiez ? ` in ${choice.kiez}` : ' near you'
  return `Best dishes ${goal}${budget}${where}`
}

/** "1 dish" or "12 dishes". */
export function dishCount(n: number): string {
  return n === 1 ? '1 dish' : `${n} dishes`
}
