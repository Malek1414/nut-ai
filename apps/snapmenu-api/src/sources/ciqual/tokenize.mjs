/**
 * Shared by build.mjs (which stores search keys in the generated table) and the
 * runtime lookup (which tokenises the query the same way). Change anything here
 * and the table must be rebuilt; the test "stored search keys match the tokenizer"
 * fails until it is.
 */

const STOP = new Set([
  // French
  'de', 'du', 'des', 'la', 'le', 'les', 'au', 'aux', 'a', 'et', 'ou', 'en', 'avec', 'sans', 'par', 'ex', 'pour', 'd', 'l', 'un', 'une',
  // English
  'the', 'of', 'and', 'or', 'with', 'without', 'in', 'from', 'for', 'to', 'an', 'e', 'g', 'style', 'type',
  // German, Italian, Spanish
  'im', 'mit', 'und', 'vom', 'auf', 'nach', 'art', 'con', 'alla', 'al', 'di', 'del', 'y', 'el',
  // Sizes on a menu line: "0,5 l", "33 cl", "200 g"
  'cl', 'ml', 'kg', 'gr', 'stk', 'pcs',
])

/** Words that name a family, not a food: "Emmental cheese" is found by "emmental". */
export const GENERIC = new Set(['cheese', 'fromage', 'sausage', 'saucisse'])

/** Forms that are rarely what arrives on the plate; a match on them ranks lower. */
const OFF_PLATE = /(^| )(raw|cru|crue|crus|crues|a cuire|dried|seche|sechee|dehydrated|deshydrate|deshydratee|powder|poudre|frozen|surgele|surgelee|surgeles|surgelees)( |$)/

/** CIQUAL's own generic rows: "Croissant (average)", "(aliment moyen)". */
const AVERAGE = /(^| )(average|aliment moyen)( |$)/

const ASCII = /^[\x20-\x7e]*$/

/**
 * Lowercase ASCII words. Three French words collapse to "pate" once accents go,
 * so they are told apart first: pâté (charcuterie), pâtes (pasta), pâte (dough).
 */
export function normalize(s) {
  const lower = s.toLowerCase()
  if (ASCII.test(lower)) return lower.replace(/[^a-z0-9%]+/g, ' ').trim()
  return lower
    .replace(/pâtés?(?![a-zà-ÿ])/g, 'patecharcuterie')
    .replace(/pâtes(?![a-zà-ÿ])/g, 'pasta')
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/ß/g, 'ss')
    .replace(/ı/g, 'i')
    .replace(/ø/g, 'o')
    .replace(/ł/g, 'l')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim()
}

const singular = (t) =>
  t.length > 4 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t.length > 5 && t.endsWith('x') ? t.slice(0, -1) : t

/** Words that carry meaning: no filler words, no bare numbers or sizes ("0,5 l", "33cl"). */
export function tokens(s) {
  const out = []
  for (const t of normalize(s).split(' ')) {
    if (!t || STOP.has(t) || /^\d+[a-z]{0,2}$/.test(t)) continue
    const w = singular(t)
    if (!out.includes(w)) out.push(w)
  }
  return out
}

export const isOffPlate = (s) => OFF_PLATE.test(normalize(s))

/**
 * Search key of one name: "core words;other words". The core is the leading
 * part of the name (before the first comma or bracket) without family words.
 */
export function nameKey(name) {
  const all = tokens(name)
  const head = tokens(name.split(/[,(]/)[0] ?? name)
  const core = head.filter((t) => !GENERIC.has(t))
  const lead = core.length ? core : head
  return `${lead.join(' ')};${all.filter((t) => !lead.includes(t)).join(' ')}`
}

/** Bit 1: French name is an off-plate form. Bit 2: English name is. Bit 4: a CIQUAL "average" row. */
export function nameFlags(nameFr, nameEn) {
  return (isOffPlate(nameFr) ? 1 : 0) | (isOffPlate(nameEn) ? 2 : 0) | (AVERAGE.test(normalize(`${nameFr} ${nameEn}`)) ? 4 : 0)
}
