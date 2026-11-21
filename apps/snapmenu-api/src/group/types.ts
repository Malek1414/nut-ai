/**
 * Eating together: the shapes shared by the Worker and the web app.
 * Types only, so the web app can import this file without pulling in the Worker.
 *
 *   group  friends plan a meal out: one link, everyone adds what they eat, the app
 *          lists restaurants nearby with a dish and a price for each person.
 *   table  friends are already seated: one scanned menu, a pick per person.
 */

export type Diet = 'any' | 'vegetarian' | 'vegan'
export type GroupGoal = 'lose_fat' | 'build_muscle' | 'balanced'
export type GroupKind = 'group' | 'table'

/** What one person needs from a meal. */
export interface Needs {
  diet: Diet
  /** Ids from the app's allergy list: "tree_nuts", "milk", "shellfish" ... */
  allergies: string[]
  goal: GroupGoal
  /** The most this person wants to pay for their own dish, in whole euros. null: no limit. */
  budget: number | null
}

/** Needs read from a typed note or the transcript of a voice message. Only what was said is filled in. */
export interface ParsedNeeds {
  needs: Partial<Needs>
  /** A first name, when the person said it. */
  name: string | null
  /** Which reader filled it in: the word rules alone, or the model on top of them. */
  source: 'rules' | 'ai'
}

export interface MemberView {
  id: string
  name: string
  needs: Needs
  /** Added from this phone. */
  mine: boolean
}

export type NeedKind = 'diet' | 'allergy' | 'budget'

/** One need of a person, as a short label in the reader's language: "vegan", "no nuts", "max 10 €". */
export interface NeedRef {
  kind: NeedKind
  /** The allergy id, for an allergy. */
  id?: string
  label: string
}

export interface PickDish {
  name: string
  translated: string | null
  /** As printed on the menu. */
  price: string | null
  priceEur: number | null
  /** The engine's numbers. */
  kcal: { low: number; mid: number; high: number }
  protein: number
  /** Seeded example data: labelled in the app. */
  example: boolean
  /** Set when the pick is not a main: nothing bigger fits this person, and the screen says so. */
  course: 'starter' | 'side' | null
}

export interface Pick {
  dish: PickDish
  /** 0-100: how well the dish fits this person's goal. */
  fit: number
  /** Why this dish, in the reader's language: a fixed sentence chosen from the engine's numbers. */
  why: string
  /** What was checked for this person: "vegan", "no nuts named", "within budget". */
  checks: string[]
  /** Other dishes that fit this person too. */
  alsoFits: Array<{ name: string; price: string | null }>
}

/** One person's outcome at one place or on one menu: a pick, or the needs that cannot be met together. */
export interface MemberResult {
  memberId: string
  pick: Pick | null
  blockers: NeedRef[]
  /** The sentence for "nothing fits", in the reader's language. null when there is a pick. */
  conflict: string | null
}

export interface PlaceMatch {
  place: { id: string; name: string; lat: number; lng: number; kind: string; cuisine: string | null; address: string | null }
  distanceM: number
  /** How many people have a dish here. */
  fits: number
  /** Only seeded example dishes here. */
  example: boolean
  results: MemberResult[]
  /** Ids of the members who voted for this place. */
  voters: string[]
}

export interface GroupView {
  id: string
  kind: GroupKind
  name: string
  /** Changes whenever the group does: the app polls with it. */
  updated: number
  members: MemberView[]
  /** Restaurants near the group, best first. Empty in table mode. */
  matches: PlaceMatch[]
  /** People no place nearby fits: "No place nearby fits Sara: no nuts, max 10 €." */
  conflicts: Array<{ memberId: string; text: string }>
  /** No single place has a dish for everyone. */
  noPlaceForAll: boolean
  /** Nothing was scanned close by, so the search went further out. */
  wide: boolean
  /** Someone shared where they are. false: the search is centred on the app's fallback, Berlin Mitte, and the page says so. */
  located: boolean
  /** One scanned menu and a pick per person. null until a menu is scanned for this group. */
  table: { restaurant: string | null; dishes: number; results: MemberResult[] } | null
  attribution: string
}

/** A dish of a scanned menu as the app sends it when a table is opened. Numbers are the engine's, from the scan. */
export interface MenuDishInput {
  name: string
  translated: string | null
  price: string | null
  course: 'main' | 'starter' | 'side' | 'dessert' | 'drink'
  kcal: { low: number; mid: number; high: number }
  protein: number
  carbs: number
  fat: number
  fiber: number
  vegetarian: boolean
  vegan: boolean
  /** Allergens the scan flagged as likely. */
  allergens: string[]
}

export interface MenuInput {
  scanId: string
  restaurant: string | null
  dishes: MenuDishInput[]
}
