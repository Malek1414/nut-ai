/**
 * Ranking that knows the person and their day.
 *
 * `personalize` takes a scanned menu as the engine ranked it for the goal
 * (../ranking.ts) and moves dishes by two more things:
 *
 *   - what is left of today's targets, once something was logged today: a dish
 *     bigger than this meal's share of the remaining calories moves down, a dish
 *     that covers the protein still needed moves up;
 *   - taste: a dish with something the person likes moves up, one with something
 *     they would rather skip goes to "Skip" with the reason.
 *
 * `suggest` picks dishes for the "Today for you" card the same way, from dishes
 * the person scanned or saved and the best dishes of restaurants nearby.
 *
 * Pure and deterministic. It reads the engine's numbers and the dish's own words;
 * it never changes a number. Allergy and diet rules stay exactly the engine's: a
 * dish that was not eligible before is not eligible here.
 */
import { expandUserAllergies } from '../allergens.js'
import { fitsDiet } from '../ranking.js'
import type { DishEstimate, MenuResult, Profile } from '../types.js'
import { sayMe, type MeKey } from './copy.js'
import { dishWords } from './snap.js'
import { firstHit, likesCuisine, readTaste } from './taste.js'
import type { DishSnap, Remaining, Taste } from './types.js'

/** Today, as far as the ranking needs it. Null until something was logged today. */
export interface DayCtx {
  left: Remaining
  /** Meals the rest of the day still holds (./day.ts `mealsLeft`). */
  mealsLeft: number
}

export interface MeCtx {
  taste: Taste
  day: DayCtx | null
}

interface Nums { kcal: number; protein: number }

interface DayRead {
  /** How far the dish moves, in spreads of the menu's scores. Negative is down. */
  shift: number
  key: MeKey
  vars: Record<string, number>
}

/** Calories on screen are rounded to 10, like the engine's own. */
const round10 = (v: number) => Math.round(v / 10) * 10

/** What a dish means for the rest of the day. */
export function readDay(n: Nums, day: DayCtx): DayRead {
  const meals = Math.max(1, day.mealsLeft)
  const left = day.left.kcal
  // Nothing left: every dish is over, and the lighter one is the better one.
  if (left <= 0) return { shift: -Math.min(3, n.kcal / 300), key: 'day.reached', vars: {} }
  const share = left / meals
  const overMeal = n.kcal - share
  const need = Math.max(0, day.left.protein) / meals
  const covers = need >= 15 ? Math.min(1, n.protein / need) : 0
  let shift = 0.6 * covers
  // 150 kcal over this meal's share costs one spread, up to three.
  if (overMeal > 0) shift -= Math.min(3, overMeal / 150)
  // More than the whole rest of the day: a dish that fits goes first.
  if (n.kcal > left) shift -= 1.5
  // The protein sentence is for a dish that leaves room; one that takes most of what is left is about the calories.
  const key: MeKey = n.kcal > left ? 'day.over' : overMeal > 50 ? 'day.tight' : covers >= 0.8 && n.kcal <= left / 2 ? 'day.protein' : 'day.fits'
  return { shift, key, vars: { kcal: round10(left) } }
}

const LIKE_SHIFT = 0.75
const DISLIKE_SHIFT = -2.5

interface Read { shift: number; line: string | null; disliked: boolean }

/** One dish read against the day and the taste: how far it moves, and the one sentence that says why. */
function readDish(n: Nums, words: string, ctx: MeCtx, lang: unknown): Read {
  const dislike = firstHit(words, ctx.taste.dislikes)
  const like = dislike ? null : firstHit(words, ctx.taste.likes)
  const day = ctx.day ? readDay(n, ctx.day) : null
  const shift = (day?.shift ?? 0) + (dislike ? DISLIKE_SHIFT : 0) + (like ? LIKE_SHIFT : 0)
  // One sentence, the one that matters most: a dislike, then what the dish means for the rest of the day, then a like.
  let line: string | null = null
  if (dislike) line = sayMe(lang, 'taste.dislike', { thing: dislike })
  else if (day) line = sayMe(lang, day.key, day.vars)
  else if (like) line = sayMe(lang, 'taste.like', { thing: like })
  return { shift, line, disliked: Boolean(dislike) }
}

/** How far apart the scores of a menu are: the unit a dish is moved by. */
function spread(scores: number[]): number {
  if (scores.length < 2) return 10
  const mean = scores.reduce((s, v) => s + v, 0) / scores.length
  const sd = Math.sqrt(scores.reduce((s, v) => s + (v - mean) ** 2, 0) / scores.length)
  return Math.max(4, sd)
}

const join = (a: string | undefined, b: string | null) => [a, b].filter(Boolean).join(' ')

/**
 * A scanned menu, ranked again for this person and this day. Returns `result`
 * itself when there is nothing to add (no taste, nothing logged today).
 */
export function personalize(result: MenuResult, ctx: MeCtx): MenuResult {
  if (!ctx.day && ctx.taste.likes.length + ctx.taste.dislikes.length === 0) return result
  const profile = result.profile
  const lang = profile.language
  // The engine's own rule for what may be recommended at all (../ranking.ts).
  const eligible = (d: DishEstimate) => d.userAllergenHits.length === 0 && fitsDiet(d, profile) && d.rows.some((r) => r.counted) && d.kcal.mid > 0
  const unit = spread(result.dishes.filter(eligible).map((d) => d.score))

  const reads = new Map<string, Read>()
  const dishes = result.dishes.map((d) => {
    const r = readDish({ kcal: d.kcal.mid, protein: d.protein.mid }, dishWords(d), ctx, lang)
    reads.set(d.id, r)
    return { ...d, score: d.score + r.shift * unit, why: join(d.why, r.line) }
  })

  const byScore = (a: DishEstimate, b: DishEstimate) => b.score - a.score
  // Mains first, then starters and sides, as the engine picks them.
  const picks = (may: (d: DishEstimate) => boolean) => [
    ...dishes.filter((d) => d.course === 'main' && may(d)).sort(byScore),
    ...dishes.filter((d) => (d.course === 'starter' || d.course === 'side') && may(d)).sort(byScore),
  ].slice(0, 3).map((d) => d.id)
  let top = picks((d) => eligible(d) && !reads.get(d.id)!.disliked)
  // Someone who would rather skip everything on this menu still gets picks: taste orders dishes, it never empties the list.
  if (top.length === 0) top = picks(eligible)

  // "Skip": the engine's reasons stay; a dish that is now a pick leaves the list, a disliked one joins it.
  const avoid = result.avoid.filter((a) => !top.includes(a.dishId)).map((a) => ({ ...a, reasons: [...a.reasons] }))
  for (const d of dishes) {
    const r = reads.get(d.id)!
    if (!r.disliked || !r.line || d.course === 'drink' || top.includes(d.id)) continue
    const has = avoid.find((a) => a.dishId === d.id)
    if (has) has.reasons.push(r.line)
    else avoid.push({ dishId: d.id, reasons: [r.line] })
  }

  // The voice model's sentence for a pick keeps its place; the day's sentence follows it.
  const byId = new Map(result.dishes.map((d) => [d.id, d]))
  const tips = result.tips.map((t) => {
    const line = reads.get(t.dishId)?.line
    return line ? { ...t, why: join(t.why ?? byId.get(t.dishId)?.why, line) } : t
  })

  return { ...result, dishes, top, avoid, tips }
}

/**
 * The context as a scan request may carry it (`me` in the body of POST /api/menu):
 * only short lists of words and a handful of sane numbers survive. Null when there
 * is nothing to rank by.
 */
export function readMeCtx(raw: unknown): MeCtx | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const taste = readTaste(r['taste'])
  const d = r['day'] && typeof r['day'] === 'object' ? (r['day'] as Record<string, unknown>) : null
  const l = d && d['left'] && typeof d['left'] === 'object' ? (d['left'] as Record<string, unknown>) : null
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 20_000 ? v : null)
  const kcal = num(l?.['kcal']), protein = num(l?.['protein']), carbs = num(l?.['carbs']), fat = num(l?.['fat'])
  const meals = num(d?.['mealsLeft'])
  const day: DayCtx | null = kcal !== null && protein !== null && carbs !== null && fat !== null
    ? { left: { kcal, protein, carbs, fat }, mealsLeft: meals !== null ? Math.min(3, Math.max(1, Math.round(meals))) : 1 }
    : null
  return day || taste.likes.length + taste.dislikes.length > 0 ? { taste, day } : null
}

/**
 * The dishes of a scan that get the voice model's words: the engine's picks for
 * the goal, and the picks for this person's taste and day when a scan carries
 * them. The ranking the Worker returns stays the engine's; the app ranks for the
 * person on the phone, where the day keeps moving, and finds the words ready.
 */
export function dishesToVoice(result: MenuResult, ctx: MeCtx | null | undefined): string[] {
  if (!ctx) return result.top
  try {
    return [...new Set([...result.top, ...personalize(result, ctx).top])]
  } catch {
    // An extra for the person's own picks must never cost them the scan.
    return result.top
  }
}

// ---------- Today for you ----------

/** A dish that could be suggested today. */
export interface Candidate {
  dish: DishSnap
  from: 'scan' | 'saved' | 'nearby'
  /** Metres from the person, for a restaurant nearby. */
  distance: number | null
  /** The cuisine of the place, as the menu reader or OpenStreetMap names it. */
  cuisine: string | null
  /** Seeded example data: always labelled as such on screen. */
  example: boolean
  /** The restaurant on the map, to open it. */
  placeId: string | null
}

export interface Suggestion extends Candidate {
  score: number
  /** Why this one today, in the person's language. */
  line: string
}

export interface SuggestCtx {
  profile: Profile
  taste: Taste
  /** What is left today; null until something was logged, and the goal alone then decides. */
  day: DayCtx | null
}

/** Points on the 0-100 fit scale that one spread of `readDay` is worth. */
const DAY_POINTS = 12

/**
 * Up to `n` dishes for today, best first. A dish that hits an allergy on the
 * person's list, breaks their diet or holds something they would rather skip is
 * never suggested. Once something was logged, dishes that fit what is left come
 * before every dish that does not. One dish per restaurant, so the card shows
 * choices.
 */
export function suggest(candidates: readonly Candidate[], ctx: SuggestCtx, n = 3): Suggestion[] {
  const { profile, taste } = ctx
  const lang = profile.language
  const mine = expandUserAllergies(profile.allergies)
  const scored: Array<Suggestion & { fits: boolean }> = []
  for (const c of candidates) {
    const d = c.dish
    if (d.kcal.mid <= 0) continue
    if (profile.goal === 'plant_based' && !(profile.plantStyle === 'vegetarian' ? d.vegetarian : d.vegan)) continue
    if (d.allergens?.some((a) => mine.has(a as never))) continue
    const r = readDish({ kcal: d.kcal.mid, protein: d.protein.mid }, d.words, { taste, day: ctx.day }, lang)
    if (r.disliked) continue
    const cuisine = likesCuisine(c.cuisine, taste)
    // Closer is better, gently: a kilometre costs four points, never more than ten.
    const far = c.distance === null ? 0 : Math.min(10, (c.distance / 1000) * 4)
    const score = d.fit + r.shift * DAY_POINTS + (cuisine ? 8 : 0) - far
    const line = r.line ?? (cuisine ? sayMe(lang, 'taste.cuisine') : d.why)
    scored.push({ ...c, score, line, fits: !ctx.day || d.kcal.mid <= ctx.day.left.kcal })
  }
  scored.sort((a, b) => Number(b.fits) - Number(a.fits) || b.score - a.score || b.dish.protein.mid - a.dish.protein.mid)
  const out: Suggestion[] = []
  const seen = new Set<string>()
  for (const { fits: _fits, ...s } of scored) {
    const place = s.dish.place ? `p:${s.dish.place.toLowerCase()}` : `d:${s.dish.key}`
    if (seen.has(place) || seen.has(`d:${s.dish.key}`)) continue
    seen.add(place)
    seen.add(`d:${s.dish.key}`)
    out.push(s)
    if (out.length >= n) break
  }
  return out
}
