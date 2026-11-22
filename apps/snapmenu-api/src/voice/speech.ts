/**
 * Voice messages: the parts that are plain logic, shared by the Worker and the
 * web app (apps/snapmenu-web/src/voice).
 *
 *   speechLocale        which locale to listen and read aloud in
 *   clock               "0:07"
 *   understandInterview a spoken interview answer as a goal and allergies
 *
 * No imports from the Worker and no browser APIs: this file runs in both.
 */
import { LANGUAGES, toLang, type Lang } from './index.js'

// ---------- Language ----------

/** The region a language is spoken with when the phone does not say one. The app is used in Europe. */
const REGION: Record<Lang, string> = {
  English: 'en-GB', German: 'de-DE', Spanish: 'es-ES', French: 'fr-FR', Italian: 'it-IT',
  Portuguese: 'pt-PT', Turkish: 'tr-TR', Polish: 'pl-PL', Dutch: 'nl-NL', Arabic: 'ar-SA',
}

/** The two-letter code of one of our languages ("de"), for the chat reply. */
export const languageCode = (lang: unknown): string => LANGUAGES.find((l) => l.id === (toLang(lang) ?? 'English'))!.tag

/**
 * The locale to listen in and to read aloud in ("de-AT"): the user's language,
 * with the phone's own region when the phone speaks that language, else the
 * usual one. A German speaker in Vienna is heard as de-AT, an English phone
 * with the app set to German as de-DE.
 */
export function speechLocale(lang: unknown, phoneLocale?: unknown): string {
  const id = toLang(lang) ?? 'English'
  if (typeof phoneLocale === 'string' && toLang(phoneLocale) === id) {
    const m = /^([a-z]{2,3})[-_]([a-z]{2}|\d{3})$/i.exec(phoneLocale.trim())
    if (m) return `${m[1]!.toLowerCase()}-${m[2]!.toUpperCase()}`
  }
  return REGION[id]
}

export const VOICE_MESSAGE_SECONDS = 60

/** A duration as a voice note shows it: "0:07", "1:02". */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// ---------- The interview, spoken ----------

export type InterviewChoice = 'lose_fat' | 'build_muscle' | 'balanced' | 'vegan' | 'vegetarian'

/** Lower case, no accents: "Nüsse" and "nusse" are the same word to the matcher. */
export function foldSpeech(text: string): string {
  return text
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/ı/g, 'i')
    .replace(/ł/g, 'l')
    .replace(/œ/g, 'oe')
    .normalize('NFD')
    // Accents, and the Arabic marks: vowel signs and the hamza or madda that NFD takes off a letter ("أ" reads as "ا").
    .replace(/[\u0300-\u036f\u064b-\u065f\u0670]/g, '')
}

/**
 * Words people use, in the app's ten languages. An entry is one word ("nuts"),
 * the start of a word ("abnehm*" also finds "abnehmen"), or a phrase ("lose weight").
 */
const GOAL_WORDS: Array<[InterviewChoice, string[]]> = [
  ['vegan', ['vegan*', 'plant based', 'plantbased', 'pflanzlich*', 'vegetalien*', 'weganin*', 'weganskie*', 'نباتي صرف', 'فيغان', 'veganist*']],
  ['vegetarian', ['vegetari*', 'veggie', 'vegetar*', 'vegetarier*', 'wegetarian*', 'vejetaryen*', 'vejeteryan*', 'نباتي', 'نباتية', 'no meat', 'kein fleisch', 'sin carne', 'sans viande', 'senza carne', 'sem carne', 'geen vlees', 'bez miesa', 'et yemiyorum']],
  ['lose_fat', [
    'lose', 'losing', 'cut', 'cutting', 'slim*', 'lean*', 'diet', 'dieting', 'lighter', 'weight loss', 'fat loss', 'fewer calories', 'less calories', 'low calorie',
    'abnehm*', 'abspecken', 'abzunehmen', 'diat', 'definier*', 'gewicht verlier*', 'fett verlier*', 'weniger kalorien', 'kalorienarm*',
    'adelgaz*', 'bajar de peso', 'perder peso', 'perder grasa', 'menos calorias',
    'maigrir', 'mincir', 'perdre du poids', 'perdre du gras', 'regime', 'moins de calories',
    'dimagr*', 'perdere peso', 'perdere grasso', 'meno calorie',
    'emagrec*', 'perder gordura',
    'kilo ver*', 'zayifla*', 'yag yak*', 'diyet*',
    'schud*', 'odchudz*', 'zrzucic*', 'mniej kalorii',
    'afvallen', 'gewicht verliezen', 'vet verliezen', 'minder calorieen', 'afslanken',
    'انقاص', 'تخسيس', 'تنحيف', 'اخسر', 'انحف', 'خساره الوزن', 'خسارة الوزن', 'رجيم',
  ]],
  ['build_muscle', [
    'muscle*', 'bulk', 'bulking', 'gain*', 'gains', 'protein', 'stronger', 'strength',
    'muskel*', 'aufbau*', 'zunehmen', 'eiweiss', 'masseaufbau', 'kraft',
    'muscul*', 'ganar', 'proteina*', 'volumen',
    'prise de masse', 'proteine*', 'prendre du muscle',
    'muscol*', 'mettere massa',
    'ganhar', 'hipertrofia',
    'kas', 'kaslan*', 'kas yap*', 'kilo al*', 'hacim',
    'miesn*', 'bialk*', 'przytyc',
    'spier*', 'aankomen', 'eiwit*',
    'عضل', 'عضلات', 'بناء العضلات', 'تضخيم', 'بروتين',
  ]],
  ['balanced', [
    'balanced', 'balance', 'healthy', 'normal', 'nothing special', 'maintain*', 'everything',
    'ausgewogen*', 'gesund*', 'ganz normal', 'halten',
    'equilibr*', 'sano', 'sana', 'saludable', 'sain', 'saine', 'saudavel', 'mantener', 'mantenere', 'manter',
    'dengeli', 'saglikli', 'zdrow*', 'zbilansowan*', 'gezond', 'evenwichtig', 'gebalanceerd',
    'متوازن', 'صحي', 'عادي',
  ]],
]

/** The allergy ids of the interview (apps/snapmenu-web/src/lib/format.ts ALLERGY_OPTIONS) and the words for them. */
const ALLERGY_WORDS: Array<[string, string[]]> = [
  ['peanuts', ['peanut*', 'erdnuss*', 'erdnusse*', 'cacahuete*', 'cacahuate*', 'mani', 'arachide*', 'arachidi', 'amendoim', 'amendoins', 'yer fistigi', 'fistik', 'orzeszki ziemne', 'orzeszk*', 'arachidow*', 'pinda*', 'فول سوداني', 'سوداني']],
  ['tree_nuts', [
    'nut', 'nuts', 'tree nuts', 'almond*', 'hazelnut*', 'walnut*', 'cashew*', 'pistachio*',
    'nuss*', 'nusse*', 'haselnuss*', 'walnuss*', 'mandel*', 'schalenfrucht*',
    'nuez', 'nueces', 'frutos secos', 'almendra*', 'avellana*',
    'noix', 'noisette*', 'amande*', 'fruits a coque',
    'noci', 'noce', 'nocciol*', 'mandorl*', 'frutta a guscio',
    'nozes', 'noz', 'amendoa*', 'avela*',
    'kuruyemis*', 'findik', 'ceviz', 'badem',
    'orzech', 'orzechy', 'orzechow*', 'migdal*',
    'noten', 'noot', 'amandel*', 'hazelnoot*', 'walnoot*',
    'مكسرات', 'جوز', 'لوز', 'بندق',
  ]],
  ['gluten', ['gluten*', 'wheat', 'celiac', 'coeliac', 'weizen*', 'zoliakie', 'trigo', 'celiac*', 'ble', 'froment', 'grano', 'frumento', 'tarwe', 'pszenic*', 'bugday', 'جلوتين', 'غلوتين', 'قمح']],
  ['milk', ['milk', 'lactose', 'dairy', 'milch*', 'laktose*', 'lactos*', 'leche', 'lacteos', 'lait', 'laitier*', 'latte', 'lattosio', 'latticini', 'leite', 'laticinios', 'sut', 'laktoz', 'mleko', 'mleka', 'nabial*', 'melk', 'zuivel', 'حليب', 'لبن', 'لاكتوز', 'البان']],
  ['eggs', ['egg', 'eggs', 'ei', 'eier', 'eiern', 'huevo*', 'oeuf*', 'uovo', 'uova', 'ovo', 'ovos', 'yumurta*', 'jajk*', 'jaj', 'eieren', 'بيض']],
  ['sesame', ['sesam*', 'tahin*', 'susam', 'sezam*', 'gergelim', 'سمسم', 'طحينه', 'طحينة']],
  ['soy', ['soy', 'soya', 'soja*', 'soia', 'tofu', 'صويا', 'سويا']],
  ['shellfish', [
    'shellfish', 'seafood', 'shrimp*', 'prawn*', 'crab*', 'lobster*', 'mussel*', 'crustacean*',
    'schalentier*', 'krebstier*', 'meeresfrucht*', 'meeresfruchte*', 'garnele*', 'muschel*',
    'marisco*', 'gamba*', 'crustaceo*', 'fruits de mer', 'crustace*', 'crevette*', 'crostacei', 'frutti di mare', 'gamber*', 'camarao', 'camaroes',
    'kabuklu*', 'karides', 'deniz urun*', 'skorupiak*', 'owoce morza', 'krewetk*', 'schaaldier*', 'zeevruchten', 'garnalen', 'garnaal',
    'قشريات', 'جمبري', 'ماكولات بحريه', 'مأكولات بحرية', 'محار',
  ]],
  ['fish', ['fish', 'fisch', 'pescado', 'poisson', 'pesce', 'peixe', 'balik', 'ryba', 'ryby', 'ryb', 'vis', 'سمك', 'اسماك']],
  ['celery', ['celery', 'sellerie', 'apio', 'celeri', 'sedano', 'aipo', 'salsao', 'kereviz', 'seler', 'selera', 'selderij', 'كرفس']],
  ['mustard', ['mustard', 'senf', 'mostaza', 'moutarde', 'senape', 'mostarda', 'hardal', 'musztard*', 'gorczyc*', 'mosterd', 'خردل']],
  ['sulphites', ['sulphite*', 'sulfite*', 'sulfit*', 'sulfito*', 'solfiti', 'siarczyn*', 'sulfiet*', 'كبريتيت', 'سلفيت']],
]

/**
 * "soy" is the bean in English and "I am" in Spanish ("soy alérgico a los mariscos").
 * Next to one of these Spanish words it is the verb; a Spanish speaker's bean is "soja" or "soya".
 */
const SPANISH_WORDS = [
  'alergi*', 'quiero', 'tengo', 'vegano', 'vegana', 'vegetariano', 'vegetariana', 'intolerante', 'celiaco', 'celiaca', 'diabetico', 'diabetica',
  'deportista', 'yo', 'muy', 'pero', 'tambien', 'peso', 'grasa', 'musculo*', 'ganar', 'perder', 'bajar', 'adelgaz*', 'comer', 'como',
  'nada', 'ningun*', 'de', 'del', 'el', 'la', 'los', 'las', 'al', 'un', 'una', 'que', 'y', 'mi', 'mis', 'es', 'en', 'con', 'por', 'para',
]

/** Arabic glues "the", "and the", "with the" and "for the" onto a word ("السوداني", "والسمسم", "للسمك"); the lists hold the bare word. */
const bareArabic = (word: string): string => word.replace(/^(?:[\u0648\u0641\u0628\u0643]?\u0627\u0644|\u0644\u0644)(?=[\u0621-\u064a]{2})/, '')

function matcher(text: string): (entry: string) => boolean {
  const words = foldSpeech(text).split(/[^\p{L}]+/u).filter(Boolean)
  // Every word as it was said and without an Arabic article; for other languages the two are the same.
  const forms = [words, words.map(bareArabic)]
  const lines = forms.map((list) => ` ${list.join(' ')} `)
  return (raw) => {
    const entry = foldSpeech(raw)
    const prefix = entry.endsWith('*')
    const body = prefix ? entry.slice(0, -1) : entry
    if (body.includes(' ')) return lines.some((line) => line.includes(prefix ? ` ${body}` : ` ${body} `))
    return forms.some((list) => (prefix ? list.some((w) => w.startsWith(body)) : list.includes(body)))
  }
}

/**
 * What a spoken interview answer says: the goal (null when none was named) and
 * the allergies that were named. "Ich will abnehmen und vertrage keine Nüsse"
 * is lose_fat with tree_nuts. A diet (vegan, vegetarian) wins over a goal,
 * because it rules dishes out; the profile holds one choice.
 */
export function understandInterview(text: unknown): { choice: InterviewChoice | null; allergies: string[] } {
  if (typeof text !== 'string' || !text.trim()) return { choice: null, allergies: [] }
  const has = matcher(text.slice(0, 600))
  const choice = GOAL_WORDS.find(([, words]) => words.some(has))?.[0] ?? null
  // "soy" next to Spanish words is the verb, not the bean.
  const iAm = SPANISH_WORDS.some(has)
  const allergies = ALLERGY_WORDS.filter(([id, words]) => words.some((w) => has(w) && !(iAm && id === 'soy' && w === 'soy'))).map(([id]) => id)
  return { choice, allergies }
}
