/**
 * The shapes the menu chat sends and gets back, shared by the Worker
 * (./chat.ts, ./api.ts) and the web app (apps/snapmenu-web/src/voice).
 * Types and limits only, nothing from the Worker: the web app uses this file too.
 */
import { isAlcoholic } from '../discover/drinks.js'
import type { MenuResult, Profile } from '../types.js'

/** One dish of the scanned menu, as the chat needs it: the engine's numbers and what the menu says. */
export interface ChatDish {
  id: string
  name: string
  translated: string
  description: string
  price: string | null
  course: string
  made: string[]
  kcal: { low: number; high: number }
  protein: number
  carbs: number
  fat: number
  vegetarian: boolean
  vegan: boolean
  /** Likely allergens (ids), and the ones that hit the user's own list. */
  allergens: string[]
  allergyHits: string[]
}

export interface ChatMenu {
  scanId: string | null
  restaurant: string | null
  menuLanguage: string
  cuisine: string
  dishes: ChatDish[]
  /** The app's picks, best first, and the dishes it says to skip with the reason. */
  top: string[]
  avoid: Array<{ dishId: string; reason: string }>
}

export interface ChatTurn { role: 'user' | 'assistant'; text: string }

export interface ChatInput {
  message: string
  history: ChatTurn[]
  menu: ChatMenu
  profile: Profile
}

export const CHAT_LIMITS = { message: 500, history: 6, turn: 500, dishes: 30, reply: 600, dishIds: 3 } as const

/**
 * A scan result as the chat sends it: every dish with the engine's numbers
 * (rounded, as the screen shows them), what it is made of, and the app's own
 * picks and skips. The rows' sources and per-100 g values stay on the phone.
 */
export function menuForChat(result: MenuResult): ChatMenu {
  return {
    scanId: result.scanId,
    restaurant: result.restaurant,
    menuLanguage: result.menuLanguage,
    cuisine: result.cuisine,
    dishes: result.dishes.filter((d) => !isAlcoholic(d)).slice(0, CHAT_LIMITS.dishes).map((d) => ({
      id: d.id,
      name: d.name,
      translated: d.translated,
      description: d.description,
      price: d.price,
      course: d.course,
      made: [...new Set(d.rows.map((r) => r.name))].slice(0, 8),
      kcal: { low: Math.round(d.kcal.low), high: Math.round(d.kcal.high) },
      protein: Math.round(d.protein.mid),
      carbs: Math.round(d.carbs.mid),
      fat: Math.round(d.fat.mid),
      vegetarian: d.diet.vegetarian,
      vegan: d.diet.vegan,
      allergens: d.allergens.map((a) => a.allergen),
      allergyHits: d.userAllergenHits.map((a) => a.allergen),
    })),
    top: result.top,
    avoid: result.avoid.map((a) => ({ dishId: a.dishId, reason: a.reasons[0] ?? '' })),
  }
}

/** What POST /api/chat answers. */
export interface ChatReply {
  /** The answer in the user's language. It carries no number of the model's. */
  reply: string
  /** The dishes the answer is about: the app shows the engine's numbers for these. */
  dishIds: string[]
  /** The language of `reply` ("German") and its code ("de"), for reading it aloud. */
  language: string
  tag: string
}
