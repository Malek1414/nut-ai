/**
 * What the sharing, import and numbers routes send, as types the web app reads
 * too. No imports from the Worker (only the shared dish types and ./links): the
 * web app's type check must not pull the engine in.
 */
import type { DishEstimate, Range } from '../types.js'
import type { Platform } from './links.js'

// ---------- Friend sharing ----------

export type ShareKind = 'dish' | 'pick' | 'place'

export interface SharedDish {
  name: string
  translated: string | null
  description: string | null
  kcal: Range
  protein: Range
  carbs: Range
  fat: Range
  bandTier: string
  why: string | null
  price: string | null
  vegetarian: boolean
  vegan: boolean
  /** "May contain" labels, as the dish screen shows them. Hints, never a guarantee. */
  allergens: string[]
}

export interface SharedPlace { id: string; name: string; lat: number; lng: number; cuisine: string | null; address: string | null }

export interface ShareView {
  id: string
  kind: ShareKind
  ts: number
  dish: SharedDish | null
  place: SharedPlace | null
  /** The restaurant's name when it is only known from the menu (no map place). */
  restaurant: string | null
  /** The sharer's goal, as its label ("Lose fat"): a pick is a pick for a goal. */
  goal: string | null
  hasImage: boolean
}

// ---------- Link imports ----------

export type ImportStatus = 'ok' | 'needs_dish' | 'blocked' | 'not_food'

export interface ImportSource {
  platform: Platform
  /** "Instagram", "YouTube", or the site's own name for a web page. */
  label: string
  url: string
  title: string | null
  author: string | null
  image: string | null
}

export interface ImportResult {
  status: ImportStatus
  source: ImportSource
  restaurant: { name: string; city: string | null } | null
  /** The dish with the engine's numbers. Null unless status is "ok". */
  dish: DishEstimate | null
  /** What to tell the person when there is no dish, in their language. */
  message: string | null
  /** True when the dish is what the person typed, not what the link said. */
  fromHint: boolean
}

// ---------- /numbers ----------

/** What /numbers shows about sharing, link imports, the Premium list, installs and where visitors came from. Counts only; team phones excluded. */
export interface SocialNumbers {
  shareLinks: number
  shareOpens: number
  imports: { total: number; estimated: number; saved: number; blocked: number; byPlatform: Array<{ v: string | null; c: number }> }
  premium: { signups: number; wants: Array<{ v: string | null; c: number }> }
  installs: number
  /** Visitors by the `utm_source` of the link that brought them, with how many of them went on to scan a menu. */
  sources: Array<{ v: string | null; visitors: number; scanned: number }>
}
