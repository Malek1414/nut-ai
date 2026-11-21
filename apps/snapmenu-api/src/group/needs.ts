/**
 * One person's needs: checking what the app sends, and reading them out of
 * plain text (a typed note, or the transcript of a voice message).
 *
 * The word rules here always run, cost nothing and work without the AI
 * service. When the service is there, a model reads the same text on top
 * (./ai.ts): it only ever picks from fixed lists, and a budget is taken from
 * it only when that number is in the person's own words (`mergeModelNeeds`).
 */
import { foldText } from '../allergens.js'
import type { Diet, GroupGoal, Needs, ParsedNeeds } from './types.js'

/** The app's allergy list (apps/snapmenu-web/src/lib/format.ts ALLERGY_OPTIONS). */
export const ALLERGY_IDS = ['gluten', 'milk', 'eggs', 'peanuts', 'tree_nuts', 'sesame', 'soy', 'fish', 'shellfish', 'celery', 'mustard', 'sulphites'] as const
export type AllergyId = (typeof ALLERGY_IDS)[number]
const ALLERGY_SET = new Set<string>(ALLERGY_IDS)

export const EMPTY_NEEDS: Needs = { diet: 'any', allergies: [], goal: 'balanced', budget: null }
export const MAX_BUDGET = 200
export const MAX_NEEDS_TEXT = 600

/** A budget in whole euros, or null. Cents are dropped, so "12,50" never becomes more than was said. */
export function cleanBudget(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  const n = Math.floor(v)
  return n >= 1 && n <= MAX_BUDGET ? n : null
}

/** Needs as the app sent them, with everything unknown dropped. */
export function cleanNeeds(raw: unknown): Needs {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const diet: Diet = r['diet'] === 'vegan' || r['diet'] === 'vegetarian' ? r['diet'] : 'any'
  const goal: GroupGoal = r['goal'] === 'lose_fat' || r['goal'] === 'build_muscle' ? r['goal'] : 'balanced'
  const allergies = Array.isArray(r['allergies'])
    ? ALLERGY_IDS.filter((id) => (r['allergies'] as unknown[]).includes(id))
    : []
  return { diet, allergies, goal, budget: cleanBudget(r['budget']) }
}

/** A first name or nickname: 1-24 letters, digits, spaces and a few marks. No links, handles or markup. */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = raw.replace(/\s+/g, ' ').trim()
  if (name.length < 1 || name.length > 24) return null
  return /^[\p{L}\p{N}][\p{L}\p{N} .'’-]*$/u.test(name) ? name : null
}

// ---------- Reading needs out of text ----------

/** Foods a person may have to avoid, as they are said in the app's languages. Matched on folded text (lowercase, no accents). */
const FOODS: Array<[AllergyId, RegExp]> = [
  ['peanuts', /\b(peanut\w*|erdnuss\w*|cacahuete\w*|cacahuate\w*|arachid\w*|amendoim\w*|pinda\w*|orzeszk\w*|yer fistig\w*)/g],
  ['tree_nuts', /\b(tree nuts?|nuts?|nuss\w*|noix|noisette\w*|nueces|nuez|frutos secos|noci|nocciol\w*|frutta a guscio|noten|orzech\w*|kuruyemis\w*|findik\w*|almond\w*|mandel\w*|hazelnut\w*|haselnuss\w*|walnut\w*|walnuss\w*|cashew\w*|pistach\w*|pistazie\w*)/g],
  ['gluten', /\b(gluten\w*|glutin\w*|celiac\w*|coeliac\w*|zoliakie|celiaqu\w*|celiachia|wheat|weizen\w*)/g],
  ['milk', /\b(lactos\w*|laktos\w*|lattosio|milk|milch\w*|dairy|leche|lacteos|lait|laitiers|latticini|leite|laticinios|zuivel|melk|mleko|nabial\w*|sut urun\w*)/g],
  ['eggs', /\b(eggs?|ei|eier\w*|huevos?|oeufs?|uovo|uova|ovos?|eieren|jajk\w*|yumurta\w*)\b/g],
  ['sesame', /\b(sesam\w*|tahin\w*|ajonjoli|gergelim|susam\w*|sezam\w*)/g],
  ['soy', /\b(soy|soya|soja\w*)\b/g],
  ['shellfish', /\b(shellfish|shrimps?|prawns?|crab|lobster|garnele\w*|meeresfrucht\w*|krustentier\w*|krabben|muschel\w*|mussels?|mariscos?|crustace\w*|fruits de mer|frutti di mare|crostacei|schaaldier\w*|skorupiak\w*|owoce morza|kabuklu\w*|karides\w*)/g],
  ['fish', /\b(fish|fisch\w*|pescado|poisson\w*|pesce|peixe|vis|ryb\w*|balik\w*)\b/g],
  ['celery', /\b(celery|sellerie|apio|celeri|sedano|aipo|selderij|seler\w*|kereviz)\b/g],
  ['mustard', /\b(mustard|senf|mostaza|moutarde|senape|mostarda|mosterd|musztard\w*|hardal)\b/g],
  ['sulphites', /\b(sulphites?|sulfites?|sulfit\w*|solfiti|sulfitos)\b/g],
]

/** Said before the food: "allergic to nuts", "no milk", "ohne Sesam", "sin gluten". */
const CUE_BEFORE = /(allerg\w*|alerg\w*|intoleran\w*|unvertrag\w*|vertrag\w*|\bno\b|\bnot\b|\bnon\b|\bnever\b|\bnothing\b|\bwithout\b|\bohne\b|\bkein\w*|\bnicht\w*|\bnix\b|\bavoid\w*|\bcan ?not\b|\bcan'?t\b|\bdon'?t\b|\bsin\b|\bsans\b|\bsenza\b|\bsem\b|\bgeen\b|\bzonder\b|\bbez\b|\bfree of\b|\bfrei von\b|حساسية|بدون)/
/** Said right after it: "nut allergy", "lactose intolerant", "Milch vertrage ich nicht", "gluten-free". */
const CUE_AFTER = /^[\s-]*(allerg\w*|alerg\w*|intoleran\w*|unvertrag\w*|free\b|frei\b|vertrag\w* (ich |i )?nicht|\w+ ?(ich |i )?(nicht|not)\b|yok\b)/
/** Part of the word itself: "Nussallergie", "glutenfrei", "laktoseintolerant". */
const CUE_INSIDE = /(allerg|alerg|intoleran|unvertrag|frei$|free$|siz$|suz$)/
/** A turn in the sentence: what follows is no longer part of the "no ..." list ("no meat but fish is fine"). */
const TURN = /.*\b(but|aber|however|though|pero|mais|ma|maar|ale|ama)\b/
const SENTENCE_END = /.*[.!?;\n]/

function allergiesIn(folded: string): AllergyId[] {
  const found = new Set<AllergyId>()
  for (const [id, rx] of FOODS) {
    rx.lastIndex = 0
    for (let m = rx.exec(folded); m; m = rx.exec(folded)) {
      const word = m[0]
      const before = folded.slice(Math.max(0, m.index - 64), m.index).replace(SENTENCE_END, '').replace(TURN, '')
      const after = folded.slice(m.index + word.length, m.index + word.length + 28)
      if (CUE_INSIDE.test(word) || CUE_BEFORE.test(before) || CUE_AFTER.test(after)) { found.add(id); break }
    }
  }
  return ALLERGY_IDS.filter((id) => found.has(id))
}

const NOT_DIET = /\b(not|nicht|kein\w*|no|non|pas|niet|nie)\s+(an?\s+|ein\w*\s+)?(vegan\w*|vegetar\w*|veggie)/g
const VEGAN = /\b(vegan\w*|vegetalien\w*|wegan\w*|plant.?based|pflanzlich\w*)/
const VEGETARIAN = /\b(vegetar\w*|veggie|vejetaryen|wegetar\w*)/
const NO_MEAT = /\b(no meat|kein fleisch|ohne fleisch|don'?t eat meat|sin carne|sans viande|senza carne|sem carne|geen vlees|bez miesa|et yemiyorum)\b/
const EVERYTHING = /\b(eat (everything|anything)|esse alles|ess alles|alles essen|no restrictions|keine einschrankung\w*|omnivor\w*|allesesser\w*|como de todo|mange de tout|mangio (di )?tutto|como tudo|eet alles|jem wszystko|her seyi yerim)\b/

function dietIn(folded: string, raw: string): Diet | null {
  const text = folded.replace(NOT_DIET, ' ')
  if (VEGAN.test(text) || /نباتي صرف/.test(raw)) return 'vegan'
  if (VEGETARIAN.test(text) || NO_MEAT.test(text) || /نباتي/.test(raw)) return 'vegetarian'
  if (EVERYTHING.test(text)) return 'any'
  return null
}

const LOSE = /\b(abnehm\w*|abzunehm\w*|lose (some )?(fat|weight)|losing (fat|weight)|weight loss|cutting|on a cut|on a diet|diat|low.?cal\w*|kalorienarm\w*|wenig kalorien|fewer calories|light|leicht\w*|adelgazar|bajar de peso|perder peso|perdre du poids|maigrir|dimagrire|perdere peso|emagrecer|afvallen|schudn\w*|kilo vermek|zayifla\w*)\b/
const MUSCLE = /\b(muskel\w*|muscle\w*|bulk\w*|protein\w*|eiweiss\w*|gains|aufbau\w*|musculo\w*|muscol\w*|spier\w*|miesn\w*|kas yap\w*)\b/
const BALANCED = /\b(balanced|ausgewogen\w*|equilibr\w*|evenwichtig\w*|dengeli)\b/

function goalIn(folded: string): GroupGoal | null {
  if (LOSE.test(folded)) return 'lose_fat'
  if (MUSCLE.test(folded)) return 'build_muscle'
  return BALANCED.test(folded) ? 'balanced' : null
}

const EURO = '(?:€|eur\\b|euro\\w*)'
const LIMIT = "(?:max\\w*|bis zu|bis|unter|under|up to|at most|hochstens|no more than|not more than|nicht mehr als|budget\\w*|limit\\w*|spend\\w*|ausgeben|hasta|jusqu.a|fino a|tot|en fazla)"
const NUMBER_WORDS: Record<string, number> = {
  five: 5, funf: 5, six: 6, sechs: 6, seven: 7, sieben: 7, eight: 8, acht: 8, nine: 9, neun: 9, ten: 10, zehn: 10, eleven: 11, elf: 11,
  twelve: 12, zwolf: 12, thirteen: 13, dreizehn: 13, fourteen: 14, vierzehn: 14, fifteen: 15, funfzehn: 15, sixteen: 16, sechzehn: 16,
  eighteen: 18, achtzehn: 18, twenty: 20, zwanzig: 20, funfundzwanzig: 25, thirty: 30, dreissig: 30, forty: 40, vierzig: 40, fifty: 50, funfzig: 50,
}
/** Money slang that needs no "euro" next to it. */
const SLANG: Record<string, number> = { fiver: 5, funfer: 5, tenner: 10, zehner: 10, zwanni: 20, zwanziger: 20 }
const WORDS = Object.keys(NUMBER_WORDS).join('|')
const BUDGET_PATTERNS: RegExp[] = [
  new RegExp(`(\\d{1,3})(?:[.,]\\d{1,2})?\\s*${EURO}`),
  new RegExp(`${EURO}\\s*(\\d{1,3})\\b`),
  new RegExp(`\\b${LIMIT}\\D{0,12}?(\\d{1,3})\\b`),
  new RegExp(`\\b(${WORDS})\\s*${EURO}`),
  new RegExp(`\\b${LIMIT}\\W{0,12}?(${WORDS})\\b`),
  new RegExp(`\\b(${Object.keys(SLANG).join('|')})\\b`),
]

function budgetIn(folded: string): number | null {
  for (const rx of BUDGET_PATTERNS) {
    const hit = rx.exec(folded)?.[1]
    if (!hit) continue
    const n = cleanBudget(/^\d/.test(hit) ? Number(hit) : NUMBER_WORDS[hit] ?? SLANG[hit])
    if (n !== null) return n
  }
  return null
}

const NAME = /(?:my name is|my name's|ich hei(?:ss|ß)e|me llamo|je m'appelle|mi chiamo|meu nome é|ik heet|mam na imię|benim adım|اسمي)\s+(\p{L}[\p{L}'’-]{1,20})/iu

/**
 * What a person said about their needs, by word rules alone. Only what was
 * said is filled in: "vegan, no nuts, max 10 euros" gives a diet, one allergy
 * and a budget, and leaves the goal alone.
 */
export function parseNeedsText(input: unknown): ParsedNeeds {
  const raw = typeof input === 'string' ? input.slice(0, MAX_NEEDS_TEXT) : ''
  const folded = foldText(raw).replace(/\s+/g, ' ')
  const needs: Partial<Needs> = {}
  const diet = dietIn(folded, raw)
  if (diet) needs.diet = diet
  const allergies = allergiesIn(folded)
  if (allergies.length) needs.allergies = allergies
  const goal = goalIn(folded)
  if (goal) needs.goal = goal
  const budget = budgetIn(folded)
  if (budget !== null) needs.budget = budget
  const said = NAME.exec(raw)?.[1]
  const name = said ? cleanName(said[0]!.toUpperCase() + said.slice(1)) : null
  return { needs, name, source: 'rules' }
}

/** Whether a number is in the person's own words, as digits ("10", "10,50 €" for 10). */
export function numeralSaid(text: string, n: number): boolean {
  return new RegExp(`(^|[^\\p{Nd}])${n}([^\\p{Nd}]|$)`, 'u').test(text.normalize('NFKC'))
}

/**
 * The model's reading on top of the word rules. Everything from the model is
 * checked against the fixed lists. Its budget counts only when that number is
 * in the text itself, so a number on screen is never one the model made up;
 * the same goes for a name.
 */
export function mergeModelNeeds(rules: ParsedNeeds, model: unknown, text: string): ParsedNeeds {
  if (!model || typeof model !== 'object') return rules
  const m = model as Record<string, unknown>
  const needs: Partial<Needs> = { ...rules.needs }
  if (m['diet'] === 'vegan' || m['diet'] === 'vegetarian' || m['diet'] === 'any') needs.diet = m['diet']
  if (m['goal'] === 'lose_fat' || m['goal'] === 'build_muscle' || m['goal'] === 'balanced') needs.goal = m['goal']
  const said = Array.isArray(m['allergies']) ? (m['allergies'] as unknown[]).filter((a): a is string => typeof a === 'string' && ALLERGY_SET.has(a)) : []
  const allergies = ALLERGY_IDS.filter((id) => said.includes(id) || (rules.needs.allergies ?? []).includes(id))
  if (allergies.length) needs.allergies = allergies
  if (needs.budget === undefined) {
    const b = cleanBudget(m['budget_eur'])
    if (b !== null && numeralSaid(text, b)) needs.budget = b
  }
  let name = rules.name
  if (!name && typeof m['name'] === 'string') {
    const n = cleanName(m['name'])
    if (n && text.toLowerCase().includes(n.toLowerCase())) name = n
  }
  return { needs, name, source: 'ai' }
}

/** "vegan · no nuts · max 10 €" pieces for one person, as ids the screen and the matcher both understand. */
export function hasLimits(n: Needs): boolean {
  return n.diet !== 'any' || n.allergies.length > 0 || n.budget !== null
}
