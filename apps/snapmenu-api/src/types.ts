/** Shared request/response types between the Worker and the web app. */

export type Goal = 'lose_fat' | 'build_muscle' | 'balanced' | 'plant_based'
export type PlantStyle = 'vegan' | 'vegetarian'

export interface Profile {
  goal: Goal
  /** Only meaningful when goal === 'plant_based'. */
  plantStyle?: PlantStyle
  allergies: string[]
  /** Language the user wants explanations and translations in, e.g. "English". */
  language: string
}

/** What the model returns after reading a menu photo. Text and perception only. */
export interface ModelComponent {
  name: string
  usda_key: string
  form: 'discrete' | 'flat' | 'piled' | 'liquid' | 'wrapped' | 'spread'
  size: 'small' | 'medium' | 'large'
  typical_grams: number
  cooking: 'grilled' | 'fried' | 'deep_fried' | 'boiled' | 'raw' | 'baked' | 'sauce' | 'none'
}

export interface ModelDish {
  name_original: string
  name_translated: string
  description_translated: string
  price: string | null
  course: 'main' | 'starter' | 'side' | 'dessert' | 'drink'
  dish_key: string
  portion: 'small' | 'regular' | 'large'
  components: ModelComponent[]
  has_meat: boolean
  has_fish: boolean
  has_dairy_or_egg: boolean
  allergen_hints: Array<{ allergen: string; reason: string }>
}

export interface MenuRead {
  is_menu: boolean
  refusal_reason: string | null
  restaurant_name: string | null
  menu_language: string
  cuisine: string
  dishes: ModelDish[]
}

export type NumberSource =
  | { kind: 'usda'; foodId: string; name: string; dataset: string; url: string }
  | { kind: 'off'; code: string; name: string; brand: string | null; url: string }
  | { kind: 'snapmenu_estimate'; note: string }
  | { kind: 'none'; note: string }

export interface ComponentRow {
  id: string
  name: string
  grams: number
  /** Where the grams came from, human-readable. */
  gramSource: string
  gramPathway: string
  per100: { kcal: number; protein_g: number; carbs_g: number; fat_g: number; fiber_g: number | null; sugar_g: number | null; sodium_mg: number | null }
  source: NumberSource
  bandHalfPct: number
  counted: boolean
  isEstimate: boolean
  hiddenFat: boolean
}

export interface Range { low: number; high: number; mid: number }

export interface AllergenFlagOut { allergen: string; label: string; reason: string; source: string }

export interface DishEstimate {
  id: string
  name: string
  translated: string
  description: string
  price: string | null
  course: ModelDish['course']
  recipe: { key: string; label: string } | null
  rows: ComponentRow[]
  kcal: Range
  protein: Range
  carbs: Range
  fat: Range
  fiber: number
  bandHalfPct: number
  bandTier: string
  bandReasons: string[]
  diet: { vegetarian: boolean; vegan: boolean; reason: string | null }
  allergens: AllergenFlagOut[]
  /** Allergens that hit the user's own list. */
  userAllergenHits: AllergenFlagOut[]
  score: number
  why: string
}

export interface OrderTip { dishId: string; local: string; translated: string }

export interface MenuResult {
  scanId: string
  restaurant: string | null
  menuLanguage: string
  cuisine: string
  profile: Profile
  dishes: DishEstimate[]
  top: string[]
  avoid: Array<{ dishId: string; reasons: string[] }>
  tips: OrderTip[]
  notes: string[]
  timings: Record<string, number>
}
