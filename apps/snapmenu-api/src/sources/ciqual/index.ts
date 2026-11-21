/**
 * CIQUAL 2025 lookup: European foods and composite dishes with real per-100 g
 * rows, bundled, no network.
 *
 * Data: Anses. 2025. Ciqual French food composition table.
 * https://doi.org/10.5281/zenodo.17550133 (CC BY 4.0). Show CIQUAL_ATTRIBUTION
 * wherever one of these numbers is shown.
 *
 * Built for a Worker's CPU budget: the names are tokenised at build time
 * (build.mjs), so nothing is indexed at import or on the first call. A lookup
 * is one pass of substring checks over the stored search keys.
 *
 * Not wired into the engine yet. See docs/oss-scout.md, "Wiring CIQUAL".
 */
import { CIQUAL_ALIASES } from './aliases.js'
import { CIQUAL_GROUPS, CIQUAL_META, CIQUAL_ROWS } from './table.generated.js'
import { GENERIC, isOffPlate, normalize, tokens } from './tokenize.mjs'
import type { CiqualConfidence, CiqualFood, CiqualHit, CiqualRow, CiqualSource } from './types.js'

export type { CiqualConfidence, CiqualFood, CiqualHit, CiqualPer100, CiqualSource } from './types.js'
export { CIQUAL_ALIASES } from './aliases.js'
export { CIQUAL_META } from './table.generated.js'
export { normalize } from './tokenize.mjs'

export const CIQUAL_ATTRIBUTION = `${CIQUAL_META.citation} ${CIQUAL_META.url} (${CIQUAL_META.licence})`

/** A two-word alias must account for at least this share of the query's words. */
const MIN_ALIAS_COVER = 0.5
/** A name match below this is not returned by lookupCiqual. */
const MIN_SEARCH_SCORE = 0.6
/** Equally good name matches further apart than this (highest kcal / lowest kcal) are a guess, not an answer. */
const MAX_TIE_SPREAD = 1.5

/**
 * Words that say what kind of food the query is. An alias that lacks one of
 * them is a different food: "white wine butter sauce" is not white wine,
 * "mozzarella pizza" is not mozzarella.
 */
const KIND_WORDS = new Set([
  'sauce', 'sosse', 'sose', 'salsa', 'dip', 'dressing', 'soup', 'suppe', 'soupe', 'zuppa', 'sopa', 'salad', 'salat', 'salade', 'insalata', 'ensalada',
  'pizza', 'sandwich', 'wrap', 'burger', 'cake', 'kuchen', 'gateau', 'torta', 'tarte', 'quiche', 'gratin', 'risotto', 'curry', 'pasta',
  'teller', 'plate', 'platte', 'box', 'bowl', 'menu', 'juice', 'saft', 'jus', 'pudding', 'noodle', 'nudeln', 'stick', 'chip',
])

/** One word, two foods, depending on the menu's language: "Pommes" is fries in German and apples in French. */
const AMBIGUOUS = new Set(['pomme'])

/** "X with Y" is a combination plate: only an alias for the whole name may answer. */
const COMBO = /(^| )(mit|with|avec|con|und|and|et|y|e)( |$)|[&+]/

const FLAG_AVERAGE = 4

/** Menus repeat themselves (rice, fries, salad), so answers are kept. Cleared when full. */
const MEMO_MAX = 2000
const memo = new Map<string, CiqualHit | null>()

interface AliasEntry { code: number; toks: string[] }
let aliasIndex: { entries: AliasEntry[]; dishCodes: Set<number> } | null = null

/** About 600 short spellings, tokenised on first use. */
function getAliases(): { entries: AliasEntry[]; dishCodes: Set<number> } {
  if (aliasIndex) return aliasIndex
  const entries: AliasEntry[] = []
  const dishCodes = new Set<number>()
  for (const a of CIQUAL_ALIASES) {
    if (a.dish) dishCodes.add(a.code)
    for (const key of a.keys) entries.push({ code: a.code, toks: tokens(key) })
  }
  aliasIndex = { entries, dishCodes }
  return aliasIndex
}

/** Rows are sorted by code (a test checks it), so a code is found by bisection. */
function rowByCode(code: number): CiqualRow | null {
  let lo = 0
  let hi = CIQUAL_ROWS.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const row = CIQUAL_ROWS[mid]
    if (!row) return null
    if (row[0] === code) return row
    if (row[0] < code) lo = mid + 1
    else hi = mid - 1
  }
  return null
}

/** CIQUAL group 01 (dishes, sandwiches, pizzas, soups, salads) plus the desserts flagged in the alias list. */
const isDishRow = (r: CiqualRow): boolean => r[3].startsWith('01') || getAliases().dishCodes.has(r[0])

function toFood(r: CiqualRow): CiqualFood {
  const g = CIQUAL_GROUPS[r[3]]
  const conf = r[12]
  return {
    code: r[0],
    nameFr: r[1],
    nameEn: r[2],
    group: g?.[0] ?? '',
    subgroup: g?.[1] ?? '',
    isDish: isDishRow(r),
    per100: { kcal: r[4], protein_g: r[5], carbs_g: r[6], fat_g: r[7], fiber_g: r[8], sugar_g: r[9], sodium_mg: r[10] },
    alcohol_g: r[11],
    confidence: conf === 'A' || conf === 'B' || conf === 'C' || conf === 'D' ? (conf satisfies CiqualConfidence) : null,
  }
}

export function ciqualSource(food: CiqualFood): CiqualSource {
  return { kind: 'ciqual', code: String(food.code), name: food.nameEn || food.nameFr, url: CIQUAL_META.url, attribution: CIQUAL_ATTRIBUTION }
}

export function ciqualByCode(code: number): CiqualFood | null {
  const row = rowByCode(code)
  return row ? toFood(row) : null
}

export interface CiqualSearchOptions {
  limit?: number
  /** Only complete menu items (see CiqualFood.isDish). */
  dishesOnly?: boolean
}

/** `exact`: the query names every word of the row ("smoked salmon" and "Salmon, smoked"). */
interface Scored { row: CiqualRow; score: number; exact: boolean }

/**
 * Every word of the query must be a word of one name (French or English).
 * Score = the share of that name's core words the query names, less 0.15 for a
 * raw, dried or frozen form the query did not ask for.
 */
function rank(q: string[], query: string, dishesOnly: boolean): Scored[] {
  if (q.length === 0) return []
  const asksOffPlate = isOffPlate(query)
  const scored: Scored[] = []
  for (const row of CIQUAL_ROWS) {
    let best = 0
    let exact = false
    for (let lang = 0; lang < 2; lang++) {
      const key = lang === 0 ? row[13] : row[14]
      // Cheap first: a word that is not even a substring cannot be a word of the key.
      if (!q.every((t) => key.includes(t))) continue
      const cut = key.indexOf(';')
      const core = key.slice(0, cut).split(' ')
      const rest = cut + 1 < key.length ? key.slice(cut + 1).split(' ') : []
      if (!q.every((t) => core.includes(t) || rest.includes(t))) continue
      let s = core.filter((t) => q.includes(t)).length / core.length
      if (row[15] & (lang + 1) && !asksOffPlate) s -= 0.15
      if (s > best) best = s
      if (core.length + rest.length === q.length) exact = true
    }
    if (best > 0 && (!dishesOnly || isDishRow(row))) scored.push({ row, score: Math.round(best * 100) / 100, exact })
  }
  return scored.sort(
    (a, b) =>
      b.score - a.score ||
      Number(b.exact) - Number(a.exact) ||
      (b.row[15] & FLAG_AVERAGE) - (a.row[15] & FLAG_AVERAGE) ||
      a.row[2].length - b.row[2].length ||
      a.row[0] - b.row[0],
  )
}

/**
 * Name search over the French and English names, best first. No OR fallback:
 * "white wine butter sauce" must not become some other sauce.
 */
export function searchCiqual(query: string, opts: CiqualSearchOptions = {}): Array<{ food: CiqualFood; score: number }> {
  return rank(tokens(query), query, opts.dishesOnly === true)
    .slice(0, opts.limit ?? 5)
    .map((s) => ({ food: toFood(s.row), score: s.score }))
}

function hit(food: CiqualFood, via: CiqualHit['via'], score: number): CiqualHit {
  return { food, per100: food.per100, source: ciqualSource(food), via, score }
}

export interface CiqualLookupOptions {
  dishesOnly?: boolean
  /** Lowest name-search score to accept (default 0.6). Aliases have their own rule. */
  minScore?: number
}

/**
 * One row for a component or dish name in any of the supported menu languages,
 * or null. It prefers saying nothing to guessing:
 *
 * 1. A pinned alias, when it is the whole query, or a two-word alias that
 *    covers at least half of it, names the same kind of food and the query is
 *    not an "X with Y" plate.
 * 2. Otherwise the best French or English name match, if it is strong enough
 *    and the equally good matches agree with each other. An exact name or a
 *    CIQUAL "average" row settles a tie.
 *
 * Answers are cached and shared between callers: treat a hit as read-only.
 */
export function lookupCiqual(query: string, opts: CiqualLookupOptions = {}): CiqualHit | null {
  const memoKey = `${opts.dishesOnly ? 'd' : 'c'}${opts.minScore ?? ''}|${query}`
  const known = memo.get(memoKey)
  if (known !== undefined) return known
  const answer = lookupUncached(query, opts)
  if (memo.size >= MEMO_MAX) memo.clear()
  memo.set(memoKey, answer)
  return answer
}

function lookupUncached(query: string, opts: CiqualLookupOptions): CiqualHit | null {
  const q = tokens(query)
  if (q.length === 0 || (q.length === 1 && AMBIGUOUS.has(q[0] ?? ''))) return null

  const combo = COMBO.test(query.toLowerCase().replace(/[^\p{L}&+]+/gu, ' '))
  let best: { code: number; cover: number; size: number } | null = null
  for (const a of getAliases().entries) {
    if (a.toks.length === 0 || a.toks.length > q.length || !a.toks.every((t) => q.includes(t))) continue
    const cover = a.toks.length / q.length
    if (cover < 1) {
      if (combo || a.toks.length < 2 || cover < MIN_ALIAS_COVER) continue
      if (q.some((t) => KIND_WORDS.has(t) && !a.toks.includes(t))) continue
    }
    if (!best || a.toks.length > best.size) best = { code: a.code, cover, size: a.toks.length }
  }
  if (best) {
    const food = ciqualByCode(best.code)
    if (food && (!opts.dishesOnly || food.isDish)) return hit(food, 'alias', Math.round(best.cover * 100) / 100)
  }

  const ranked = rank(q, query, opts.dishesOnly === true)
  const top = ranked[0]
  if (!top || top.score < (opts.minScore ?? MIN_SEARCH_SCORE)) return null
  const average = (top.row[15] & FLAG_AVERAGE) !== 0
  // "salad" or "sauce" alone says a kind, not a food: only CIQUAL's own average row may answer.
  if (!average && q.every((t) => KIND_WORDS.has(t) || GENERIC.has(t))) return null
  if (!average && !top.exact) {
    const tied = ranked.filter((r) => r.score === top.score).map((r) => r.row[4])
    const low = Math.min(...tied)
    const high = Math.max(...tied)
    if (high - low > 40 && high > low * MAX_TIE_SPREAD) return null
  }
  return hit(toFood(top.row), 'search', top.score)
}

/**
 * A whole-dish row per 100 g ("Moussaka", "Döner Kebab im Brot"), to compare with
 * the engine's component sum. It is one typical recipe, mostly prepacked or
 * take-away, so treat it as a second opinion and never as the restaurant's number.
 */
export function ciqualDishReference(dishName: string): CiqualHit | null {
  return lookupCiqual(dishName, { dishesOnly: true })
}
