/**
 * The plain friend voice: one place for how Snapmenu talks to a person.
 *
 * Every sentence a person reads that the app makes up at run time goes through
 * this module: why a dish was picked, why one is under "Skip", the sentence for
 * the waiter and its translation, the reply after the interview, what a failed
 * scan says, and the community's hints. It holds four things:
 *
 *   1. VOICE_RULES   how the voice sounds. The fixed sentences in ./copy.ts are
 *                    written to these rules, and every model that writes text
 *                    for a person gets the same rules in its instructions.
 *   2. userLanguage  which language to talk in: the one saved in the interview,
 *                    else the phone's, as the web app sends it.
 *   3. say           a fixed sentence in that language. Numbers enter only
 *                    through placeholders, and only the engine fills them.
 *   4. modelWords    the gate for text a model wrote: it never carries a number
 *                    to the screen. Numbers on screen come from the Nut AI
 *                    engine alone.
 *
 * No imports from the Worker: the web app uses this file too.
 */
import { COPY, type CopyKey } from './copy.js'

export type { CopyKey }

// ---------- Language ----------

/** The languages the app talks in. `id` is what the interview saves and what a model is told; `tag` is the phone's code for it. */
export const LANGUAGES = [
  { id: 'English', tag: 'en', native: 'English' },
  { id: 'German', tag: 'de', native: 'Deutsch' },
  { id: 'Spanish', tag: 'es', native: 'Español' },
  { id: 'French', tag: 'fr', native: 'Français' },
  { id: 'Italian', tag: 'it', native: 'Italiano' },
  { id: 'Portuguese', tag: 'pt', native: 'Português' },
  { id: 'Turkish', tag: 'tr', native: 'Türkçe' },
  { id: 'Polish', tag: 'pl', native: 'Polski' },
  { id: 'Dutch', tag: 'nl', native: 'Nederlands' },
  { id: 'Arabic', tag: 'ar', native: 'العربية' },
] as const

export type Lang = (typeof LANGUAGES)[number]['id']
export const DEFAULT_LANGUAGE: Lang = 'English'

const fold = (s: string) => s.trim().toLowerCase()
const BY_NAME = new Map<string, Lang>(LANGUAGES.flatMap((l) => [[fold(l.id), l.id], [fold(l.native), l.id]]))
const BY_TAG = new Map<string, Lang>(LANGUAGES.map((l) => [l.tag, l.id]))

/** One of our languages from a name ("German", "Deutsch") or a locale ("de", "de-AT", "pt_BR"); null for anything else. */
export function toLang(value: unknown): Lang | null {
  if (typeof value !== 'string' || value.length > 40) return null
  const named = BY_NAME.get(fold(value))
  if (named) return named
  const m = /^([a-z]{2,3})(?:[-_][a-z0-9]{1,8})*$/i.exec(value.trim())
  return m ? BY_TAG.get(m[1]!.toLowerCase()) ?? null : null
}

/** The first of our languages in an Accept-Language header, best quality first. */
function fromAcceptLanguage(header: unknown): Lang | null {
  if (typeof header !== 'string' || header.length > 400) return null
  const wanted = header.split(',').map((part, i) => {
    const [tag = '', ...params] = part.trim().split(';')
    const q = Number(params.map((p) => /^\s*q=([0-9.]+)\s*$/.exec(p)?.[1]).find(Boolean) ?? 1)
    return { tag, q: Number.isFinite(q) ? q : 0, i }
  })
  wanted.sort((a, b) => b.q - a.q || a.i - b.i)
  for (const w of wanted) {
    const l = toLang(w.tag)
    if (l) return l
  }
  return null
}

/**
 * The language to talk to this person in. In order:
 *   1. `saved`: the language they chose in the interview (the profile);
 *   2. `locale`: the phone's language, sent by the web app (navigator.language);
 *   3. `acceptLanguage`: the browser's Accept-Language header;
 *   4. English.
 */
export function userLanguage(from: { saved?: unknown; locale?: unknown; acceptLanguage?: unknown }): Lang {
  return toLang(from.saved) ?? toLang(from.locale) ?? fromAcceptLanguage(from.acceptLanguage) ?? DEFAULT_LANGUAGE
}

/** Menus come in more languages than the app talks in; the model names the menu's language in English. */
const MENU_TAGS: Record<string, string> = {
  greek: 'el', russian: 'ru', ukrainian: 'uk', czech: 'cs', slovak: 'sk', hungarian: 'hu', romanian: 'ro', bulgarian: 'bg', croatian: 'hr',
  serbian: 'sr', slovenian: 'sl', bosnian: 'bs', albanian: 'sq', danish: 'da', swedish: 'sv', norwegian: 'no', finnish: 'fi', icelandic: 'is',
  estonian: 'et', latvian: 'lv', lithuanian: 'lt', catalan: 'ca', basque: 'eu', galician: 'gl', japanese: 'ja', chinese: 'zh', korean: 'ko',
  vietnamese: 'vi', thai: 'th', hindi: 'hi', hebrew: 'he', persian: 'fa', indonesian: 'id', malay: 'ms',
}

/** A language name ("Italian", "Greek") as a language code ("it", "el") for `lang` attributes and read-aloud; null when unknown. */
export function languageTag(name: unknown): string | null {
  if (typeof name !== 'string') return null
  const known = toLang(name)
  if (known) return LANGUAGES.find((l) => l.id === known)!.tag
  // "Swiss German" or "Brazilian Portuguese" still read aloud as German or Portuguese.
  for (const word of fold(name).split(/[^a-z]+/).reverse()) {
    const lang = toLang(word)
    if (lang) return LANGUAGES.find((l) => l.id === lang)!.tag
    if (MENU_TAGS[word]) return MENU_TAGS[word]!
  }
  return null
}

/** Whether two language names mean the same language. */
export function sameLanguage(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const ta = languageTag(a)
  return ta ? ta === languageTag(b) : fold(a) === fold(b) && fold(a) !== ''
}

// ---------- Rules ----------

/**
 * How Snapmenu sounds. ./copy.ts is written to these rules by hand; a model that
 * writes for a person gets them word for word (see `voicePrompt`).
 */
export const VOICE_RULES = [
  'Sound like a friend who knows food: warm, direct and relaxed.',
  'Keep it short: everyday words, one or two short sentences.',
  'No jargon and no numbers-speak. Say "protein", "calories", "filling", "light", "heavy". Never "macros", "caloric density", "protein share" or "satiety".',
  'Never preach, judge or warn. No "should", no guilt, no health or medical claims.',
  'Write the way people really speak the language, with the informal "you" where the language has one.',
  'No exclamation marks, no emoji, no em dashes.',
] as const

/** The one rule that is only for models: the engine owns every number. */
export const NO_NUMBERS_RULE =
  'Write no numbers at all, not even spelled out: no amounts, weights, calories, grams or percentages. The app shows every number itself, from its food database.'

/** The rules as a block for a model's instructions. */
export const voicePrompt = (): string => [...VOICE_RULES, NO_NUMBERS_RULE].map((r) => `- ${r}`).join('\n')

// ---------- Numbers: only the engine's ----------

const DIGITS = /\p{N}+/gu
const digitRuns = (s: string) => s.normalize('NFKC').match(DIGITS) ?? []

/**
 * A sentence a model wrote, as it may be shown to a person: the text itself
 * when it carries no numeral, otherwise null (the caller then uses the fixed
 * sentence or leaves the line out).
 *
 * `printed` is text the menu itself prints, such as the dish name: a numeral
 * that is part of it ("Pizza 4 Formaggi") may be repeated, nothing else.
 */
export function modelWords(text: unknown, printed = '', maxLength = 240): string | null {
  if (typeof text !== 'string') return null
  const clean = text.replace(/\s+/g, ' ').replace(/ ?— ?| – /g, ', ').trim()
  if (!clean || clean.length > maxLength) return null
  if (/[%‰٪]/.test(clean)) return null
  const allowed = new Set(digitRuns(printed))
  return digitRuns(clean).every((n) => allowed.has(n)) ? clean : null
}

const UNIT = '(?:kcal|kj|cal(?:orie[sn]?|or[ií]as?)?|kalori(?:en|e|i)?|g|gr|gram(?:m|me|mes|s|os)?|mg|kg|ml|cl|dl|l|oz|lb|%)'
const AMOUNT = new RegExp(
  `(?:\\b(?:ca\\.?|approx\\.?|about|around|circa|etwa|env\\.?)\\s*|[~≈]\\s*)?\\p{Nd}+(?:[.,]\\p{Nd}+)?(?:\\s*[-–]\\s*\\p{Nd}+(?:[.,]\\p{Nd}+)?)?\\s*${UNIT}(?![\\p{L}\\p{Nd}])`,
  'giu',
)

/**
 * Text the reading model wrote about a dish (a description, an allergy reason,
 * why a photo is not a menu) with every amount taken out: "250 g", "450 kcal",
 * "0,5 l", "30%". The menu may print a weight, but an amount on screen has to
 * be the engine's, so a printed one never travels through the model's prose.
 */
export function noAmounts(text: unknown): string {
  if (typeof text !== 'string') return ''
  return text
    .replace(AMOUNT, ' ')
    .replace(/\(\s*[,;:]?\s*\)/g, ' ')
    .replace(/\s+([,.;:!?)])/g, '$1')
    .replace(/([,;:])(?=\s*[,;:.])/g, '')
    .replace(/\(\s+/g, '(')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,;:.\-–]+/, '')
    .trim()
}

// ---------- Fixed sentences ----------

// The same grouping the screen uses for its own numbers (apps/snapmenu-web/src/lib/format.ts).
const NUMBER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

/**
 * A fixed sentence in the person's language (English when we do not talk theirs).
 * `vars` fill the {placeholders}: a number is one the engine computed, formatted
 * here; a string is a name (an allergen, a word from the menu).
 */
export function say(lang: unknown, key: CopyKey, vars: Record<string, string | number> = {}): string {
  const table = COPY[toLang(lang) ?? DEFAULT_LANGUAGE]
  return table[key].replace(/\{(\w+)\}/g, (_m, name: string) => {
    const v = vars[name]
    return typeof v === 'number' ? NUMBER.format(v) : v ?? ''
  })
}

/** An allergen in everyday words: "nuts", "Sesam", "fruits à coque". */
export function allergenName(lang: unknown, allergen: string): string {
  const key = `allergen.${allergen}`
  return key in COPY.English ? say(lang, key as CopyKey) : allergen.replace(/_/g, ' ')
}

const ERRORS: Record<string, [title: CopyKey, message: CopyKey]> = {
  offline: ['error.offline.title', 'error.offline'],
  not_menu: ['error.not_menu.title', 'error.not_menu'],
  rate_limited: ['error.busy.title', 'error.busy'],
  too_big: ['error.too_big.title', 'error.too_big'],
  no_key: ['error.setup.title', 'error.setup'],
  auth: ['error.setup.title', 'error.setup'],
  refusal: ['error.generic.title', 'error.unreadable'],
  connection: ['error.generic.title', 'error.connection'],
  no_image: ['error.generic.title', 'error.no_photo'],
  photo: ['error.photo.title', 'error.photo'],
  oops: ['error.oops.title', 'error.oops'],
}

/** What a failed scan says, by error code. An unknown code gets the general "could not read the menu". */
export function errorText(lang: unknown, code: string): { title: string; message: string } {
  const [title, message] = ERRORS[code] ?? (['error.generic.title', 'error.generic'] as const)
  return { title: say(lang, title), message: say(lang, message) }
}

/** The short reply after the interview: what the app will look for, and that allergies are watched. */
export function interviewReply(profile: { goal: string; plantStyle?: string | undefined; allergies: readonly string[]; language?: unknown }, lang: unknown = profile.language): string {
  const choice = profile.goal === 'plant_based' ? (profile.plantStyle === 'vegetarian' ? 'vegetarian' : 'vegan') : profile.goal
  const key = `interview.${choice}`
  const first = say(lang, (key in COPY.English ? key : 'interview.balanced') as CopyKey)
  return profile.allergies.length > 0 ? `${first} ${say(lang, 'interview.allergies')}` : first
}
