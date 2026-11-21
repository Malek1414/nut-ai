import type { Candidate } from '@nutai/resolver'
import type { D1Like } from './d1-adapter.js'
import { RECIPE_FOODS } from './recipe-foods.generated.js'

/**
 * Every database read of a menu scan goes through here, for one reason: on the
 * Workers free plan a scan has about 10 ms of CPU, and each D1 round trip costs
 * CPU in the Worker (request, response text, JSON, tracing span). A 24-dish menu
 * used to make about 340 of them.
 *
 *   - Lookups asked for in the same tick are sent as ONE D1 batch.
 *   - Search candidates carry only the columns the scorer reads.
 *   - Results are kept in module scope, so a warm isolate answers repeats
 *     (mozzarella, olive oil, fries ...) without touching D1.
 *   - Rows pinned by the recipe table are bundled at build time
 *     (recipe-foods.generated.ts) and never queried.
 *
 * The corpus is read-only between deploys, so nothing here goes stale.
 */

/** One row of `foods`, per 100 g. */
export interface FoodRow {
  foodId: string
  name: string
  energyKcal: number | null
  proteinG: number | null
  fatG: number | null
  carbG: number | null
  fiberG: number | null
  sugarG: number | null
  sodiumMg: number | null
  source: string
  /** USDA FoodData Central id, for the source link. */
  sourceId: string | null
}

export type Query = { sql: string; params: Array<string | number> }
/** Runs a list of read queries, returns one row list per query (an empty list for a query that failed). */
export type QueryRunner = (queries: Query[]) => Promise<unknown[][]>

/** Same search and ranking expression as @nutai/resolver, without the columns the menu scorer never reads. */
const CANDIDATE_SQL = `SELECT f.id AS foodId, f.basis_confidence AS basisConfidence, f.serving_size_g AS servingSizeG,
       f.energy_kcal AS energyKcal, f.popularity_rank AS popularityRank, f.completeness_score AS completenessScore,
       bm25(food_fts, 10.0, 8.0, 4.0) AS rawBm25
FROM food_fts JOIN foods f ON f.id = food_fts.rowid
WHERE food_fts MATCH ? ORDER BY rawBm25 LIMIT 50`

const FOOD_COLS = `f.id AS foodId, f.name AS name, f.energy_kcal AS energyKcal, f.protein_g AS proteinG, f.fat_g AS fatG,
       f.carb_g AS carbG, f.fiber_g AS fiberG, f.sugar_g AS sugarG, f.sodium_mg AS sodiumMg, f.source AS source, f.source_id AS sourceId`
const FOOD_BY_ID_SQL = `SELECT ${FOOD_COLS} FROM foods f WHERE f.id = ?`
// Some descriptions exist twice in the corpus (Foundation and SR Legacy). The id
// is picked by the statement the scan has always used, so the same row wins.
export const FOOD_BY_NAME_SQL = `SELECT ${FOOD_COLS} FROM foods f WHERE f.id = (SELECT id FROM foods WHERE name = ? LIMIT 1)`
export const FOOD_BY_PREFIX_SQL = `SELECT ${FOOD_COLS} FROM foods f WHERE f.id = (SELECT id FROM foods WHERE name LIKE ? ORDER BY length(name) LIMIT 1)`

const MAX_CACHED = 4000

/** A Map that forgets its oldest entry once full. */
class Bounded<V> extends Map<string, V> {
  override set(k: string, v: V): this {
    if (this.size >= MAX_CACHED && !this.has(k)) this.delete(this.keys().next().value as string)
    return super.set(k, v)
  }
}

const candidateCache = new Bounded<Candidate[]>()
const foodCache = new Bounded<FoodRow | null>()
const nameCache = new Bounded<FoodRow | null>()

const food = (row: unknown): FoodRow | null => (row ? { ...(row as FoodRow), foodId: String((row as FoodRow).foodId) } : null)

/** D1: one batch per wave. A batch fails as a whole, so on an error each query is retried alone. */
export function d1Runner(d1: D1Like): QueryRunner {
  const stmt = (q: Query) => d1.prepare(q.sql).bind(...q.params)
  return async (queries) => {
    try {
      const out = (await d1.batch(queries.map(stmt))) as Array<{ results?: unknown[] }>
      return out.map((r) => r.results ?? [])
    } catch {
      return Promise.all(queries.map(async (q) => {
        try { return (await stmt(q).all<unknown>()).results ?? [] } catch { return [] }
      }))
    }
  }
}

export class FoodLookup {
  private queue: Array<{ query: Query; done: (rows: unknown[]) => void }> = []
  private pending = new Map<string, Promise<unknown>>()
  private scheduled = false
  /** D1 round trips and queries made by this instance (for the scan log). */
  readonly stats = { batches: 0, queries: 0 }

  constructor(private readonly run: QueryRunner) {}

  /** Up to 50 full-text candidates for a MATCH expression, best bm25 first. */
  candidates(expr: string): Promise<Candidate[]> {
    const hit = candidateCache.get(expr)
    if (hit) return Promise.resolve(hit)
    return this.once(`c:${expr}`, { sql: CANDIDATE_SQL, params: [expr] }, (rows) => {
      // SQLite hands back integer ids; every consumer treats a food id as a string.
      const list = (rows as Candidate[]).map((r) => ({ ...r, foodId: String(r.foodId), name: '', brand: null, category: null, prepFacet: null }))
      candidateCache.set(expr, list)
      return list
    })
  }

  byId(foodId: string): Promise<FoodRow | null> {
    if (foodCache.has(foodId)) return Promise.resolve(foodCache.get(foodId) ?? null)
    return this.once(`i:${foodId}`, { sql: FOOD_BY_ID_SQL, params: [foodId] }, (rows) => {
      const f = food(rows[0])
      foodCache.set(foodId, f)
      return f
    })
  }

  /** A row by its exact USDA description, or by a prefix ending in '%' (shortest match). */
  byName(name: string): Promise<FoodRow | null> {
    const bundled = RECIPE_FOODS[name]
    if (bundled) return Promise.resolve(bundled)
    if (nameCache.has(name)) return Promise.resolve(nameCache.get(name) ?? null)
    return this.once(`n:${name}`, { sql: name.endsWith('%') ? FOOD_BY_PREFIX_SQL : FOOD_BY_NAME_SQL, params: [name] }, (rows) => {
      const f = food(rows[0])
      nameCache.set(name, f)
      return f
    })
  }

  private once<T>(key: string, query: Query, map: (rows: unknown[]) => T): Promise<T> {
    const running = this.pending.get(key)
    if (running) return running as Promise<T>
    const p = new Promise<unknown[]>((done) => {
      this.queue.push({ query, done })
      if (!this.scheduled) {
        this.scheduled = true
        // A timer, not a microtask: every lookup started by the current wave of
        // dishes must be queued before the batch leaves.
        setTimeout(() => void this.flush(), 0)
      }
    }).then((rows) => {
      this.pending.delete(key)
      return map(rows)
    })
    this.pending.set(key, p)
    return p
  }

  private async flush(): Promise<void> {
    const jobs = this.queue
    this.queue = []
    this.scheduled = false
    this.stats.batches += 1
    this.stats.queries += jobs.length
    let out: unknown[][] = []
    try { out = await this.run(jobs.map((j) => j.query)) } catch { /* answered as "no rows" below */ }
    jobs.forEach((j, i) => j.done(out[i] ?? []))
  }
}

/** Test hook: forget everything cached in this isolate. */
export function clearFoodCaches(): void {
  candidateCache.clear()
  foodCache.clear()
  nameCache.clear()
}
