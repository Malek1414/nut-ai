/** Shared request/response types between the Worker and the web app. */

export type Goal = 'lose_fat' | 'build_muscle' | 'balanced' | 'plant_based'
export type PlantStyle = 'vegan' | 'vegetarian'

export interface Profile {
  goal: Goal
  /** Only meaningful when goal === 'plant_based'. */
  plantStyle?: PlantStyle
  allergies: string[]
  /**
   * Language the user is talked to in, e.g. "English": the one saved in the
   * interview, else the phone's (see `userLanguage` in voice/index.ts).
   */
  language: string
}

/** What the model returns after reading a menu photo. Text and perception only. */
export interface ModelComponent {
  name: string
  usda_key: string
  form: 'discrete' | 'flat' | 'piled' | 'liquid' | 'wrapped' | 'spread'
  /** No longer asked of the model (the engine never read it); older fixtures still carry it. */
  size?: 'small' | 'medium' | 'large'
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
  diet: { vegetarian: boolean; vegan: boolean; reason: string | null; kind?: 'meat' | 'fish' | 'dairy_or_egg' }
  allergens: AllergenFlagOut[]
  /** Allergens that hit the user's own list. */
  userAllergenHits: AllergenFlagOut[]
  score: number
  /** Why the dish fits the goal, in the user's language. A fixed sentence chosen from the engine's numbers. */
  why: string
}

/**
 * The words for one recommended dish, written by the voice model.
 * It carries no number: text with a numeral is dropped before it gets here.
 */
export interface OrderTip {
  dishId: string
  /** The "order it your way" sentence, in the menu's language: it is for the waiter. */
  local: string
  /** What that sentence means, in the user's language. Empty when the menu is in the user's language. */
  translated: string
  /** Why this dish, in the user's language. When present, show it instead of the dish's own `why`. */
  why?: string
  /** Language code of `local` ("it", "de"), for reading it aloud. */
  lang?: string
}

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

// ---------- Map (OpenStreetMap places + community dishes) ----------

export type PlaceKind = 'restaurant' | 'fast_food' | 'cafe'

export interface Place {
  /** OSM element as n123 / w456 / r789. */
  id: string
  name: string
  lat: number
  lng: number
  kind: PlaceKind
  cuisine: string | null
  address: string | null
  /** OSM diet:vegan / diet:vegetarian, when tagged. */
  vegan: 'yes' | 'only' | null
  vegetarian: 'yes' | 'only' | null
  /** OSM delivery / takeaway tags. Missing on places cached before the delivery feature (treated as unknown). */
  delivery?: 'yes' | 'only' | 'no' | null
  takeaway?: 'yes' | 'only' | 'no' | null
  /** First delivery:* tag that is not "no", e.g. "delivery:partner=wolt". */
  deliveryHint?: string | null
  /** OSM brand: chains are more often on delivery platforms. */
  brand?: string | null
  /** addr:postcode, for the Lieferando search link. */
  postcode?: string | null
}

export interface DishLite {
  name: string
  translated: string | null
  kcal: { low: number; mid: number; high: number }
  protein: number
  carbs: number
  fat: number
  price: string | null
  priceEur: number | null
  vegetarian: boolean
  vegan: boolean
  /** 0-100 fit for the viewer's goal. */
  score: number
  why: string
  example: boolean
  ts: number
}

export interface PlacesResponse {
  center: { lat: number; lng: number }
  source: 'live' | 'cache' | 'stale' | 'nearby' | 'unavailable'
  updatedAt: number | null
  attribution: string
  places: Place[]
  /** Best dish for the viewer's goal at every place with community scans. */
  scored: Record<string, { best: DishLite; dishes: number; example: boolean }>
  /** Community "Delivers? yes / no" votes per place in this area. */
  deliveryVotes: Record<string, { yes: number; no: number }>
}

// ---------- Community ----------

export interface PostView {
  id: string
  ts: number
  nickname: string
  initials: string
  community: string
  kind: 'order' | 'text'
  title: string
  body: string
  place: { id: string; name: string; lat: number; lng: number } | null
  dish: { name: string; kcalLow: number; kcalHigh: number; protein: number; price: string | null } | null
  goal: string | null
  hasPhoto: boolean
  score: number
  comments: number
  myVote: -1 | 0 | 1
  saved: boolean
  mine: boolean
  /** Seeded example post: labelled in the app, never counted in /numbers. */
  example: boolean
  /** Best-order posts: the platform it was delivered through, if the author said so. */
  via: 'wolt' | 'lieferando' | 'ubereats' | null
  /** Delivery badge of the post's restaurant (no user distance on the server). */
  delivery: { level: 'osm' | 'confirmed' | 'likely'; label: string } | null
}

export interface CommentView {
  id: string
  postId: string
  parentId: string | null
  ts: number
  nickname: string
  initials: string
  body: string
  score: number
  myVote: -1 | 0 | 1
  mine: boolean
  example: boolean
  replies: CommentView[]
}
