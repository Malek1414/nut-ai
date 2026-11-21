/**
 * "Me": what the phone keeps about one person's day. Shared by the Worker and the web app.
 *
 * Nothing here is an account. Targets, taste, the day's log, favorites and meals
 * live on the phone (apps/snapmenu-web/src/me/store.ts); the Worker only turns a
 * typed dish into an engine estimate (./estimate.ts).
 *
 * Every nutrition number in these shapes is one the Nut AI engine computed for a
 * dish, or arithmetic over such numbers. A model never writes one.
 */
import type { Range } from '../types.js'

/** Daily targets: calories, and grams of protein, carbs and fat. */
export interface Targets {
  kcal: number
  protein: number
  carbs: number
  fat: number
  /** True once the person changed a number by hand; a new goal then leaves the targets alone. */
  custom: boolean
}

export type Macro = 'protein' | 'carbs' | 'fat'

/** What someone likes to eat. Ids come from ./taste.ts; anything else is a word they typed. */
export interface Taste {
  cuisines: string[]
  likes: string[]
  dislikes: string[]
}

export const NO_TASTE: Taste = { cuisines: [], likes: [], dislikes: [] }

/** The four numbers of a dish as ranges, with how wide the range is. */
export interface Nutrition {
  kcal: Range
  protein: Range
  carbs: Range
  fat: Range
  /** Half-width of the range as a share: 0.2 means plus or minus 20%. */
  half: number
}

/**
 * A dish as the phone keeps it: the engine's numbers at the moment the dish was
 * shown. Saved, logged and combined as it is; never re-estimated by a model.
 */
export interface DishSnap extends Nutrition {
  /** The same dish at the same place has the same key, so it is not saved twice. */
  key: string
  name: string
  /** The name in the person's language, when the menu was in another one. */
  translated: string | null
  /** The restaurant, when known. */
  place: string | null
  from: 'scan' | 'typed' | 'nearby' | 'meal'
  /** Why it fits the goal, in the person's language: the engine's own fixed sentence. */
  why: string
  /** 0-100 fit for the goal it was scored for. */
  fit: number
  /** Ingredients and description, to match likes and dislikes against. */
  words: string
  vegetarian: boolean | null
  vegan: boolean | null
  /** Likely allergens (hints, never a guarantee); null when nobody checked. */
  allergens: string[] | null
}

/** One thing eaten: a dish and how much of it. */
export interface LogEntry {
  id: string
  /** The day it counts for, as `dayKey` gives it. */
  day: string
  ts: number
  /** Share of the dish eaten: 0.5, 1, 1.5, 2. */
  portion: number
  dish: DishSnap
  /** The scan it was logged from. That menu stays ranked for what was left before this meal. */
  scan?: string
}

/** A saved combination of dishes. */
export interface Meal {
  id: string
  name: string
  ts: number
  items: DishSnap[]
}

/** What is left of the targets today. Negative means over. */
export interface Remaining {
  kcal: number
  protein: number
  carbs: number
  fat: number
}
