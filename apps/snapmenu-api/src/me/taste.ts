/**
 * Taste: cuisines, likes and dislikes. Optional, asked only after the first
 * result, and every part can be skipped.
 *
 * A like or dislike is matched against a dish's own words: its name, its
 * translation, its description and its ingredients. Matching is plain text: it
 * never changes a number, only the order of the dishes and one sentence of why.
 */
import type { Taste } from './types.js'

export interface TasteOption {
  id: string
  label: string
  /** Matched on folded text (lower case, no accents). Menu words in the languages we meet most. */
  match: RegExp
}

/** Cuisines, matched against what the menu reader or OpenStreetMap calls a place. */
export const CUISINES: TasteOption[] = [
  { id: 'italian', label: 'Italian', match: /ital|pizza|pasta|trattoria|osteria/ },
  { id: 'turkish', label: 'Turkish', match: /turk|kebab|kebap|doner|lahmacun|pide/ },
  { id: 'vietnamese', label: 'Vietnamese', match: /vietnam|pho\b|banh/ },
  { id: 'japanese', label: 'Japanese', match: /japan|sushi|ramen|udon|izakaya/ },
  { id: 'indian', label: 'Indian', match: /india|indisch|curry|tandoori|punjabi/ },
  { id: 'thai', label: 'Thai', match: /thai/ },
  { id: 'mexican', label: 'Mexican', match: /mexi|taco|burrito|tex-?mex/ },
  { id: 'levantine', label: 'Levantine', match: /levant|leban|liban|syri|arab|falafel|shawarma|schawarma|hummus|oriental|israel|palestin/ },
  { id: 'greek', label: 'Greek', match: /greek|griech|gyros|souvlaki/ },
  { id: 'german', label: 'German', match: /german|deutsch|bavarian|bayer|schnitzel|currywurst|regional/ },
  { id: 'korean', label: 'Korean', match: /korea|bibimbap|kimchi/ },
  { id: 'chinese', label: 'Chinese', match: /chin|sichuan|szechuan|dim ?sum|noodle/ },
  { id: 'burger', label: 'Burgers', match: /burger|american|diner/ },
  { id: 'bowls', label: 'Bowls & salads', match: /bowl|salad|salat|poke|healthy/ },
]

/** Foods people most often like or leave out. The same list serves both questions. */
export const FOODS: TasteOption[] = [
  { id: 'chicken', label: 'Chicken', match: /chicken|hahnchen|huhn|poulet|pollo|tavuk|geflugel/ },
  { id: 'beef', label: 'Beef', match: /beef|rind|boeuf|manzo|tagliata|bulgogi|entrecote|rumpsteak|ribeye|sirloin/ },
  { id: 'pork', label: 'Pork', match: /pork|schwein|porc|maiale|cerdo|bacon|speck|schinken|prosciutto|pancetta|guanciale|salami/ },
  { id: 'lamb', label: 'Lamb', match: /\blamb\b|lamm|agneau|agnello|cordero|kuzu/ },
  { id: 'fish', label: 'Fish', match: /fish|fisch|poisson|pesce|pescado|salmon|lachs|tuna|thunfisch|tonno|\bcod\b|kabeljau|branzino|sea bass|dorade|forelle|trout|anchov|sardell/ },
  { id: 'seafood', label: 'Seafood', match: /seafood|meeresfr|frutti di mare|shrimp|prawn|garnele|gamber|scampi|calamar|tintenfisch|octopus|mussel|muschel|cozze|vongole|clam/ },
  { id: 'tofu', label: 'Tofu', match: /tofu|tempeh|seitan/ },
  { id: 'eggs', label: 'Eggs', match: /\beggs?\b|\bei\b|\beier\b|spiegelei|ruhrei|oeuf|uovo|uova|huevo|omelet|carbonara/ },
  { id: 'cheese', label: 'Cheese', match: /cheese|kase|fromage|formaggi|queso|mozzarella|parmesan|parmigiano|feta|halloumi|gorgonzola|burrata/ },
  { id: 'mushrooms', label: 'Mushrooms', match: /mushroom|pilz|champignon|funghi|porcini|steinpilz|\bsetas?\b/ },
  { id: 'onions', label: 'Onions', match: /onion|zwiebel|oignon|cipoll|cebolla/ },
  { id: 'garlic', label: 'Garlic', match: /garlic|knoblauch|\bail\b|aglio|\bajo\b|aioli/ },
  { id: 'spicy', label: 'Spicy food', match: /spicy|scharf|chili|chilli|piccante|picante|arrabbiata|diavola|jalapeno|sambal|harissa/ },
  { id: 'cilantro', label: 'Cilantro', match: /cilantro|coriander|koriander|coriandre/ },
  { id: 'olives', label: 'Olives', match: /\bolives?\b|\boliven\b|aceituna/ },
  { id: 'tomato', label: 'Tomato', match: /tomat|pomodor/ },
  { id: 'avocado', label: 'Avocado', match: /avocado|guacamole|aguacate/ },
  { id: 'rice', label: 'Rice', match: /\brice\b|\breis\b|\briz\b|\briso\b|risotto|arroz/ },
  { id: 'pasta', label: 'Pasta', match: /pasta|spaghetti|penne|tagliatelle|rigatoni|linguine|fusilli|gnocchi|lasagn|ravioli|nudel|noodle|spatzle/ },
  { id: 'greens', label: 'Salad & greens', match: /salad|salat|insalata|ensalada|rucola|rocket|arugula|spinach|spinat|lettuce/ },
  { id: 'beans', label: 'Beans & lentils', match: /bean|bohne|lentil|linsen|chickpea|kichererb|falafel|hummus|fagioli|ceci/ },
  { id: 'fried', label: 'Fried food', match: /fried|frittiert|paniert|breaded|pommes|fries|fritti|fritto|tempura|schnitzel|crispy|knusprig/ },
]

/** Lower case, no accents, so "Hähnchen" and "hahnchen" are the same word. */
export const foldWords = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').toLowerCase()

const FOOD_BY_ID = new Map(FOODS.map((f) => [f.id, f]))
const CUISINE_BY_ID = new Map(CUISINES.map((c) => [c.id, c]))

/** What a taste entry is called on screen: the option's label, or the word the person typed. */
export const foodLabel = (id: string): string => FOOD_BY_ID.get(id)?.label ?? id
export const cuisineLabel = (id: string): string => CUISINE_BY_ID.get(id)?.label ?? id

/** A word someone typed themselves, as it is saved: trimmed, short, no markup. Null when it is not a usable word. */
export function cleanWord(raw: string): string | null {
  const w = raw.replace(/[<>{}\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24)
  return /\p{L}{2}/u.test(w) ? w : null
}

const escapeRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function matcher(entry: string): RegExp {
  const known = FOOD_BY_ID.get(entry)
  if (known) return known.match
  // A typed word matches where a word starts: "pilz" finds "Pilzrahm", not "Spilz".
  return new RegExp(`(^|[^a-z])${escapeRx(foldWords(entry))}`)
}

/** Olive oil is in half of all dishes and is not what someone means by "olives". */
const OLIVE_OIL = /oil,\s*olive|olive\s+oil|olivenol|olio (?:di |d')?oliva|huile d'olive|aceite de oliva/g

/** A taste entry inside a sentence: "mushrooms", "spicy food"; a word the person typed stays as they typed it. */
export const foodWord = (id: string): string => FOOD_BY_ID.get(id)?.label.toLowerCase() ?? id

/** The first of `entries` that the dish's words mention, as a word for a sentence; null when none does. */
export function firstHit(words: string, entries: readonly string[]): string | null {
  if (entries.length === 0) return null
  const text = foldWords(words).replace(OLIVE_OIL, ' ')
  for (const e of entries) {
    if (matcher(e).test(text)) return foodWord(e)
  }
  return null
}

/** Whether a place's cuisine (the menu reader's word, or OpenStreetMap's tag) is one the person likes. */
export function likesCuisine(cuisine: string | null | undefined, taste: Pick<Taste, 'cuisines'>): boolean {
  if (!cuisine || taste.cuisines.length === 0) return false
  const text = foldWords(cuisine.replace(/[_;]/g, ' '))
  return taste.cuisines.some((id) => CUISINE_BY_ID.get(id)?.match.test(text) ?? text.includes(foldWords(id)))
}

/** Taste read back from the phone: only lists of short strings survive. */
export function readTaste(raw: unknown): Taste {
  const list = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 24))].slice(0, 30) : [])
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return { cuisines: list(r['cuisines']), likes: list(r['likes']), dislikes: list(r['dislikes']) }
}

export const hasTaste = (t: Taste): boolean => t.cuisines.length + t.likes.length + t.dislikes.length > 0
