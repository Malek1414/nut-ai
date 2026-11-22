import { clamp } from '@nutai/clamp'
import {
  SCHEMA_VERSION,
  type CookingCue,
  type IngredientRow,
  type Item,
  type LoggedMeal,
  type VisionPayload,
} from '@nutai/core-schema'
import { SEEDED_BASELINES, bandTier, computeBand, mealBand, type Band } from '@nutai/confidence'
import { estimateGrams, type FoodDb, type PersonalPriors } from '@nutai/gram-engine'
import { decideOutcome, matchLadder, scoreCandidates } from '@nutai/resolver'
import { recomputeTotals } from '@nutai/totals'
import { detectAllergens, detectDiet, expandUserAllergies } from './allergens.js'
import { matchDish, type DishRecipe, type RecipeComponent } from './dishes.js'
import type { FoodLookup, FoodRow } from './food-lookup.js'
import type { OffHit } from './off.js'
import type { ComponentRow, DishEstimate, ModelComponent, ModelDish, NumberSource, Profile, Range } from './types.js'
import { allergenName, noAmounts } from './voice/index.js'
import { BRAND } from './brand.js'

/**
 * Menu mode on top of the Nut AI engine.
 *
 * The rule stays the same as Nut AI's: the model only recognises food. For a
 * menu that means it reads dish names and names likely components. Then:
 *   - grams: Snapmenu's dish table (a standard-recipe portion we wrote) when the
 *     dish is known, otherwise @nutai/gram-engine's ladder (FNDDS standard
 *     portion, then the model's guess as the lowest-trust tier, clamped);
 *   - nutrition: a USDA row via @nutai/resolver, else Open Food Facts, else a
 *     labelled Snapmenu estimate — never the model;
 *   - totals: @nutai/totals arithmetic; ranges: @nutai/confidence bands.
 *
 * The model's prose about a dish (its description, an allergy reason) is shown
 * with every amount taken out (`noAmounts`): a weight or calorie figure on the
 * screen is the engine's, never one that came through the model's text.
 */

export interface EngineDeps {
  /** Batched, cached reads of the USDA corpus (food-lookup.ts). */
  lookup: FoodLookup
  off?: ((query: string) => Promise<OffHit | null>) | undefined
}

const NO_PRIORS: PersonalPriors = { get: () => null, containers: new Map() }
/**
 * The gram ladder is never given a resolved row for a menu dish (see the call
 * below), so it never asks for a USDA household portion. The portion table is
 * therefore not loaded at all: reading its 14,630 rows was the largest CPU cost
 * of a cold scan and changed no number.
 */
const NO_PORTIONS: FoodDb = { fnddsPortionGrams: () => null }

const DATASET: Record<string, string> = {
  fdc_foundation: 'USDA FoodData Central, Foundation Foods',
  fdc_sr_legacy: 'USDA FoodData Central, SR Legacy',
  fdc_fndds: 'USDA FoodData Central, FNDDS',
}

function cuesFor(cooking: ModelComponent['cooking'] | undefined, hiddenFat: boolean): CookingCue[] {
  const cues: CookingCue[] = []
  switch (cooking) {
    case 'grilled': cues.push('grill_marks'); break
    case 'fried': cues.push('visible_oil_sheen'); break
    case 'deep_fried': cues.push('deep_fried_color'); break
    case 'boiled': cues.push('boiled'); break
    case 'raw': cues.push('raw'); break
    case 'sauce': cues.push('sauce_coating'); break
    default: break
  }
  if (hiddenFat && !cues.includes('sauce_coating')) cues.push('sauce_coating')
  return cues
}

/** Build a valid Nut AI `Item` for one component, so the engine stages can run on it. */
export function toItem(c: { name: string; key: string; form: Item['food_form']; size?: Item['qualitative_size'] | undefined; grams: number | null; cooking?: ModelComponent['cooking']; hiddenFat?: boolean }): Item {
  return {
    name: c.name,
    brand: null,
    canonical_food_key: c.key.toLowerCase(),
    food_form: c.form,
    qualitative_size: c.size ?? 'medium',
    weight_basis: 'as_served',
    model_gram_estimate: c.grams,
    identification_confidence: 0.7,
    portion_confidence: 0.4,
    uncertainty_reason: c.hiddenFat ? 'oil_or_fat_not_visually_determinable' : 'portion_depth_not_visible',
    visible_reference_objects: [],
    container: null,
    cooking_method_cues: cuesFor(c.cooking, c.hiddenFat ?? false),
    is_beverage: c.form === 'liquid' && /\b(juice|soda|cola|beer|wine|coffee|tea|lemonade|water|milkshake|smoothie|ayran)\b/.test(c.key),
    beverage_category: null,
    legible_label_text: null,
    stated_assumptions: [],
    clarifying_questions: [],
    // Required by the schema; never used for a displayed number here (the miss
    // path below goes to Open Food Facts or drops the row instead).
    fallback_macros_at_estimate: { calories_kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: null, sodium_mg: null },
  }
}

/** Rows that are never a fair stand-in for an independent restaurant's food. */
export function plausibleRow(name: string): boolean {
  if (/^[A-Z0-9'&.\- ]{4,},/.test(name)) return false // branded chain rows (APPLEBEE'S, ...)
  if (/^(Babyfood|Infant formula|Formulated bar|Meal supplement|Child formula)/i.test(name)) return false
  return true
}

function per100FromFood(f: FoodRow): ComponentRow['per100'] {
  return {
    kcal: f.energyKcal ?? 0,
    protein_g: f.proteinG ?? 0,
    carbs_g: f.carbG ?? 0,
    fat_g: f.fatG ?? 0,
    fiber_g: f.fiberG,
    sugar_g: f.sugarG,
    sodium_mg: f.sodiumMg,
  }
}

function usdaSource(f: FoodRow): NumberSource {
  return {
    kind: 'usda',
    foodId: f.foodId,
    name: f.name,
    dataset: DATASET[f.source] ?? 'USDA FoodData Central',
    url: f.sourceId ? `https://fdc.nal.usda.gov/food-details/${f.sourceId}/nutrients` : 'https://fdc.nal.usda.gov/',
  }
}

/**
 * Text resolution, the same decision as @nutai/resolver's resolveByText (FTS5
 * candidates down the broadening ladder, six-signal scoring, two-part accept
 * rule; the best candidate is taken when the rule asks to disambiguate), read
 * through the batched lookup.
 */
export async function resolveFoodByKey(lookup: FoodLookup, key: string, grams: number): Promise<FoodRow | null> {
  const ladder = matchLadder(key)
  for (let step = 0; step < ladder.length; step++) {
    const expr = ladder[step]
    if (!expr) continue
    const rows = await lookup.candidates(expr)
    if (rows.length === 0) continue
    // The last rung of the match ladder ORs the tokens; for a menu that is too
    // loose (a "white wine butter sauce" must not become a peanut sauce).
    if (step >= 1 && /\bOR\b/.test(expr)) return null
    const outcome = decideOutcome(scoreCandidates(rows, { canonicalFoodKey: key, observedBrand: null, prepFacet: null, modelCategory: null, estimatedGrams: grams }))
    const id = outcome.kind === 'auto_accept' ? outcome.match.foodId : outcome.kind === 'disambiguate' ? outcome.candidates[0]?.foodId : undefined
    return id ? lookup.byId(id) : null
  }
  return null
}

interface Resolved {
  per100: ComponentRow['per100']
  source: NumberSource
  food: FoodRow | null
  isEstimate: boolean
}

/** USDA (pinned or searched) -> Open Food Facts -> labelled estimate -> nothing. */
async function resolveComponent(
  deps: EngineDeps,
  c: { usda?: string | undefined; key: string; name: string; per100?: RecipeComponent['per100'] | undefined; grams: number | null },
  item: Item,
): Promise<Resolved | null> {
  let food: FoodRow | null = null
  if (c.usda) food = await deps.lookup.byName(c.usda)
  if (!food && !c.per100) {
    food = await resolveFoodByKey(deps.lookup, c.key, c.grams ?? 150)
    if (food && !plausibleRow(food.name)) food = null
  }
  if (food && food.energyKcal != null) {
    return { per100: per100FromFood(food), source: usdaSource(food), food, isEstimate: false }
  }
  if (c.per100) {
    return {
      per100: { ...c.per100, fiber_g: c.per100.fiber_g ?? null, sugar_g: null, sodium_mg: null },
      source: { kind: 'snapmenu_estimate', note: `${BRAND.name} recipe estimate (no database row fits this component)` },
      food: null,
      isEstimate: true,
    }
  }
  if (deps.off) {
    const hit = await deps.off(item.name.length > 3 ? `${item.name}` : c.key)
    const hit2 = hit ?? (c.key !== item.name ? await deps.off(c.key) : null)
      if (hit2 && (item.food_form !== 'liquid' || hit2.per100.kcal <= 120)) {
      return { per100: hit2.per100, source: { kind: 'off', code: hit2.code, name: hit2.name, brand: hit2.brand, url: hit2.url }, food: null, isEstimate: false }
    }
  }
  return null
}

const PORTION_SCALE: Record<ModelDish['portion'], number> = { small: 0.75, regular: 1, large: 1.3 }

function phraseReasons(reasons: string[]): string[] {
  return [...new Set(reasons.map((r) => r.replace(/in a photo/g, 'on a menu').replace(/visible in a photo/g, 'visible on a menu')))]
}

function rangeOf(value: number, half: number, round = 10): Range {
  const r = (v: number) => Math.round(v / round) * round
  return { low: r(value * (1 - half)), high: r(value * (1 + half)), mid: r(value) }
}

/** Estimate one dish: components -> grams -> nutrition -> totals -> band. */
export async function estimateDish(
  dish: ModelDish,
  index: number,
  deps: EngineDeps,
  profile: Profile,
): Promise<Omit<DishEstimate, 'score' | 'why'>> {
  const keyed = dish.dish_key && dish.dish_key !== 'none' ? matchDish('', dish.dish_key) : null
  const recipe: DishRecipe | null = keyed ?? (dish.components.length === 0 ? matchDish(dish.name_original) ?? matchDish(dish.name_translated) : null)
  const scale = PORTION_SCALE[dish.portion] ?? 1

  type Plan = { off?: OffHit; name: string; key: string; usda?: string; per100?: RecipeComponent['per100']; form: Item['food_form']; size: Item['qualitative_size']; grams: number; cooking?: ModelComponent['cooking']; hiddenFat: boolean; fromRecipe: boolean }
  const plans: Plan[] = recipe
    ? recipe.components.map((c) => ({
        name: c.name, key: c.key, ...(c.usda ? { usda: c.usda } : {}), ...(c.per100 ? { per100: c.per100 } : {}),
        form: c.form ?? 'piled', size: 'medium', grams: c.grams * scale, hiddenFat: c.hiddenFat ?? false, fromRecipe: true,
      }))
    : dish.components.slice(0, 8).map((c) => ({
        name: c.name, key: c.usda_key || c.name, form: c.form, size: c.size ?? 'medium', grams: c.typical_grams, cooking: c.cooking,
        hiddenFat: c.cooking === 'fried' || c.cooking === 'deep_fried' || c.cooking === 'sauce', fromRecipe: false,
      }))

  // Stage 4 of the Nut AI pipeline: the non-skippable sanity clamp.
  const payload: VisionPayload = {
    schema_version: SCHEMA_VERSION,
    is_food: true,
    refusal_reason: null,
    items: plans.map((p) => toItem({ name: p.name, key: p.key, form: p.form, size: p.size, grams: p.grams, ...(p.cooking ? { cooking: p.cooking } : {}), hiddenFat: p.hiddenFat })),
    meal_overall: { identification_confidence: 0.7, portion_confidence: 0.4, assumptions: [], clarifying_questions: [] },
  }
  const { payload: clamped, flags } = clamp(payload)

  const rows: ComponentRow[] = []
  const ingredientRows: IngredientRow[] = []
  const bands: Band[] = []
  const notes: string[] = []
  const oilRows: Array<{ after: number; grams: number; name: string }> = []

  // Branded drinks (Club-Mate, Fritz-Kola, Ayran brands) live in Open Food Facts, not USDA.
  if (!recipe && dish.course === 'drink' && deps.off && plans.length === 1) {
    const usda = await resolveFoodByKey(deps.lookup, plans[0]!.key, plans[0]!.grams)
    if (!usda || usda.energyKcal == null || !plausibleRow(usda.name)) {
      const hit = await deps.off(dish.name_original.replace(/\d+[,.]?\d*\s*(l|ml|cl)\b/gi, '').trim())
      if (hit && hit.per100.kcal <= 120) plans[0]!.off = hit
    }
  }

  const resolvedAll = await Promise.all(
    clamped.items.map((item, i) => {
      const off = plans[i]!.off
      if (off) return Promise.resolve<Resolved>({ per100: off.per100, source: { kind: 'off', code: off.code, name: off.name, brand: off.brand, url: off.url }, food: null, isEstimate: false })
      return resolveComponent(deps, { ...plans[i]!, grams: item.model_gram_estimate }, item)
    }),
  )

  clamped.items.forEach((item, i) => {
    const plan = plans[i]!
    const res = resolvedAll[i]
    let grams: number
    let pathway: IngredientRow['gramPathway']
    let gramSource: string

    if (plan.fromRecipe) {
      grams = plan.grams
      // A standard-recipe portion is the menu equivalent of FNDDS's standard
      // portion tier, and carries that tier's measured band.
      pathway = 'fndds_standard_portion'
      gramSource = `${BRAND.name} standard recipe for ${recipe!.label}${scale !== 1 ? ` (x${scale} for a ${dish.portion} portion)` : ''}`
    } else {
      const g = estimateGrams({
        item,
        priors: NO_PRIORS,
        db: NO_PORTIONS,
        // USDA household portions ("1 cup", "1 patty") undershoot restaurant
        // plates, so the FNDDS tier is not offered for menu dishes; the ladder
        // falls to the typical-portion tier with its wide measured band.
        resolved: null,
        isMixedDish: plans.length > 2,
      })
      const oil = g.addedOilGrams ?? 0
      grams = (g.grams - oil) * scale
      // A database row that is already fried carries its oil; do not count it twice.
      if (oil * scale >= 1 && !/fried|breaded/i.test(res?.food?.name ?? '')) oilRows.push({ after: i, grams: oil * scale, name: plan.name })
      pathway = g.pathway
      gramSource =
        g.pathway === 'clamped' ? 'Clamped to a sane range by the engine'
        : 'Typical restaurant portion (AI read, lowest-trust tier, wide band)'
    }

    if (!res) {
      notes.push(`${plan.name}: no database match, not counted`)
      rows.push({
        id: `d${index}-c${i}`, name: plan.name, grams: Math.round(grams), gramSource, gramPathway: pathway,
        per100: { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: null, sugar_g: null, sodium_mg: null },
        source: { kind: 'none', note: 'No USDA or Open Food Facts row found' },
        bandHalfPct: 0.6, counted: false, isEstimate: true, hiddenFat: plan.hiddenFat,
      })
      return
    }

    const ing: IngredientRow = {
      id: `d${index}-c${i}`,
      displayName: plan.name,
      sourceFoodId: res.food?.foodId ?? null,
      grams,
      nutrientSnapshot: { kcal: res.per100.kcal, protein_g: res.per100.protein_g, fat_g: res.per100.fat_g, carbs_g: res.per100.carbs_g, fiber_g: res.per100.fiber_g, sugar_g: res.per100.sugar_g, sodium_mg: res.per100.sodium_mg },
      origin: res.source.kind === 'off' ? 'web_lookup' : res.source.kind === 'usda' ? 'db_search' : 'assumption_filler',
      gramPathway: pathway,
      bandHalfPct: 0.3,
      isEstimate: res.isEstimate,
      assumptions: [],
    }
    const band = computeBand({ row: ing, item, baselines: SEEDED_BASELINES, path: 'cloud', hadClampFlag: flags.some((f) => f.item === item.name) })
    // An estimate row (no database) gets at least a wide band.
    const half = res.isEstimate ? Math.max(band.halfPct, 0.45) : band.halfPct
    ing.bandHalfPct = half
    ingredientRows.push(ing)
    bands.push({ ...band, halfPct: half })
    rows.push({
      id: ing.id, name: plan.name, grams: Math.round(grams), gramSource, gramPathway: pathway,
      per100: res.per100, source: res.source, bandHalfPct: half, counted: true, isEstimate: res.isEstimate, hiddenFat: plan.hiddenFat,
    })
  })

  // The gram engine's frying correction adds absorbed oil; it must add the FAT too.
  for (const o of oilRows) {
    const ing: IngredientRow = {
      id: `d${index}-oil${o.after}`, displayName: `Frying oil absorbed (${o.name})`, sourceFoodId: null, grams: o.grams,
      nutrientSnapshot: { kcal: 884, protein_g: 0, fat_g: 100, carbs_g: 0, fiber_g: 0, sodium_mg: 0 },
      origin: 'assumption_filler', gramPathway: 'model_guess', bandHalfPct: 0.5, isEstimate: true, assumptions: [],
    }
    ingredientRows.push(ing)
    bands.push({ halfPct: 0.5, tier: 'very_wide', reasons: ['Absorbed frying oil is not visible on a menu.'] })
    rows.push({
      id: ing.id, name: ing.displayName, grams: Math.round(o.grams), gramSource: 'Nut AI oil-absorption table for fried food',
      gramPathway: 'model_guess', per100: { kcal: 884, protein_g: 0, carbs_g: 0, fat_g: 100, fiber_g: 0, sugar_g: null, sodium_mg: 0 },
      source: { kind: 'snapmenu_estimate', note: 'Vegetable oil, 884 kcal per 100 g' }, bandHalfPct: 0.5, counted: true, isEstimate: true, hiddenFat: true,
    })
  }

  const meal: LoggedMeal = {
    id: `dish-${index}`, loggedAt: new Date(0).toISOString(), ingredients: ingredientRows, portionEatenFraction: 1,
    engineId: 'snapmenu-menu-v1', promptVersion: null, schemaVersion: SCHEMA_VERSION, clampFlags: flags,
  }
  const t = recomputeTotals(meal)
  const mb = mealBand(ingredientRows.map((r, i) => ({ kcal: (r.nutrientSnapshot.kcal * r.grams) / 100, band: bands[i]! })))
  // Menu floor: the same dish differs between restaurants even with a recipe.
  const uncounted = rows.some((r) => !r.counted)
  const half = Math.min(0.6, Math.max(mb.halfPct, recipe ? 0.12 : 0.2) + (uncounted ? 0.1 : 0))

  const allergenInput = {
    dishName: `${dish.name_original} ${dish.name_translated}`,
    description: dish.description_translated,
    components: [
      // Names only: a database row's description must never invent an allergen.
      ...rows.filter((r) => !r.name.startsWith('Frying oil')).map((r) => ({ name: r.name })),
      // The model's own component list still informs allergy hints even when a recipe drove the numbers.
      ...(recipe ? dish.components.map((c) => ({ name: c.name })) : []),
    ],
    modelHints: (dish.allergen_hints ?? []).map((h) => ({ allergen: h.allergen, reason: noAmounts(h.reason) })),
  }
  const flagsOut = detectAllergens(allergenInput, profile.language).map((f) => ({ allergen: f.allergen, label: allergenName(profile.language, f.allergen), reason: f.reason, source: f.source }))
  const userSet = expandUserAllergies(profile.allergies)

  return {
    id: `d${index}`,
    name: dish.name_original,
    translated: dish.name_translated,
    description: noAmounts(dish.description_translated),
    price: dish.price,
    course: dish.course,
    recipe: recipe ? { key: recipe.key, label: recipe.label } : null,
    rows,
    kcal: rangeOf(t.kcal, half, 10),
    protein: rangeOf(t.protein_g, half, 1),
    carbs: rangeOf(t.carbs_g, half, 1),
    fat: rangeOf(t.fat_g, half, 1),
    fiber: Math.round(t.fiber_g),
    bandHalfPct: half,
    bandTier: bandTier(half),
    bandReasons: phraseReasons([
      ...(recipe ? ['Grams follow a standard restaurant recipe; real portions vary by restaurant.'] : ['Components were read from the menu text; portions are typical, not measured.']),
      ...mb.reasons,
      ...notes,
    ]),
    diet: detectDiet(dish.name_original + ' ' + dish.name_translated, dish.description_translated, allergenInput.components, { meat: dish.has_meat, fish: dish.has_fish, dairy_or_egg: dish.has_dairy_or_egg }),
    allergens: flagsOut,
    userAllergenHits: flagsOut.filter((f) => userSet.has(f.allergen as never)),
  }
}
