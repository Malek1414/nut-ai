/**
 * Eating together, the matching itself. Pure and deterministic.
 *
 * For one person and a set of dishes (a restaurant's, or one scanned menu) it
 * finds the dish that meets every need of that person and fits their goal best.
 * When no dish does, it says which needs cannot be met together, and names the
 * smallest such set: "Nothing here for Sara: no nuts, max 10 €." A group is
 * never averaged: a place fits a person or it does not, and the screen says so.
 *
 * Numbers: calories, protein and the fit come from the Nut AI engine's stored
 * numbers and the app's own goal score (../ranking.ts). A price is the one the
 * menu prints. Allergy checks read the dish's words and the scan's hints; they
 * are hints and never a guarantee.
 */
import { detectAllergens, expandUserAllergies, type Allergen } from '../allergens.js'
import { fitScore } from '../places.js'
import { goalScore } from '../ranking.js'
import type { DishEstimate, Profile } from '../types.js'
import { allergenName } from '../voice/index.js'
import { gsay } from './copy.js'
import type { MemberResult, NeedRef, Needs, PickDish, PlaceMatch } from './types.js'

/** A dish as the matcher sees it. */
export interface Candidate {
  name: string
  translated: string | null
  price: string | null
  priceEur: number | null
  kcal: { low: number; mid: number; high: number }
  protein: number
  carbs: number
  fat: number
  fiber: number
  vegetarian: boolean
  vegan: boolean
  /** Allergens the dish likely has (ids of ../allergens.ts). */
  allergens: string[]
  /** null when the course is not known (dishes filed on the map). */
  course: 'main' | 'starter' | 'side' | 'dessert' | 'drink' | null
  example: boolean
}

export interface Member { id: string; name: string; needs: Needs }

interface Constraint {
  ref: NeedRef
  ok: (d: Candidate) => boolean
  /** What the screen says was checked when a dish passes. */
  check: string
}

/** More than this many allergies of one person are not searched for the smallest conflict (it doubles per need). */
const MAX_ALLERGY_NEEDS = 6

/** A person's needs as checks on a dish. `priced`: at least one dish has a price, so a budget can be checked at all. */
function constraints(needs: Needs, lang: unknown, priced: boolean): Constraint[] {
  const out: Constraint[] = []
  if (needs.diet !== 'any') {
    const vegan = needs.diet === 'vegan'
    const label = gsay(lang, vegan ? 'need.vegan' : 'need.vegetarian')
    out.push({ ref: { kind: 'diet', label }, ok: (d) => (vegan ? d.vegan : d.vegetarian), check: label })
  }
  for (const id of needs.allergies.slice(0, MAX_ALLERGY_NEEDS)) {
    // "shellfish" covers both shrimp and mussels.
    const set = expandUserAllergies([id])
    if (set.size === 0) continue
    const allergen = id === 'shellfish' ? gsay(lang, 'allergen.shellfish') : allergenName(lang, [...set][0]!)
    out.push({
      ref: { kind: 'allergy', id, label: gsay(lang, 'need.allergy', { allergen }) },
      ok: (d) => !d.allergens.some((a) => set.has(a as Allergen)),
      check: gsay(lang, 'check.allergen', { allergen }),
    })
  }
  const budget = needs.budget
  if (budget !== null && priced) {
    out.push({ ref: { kind: 'budget', label: gsay(lang, 'need.budget', { budget }) }, ok: (d) => d.priceEur !== null && d.priceEur <= budget, check: gsay(lang, 'check.budget') })
  }
  return out
}

const bits = (n: number) => { let c = 0; for (let x = n; x; x &= x - 1) c++; return c }

/**
 * The smallest set of needs that no dish meets together. With one need in it,
 * that need alone rules everything out ("vegan"); with two, each can be met
 * but never both in one dish ("no nuts, max 10 €").
 */
export function smallestConflict<T>(needs: T[], dishes: Candidate[], ok: (need: T, dish: Candidate) => boolean): T[] {
  if (needs.length === 0 || dishes.length === 0) return []
  // For every dish: the needs it fails, as bits.
  const fails = dishes.map((d) => needs.reduce((mask, need, i) => (ok(need, d) ? mask : mask | (1 << i)), 0))
  if (fails.some((f) => f === 0)) return []
  let best = (1 << needs.length) - 1
  let bestSize = needs.length
  for (let set = 1; set < 1 << needs.length; set++) {
    const size = bits(set)
    if (size < bestSize && fails.every((f) => (f & set) !== 0)) { best = set; bestSize = size }
  }
  return needs.filter((_n, i) => (best & (1 << i)) !== 0)
}

const range = (mid: number) => ({ low: mid, mid, high: mid })

/** The goal the app's score is asked for: a vegan or vegetarian eater with no other goal is scored as plant-based. */
function profileOf(needs: Needs, lang: unknown): Profile {
  const goal: Profile['goal'] = needs.goal === 'balanced' && needs.diet !== 'any' ? 'plant_based' : needs.goal
  return { goal, plantStyle: needs.diet === 'vegetarian' ? 'vegetarian' : 'vegan', allergies: [], language: typeof lang === 'string' ? lang : 'English' }
}

const scorable = (d: Candidate) => ({
  kcal: d.kcal, protein: range(d.protein), carbs: range(d.carbs), fat: range(d.fat), fiber: d.fiber,
  diet: { vegetarian: d.vegetarian, vegan: d.vegan, reason: null },
}) as unknown as Omit<DishEstimate, 'score' | 'why'>

const lite = (d: Candidate): PickDish => ({ name: d.name, translated: d.translated, price: d.price, priceEur: d.priceEur, kcal: d.kcal, protein: d.protein, example: d.example })

export type Where = 'place' | 'menu' | 'nearby'

/**
 * One person against one set of dishes: their pick, or why nothing fits.
 * Drinks and desserts are never the pick. A budget is only checked when the
 * dishes carry prices at all; a dish without a price cannot pass it.
 */
export function pickFor(member: Member, dishes: Candidate[], lang: unknown, where: Where): MemberResult {
  const pool = dishes.filter((d) => d.course !== 'drink' && d.course !== 'dessert' && d.kcal.mid > 0)
  const cs = constraints(member.needs, lang, pool.some((d) => d.priceEur !== null))
  const fitting = pool.filter((d) => cs.every((c) => c.ok(d)))
  if (fitting.length === 0) {
    const blockers = smallestConflict(cs, pool, (c, d) => c.ok(d)).map((c) => c.ref)
    const conflict = blockers.length ? gsay(lang, `conflict.${where}`, { name: member.name, needs: blockers.map((b) => b.label).join(', ') }) : null
    return { memberId: member.id, pick: null, blockers, conflict }
  }
  const profile = profileOf(member.needs, lang)
  const scored = fitting
    .map((d) => ({ d, ...goalScore(scorable(d), profile), main: d.course === 'main' || d.course === null }))
    // A main before a starter or side, then the better fit for the goal.
    .sort((a, b) => Number(b.main) - Number(a.main) || b.score - a.score)
  const top = scored[0]!
  return {
    memberId: member.id,
    blockers: [],
    conflict: null,
    pick: {
      dish: lite(top.d),
      fit: fitScore(top.score, profile.goal),
      why: top.why,
      checks: cs.map((c) => c.check),
      alsoFits: scored.slice(1, 3).map((s) => ({ name: s.d.name, price: s.d.price })),
    },
  }
}

export interface PlaceInput {
  place: PlaceMatch['place']
  distanceM: number
  dishes: Candidate[]
}

export interface GroupMatch {
  matches: PlaceMatch[]
  conflicts: Array<{ memberId: string; text: string }>
  noPlaceForAll: boolean
}

/**
 * Restaurants for a group, best first: places with a dish for more people come
 * first, real scans before examples, then the better fit, then the closer one.
 * A person no place fits is named in `conflicts` with the needs in the way.
 */
export function matchPlaces(members: Member[], places: PlaceInput[], lang: unknown, limit = 8): GroupMatch {
  const ranked = places.map((p) => {
    const results = members.map((m) => pickFor(m, p.dishes, lang, 'place'))
    const fits = results.filter((r) => r.pick).length
    const mean = members.length ? results.reduce((sum, r) => sum + (r.pick?.fit ?? 0), 0) / members.length : 0
    const match: PlaceMatch = { place: p.place, distanceM: Math.round(p.distanceM), fits, example: p.dishes.length > 0 && p.dishes.every((d) => d.example), results, voters: [] }
    return { match, mean }
  })
  ranked.sort((a, b) => b.match.fits - a.match.fits || Number(a.match.example) - Number(b.match.example) || b.mean - a.mean || a.match.distanceM - b.match.distanceM)

  const everyDish = places.flatMap((p) => p.dishes)
  const conflicts: GroupMatch['conflicts'] = []
  for (const m of members) {
    if (ranked.some((r) => r.match.results.some((x) => x.memberId === m.id && x.pick))) continue
    const text = pickFor(m, everyDish, lang, 'nearby').conflict
    if (text) conflicts.push({ memberId: m.id, text })
  }
  return {
    matches: ranked.slice(0, limit).map((r) => r.match),
    conflicts,
    noPlaceForAll: members.length > 1 && places.length > 0 && !ranked.some((r) => r.match.fits === members.length),
  }
}

const wordCache = new Map<string, string[]>()

/** Allergens a dish's own words point to (the name and its translation). For dishes that carry no scan hints. */
export function allergensFromWords(name: string, translated: string | null): string[] {
  const key = `${name}|${translated ?? ''}`
  let hit = wordCache.get(key)
  if (!hit) {
    hit = detectAllergens({ dishName: name, description: translated, components: [] }).map((f) => f.allergen)
    if (wordCache.size > 2000) wordCache.clear()
    wordCache.set(key, hit)
  }
  return hit
}
