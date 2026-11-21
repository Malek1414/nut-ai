/**
 * What a restaurant's own website says about seed oils, read conservatively.
 *
 * Two steps, both pure: the visible text of an HTML page, and a search of that
 * text for an explicit statement. "Seed oil free", "ohne Saatenöle", "sin aceites
 * de semillas" count as the restaurant saying it cooks without them; "fried in
 * sunflower oil", "in Rapsöl frittiert" count as it saying it cooks with one.
 * Everything else is no statement at all: a page that praises its beef tallow
 * says nothing about seed oils, a question is not a claim, a negated sentence is
 * not a claim, and a page that says both things is taken to say neither.
 *
 * What is found is a quote from the restaurant, to be shown as a quote with its
 * source. It is never a fact the app states itself.
 *
 * Pure and without imports.
 */

// ---------- HTML to text ----------

const ENTITIES: Record<string, string> = {
  amp: '&', nbsp: ' ', quot: '"', apos: "'", lt: '<', gt: '>', shy: '',
  auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß',
  eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë', agrave: 'à', aacute: 'á', acirc: 'â',
  iacute: 'í', igrave: 'ì', icirc: 'î', iuml: 'ï', oacute: 'ó', ograve: 'ò', ocirc: 'ô',
  uacute: 'ú', ugrave: 'ù', ucirc: 'û', ccedil: 'ç', ntilde: 'ñ',
  ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', laquo: '«', raquo: '»',
  middot: '·', bull: '•', euro: '€', copy: '©', reg: '®', trade: '™', deg: '°',
}

const decodeEntities = (s: string): string =>
  s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8}\d{0,2});/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X'
      const code = hex ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' '
    }
    return ENTITIES[body] ?? ENTITIES[body.toLowerCase()] ?? whole
  })

const BLOCK_TAGS = 'p|div|br|li|ul|ol|h[1-6]|tr|td|th|table|section|article|header|footer|nav|main|aside|blockquote|figure|figcaption|dd|dt|dl|form|option|button|hr|title'
const BLOCK_TAG = new RegExp(`</?(?:${BLOCK_TAGS})\\b[^>]*>`, 'gi')

/**
 * Visible text of an HTML page: script/style/noscript/svg/head removed, tags
 * stripped, basic entities decoded, whitespace collapsed, cut at `max` chars.
 * One newline stays between blocks (paragraphs, headings, list items), so a
 * heading and the paragraph under it are not read as one sentence.
 */
export function htmlToText(html: string, max = 200_000): string {
  if (typeof html !== 'string' || !html) return ''
  const text = decodeEntities(
    (html.length > 2_000_000 ? html.slice(0, 2_000_000) : html)
      .replace(/<!--[\s\S]*?(?:-->|$)/g, ' ')
      .replace(/<(script|style|noscript|svg|head|template)\b[\s\S]*?(?:<\/\1\s*>|$)/gi, ' ')
      .replace(BLOCK_TAG, '\n')
      .replace(/<[^>]*>/g, ' '),
  )
    // Soft hyphens and zero-width characters split long words ("Saaten­öl­frei").
    .replace(/[­​-‍﻿]/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n[ \n]*/g, '\n')
    .trim()
  return text.length > max ? text.slice(0, max) : text
}

// ---------- Statements ----------

export interface SeedOilMention {
  claim: 'free' | 'uses'
  /** The sentence around the match, whitespace collapsed, at most 180 chars, with an ellipsis "…" where it was cut. */
  quote: string
}

// A statement always names seed oils. The page is searched for those names once, and the
// patterns below only run on the sentences around them: a long page costs one pass.
/** Seed oils as such, the way every "free" pattern names them. */
const FREE_HINT = 'seed[\\s-]*oil|(?:saaten|samen)[\\s-]*(?:ö|oe)l|aceites?\\s+(?:vegetal(?:es)?\\s+)?de\\s+semillas?|huiles?\\s+de\\s+graines?|oli[io]?\\s+di\\s+semi'
/** A seed oil by name, the way every "uses" pattern names one ("olive oil" alone is not one). */
const OIL_HINT = '(?:seed|sunflower|rapeseed|canola|soy(?:a|bean)?|corn|vegetable|cottonseed|safflower|grape\\s?seed|rice\\s?bran)[\\s-]*oil|(?:saaten|samen|sonnenblumen|raps|soja|mais(?:keim)?|distel|traubenkern|pflanzen)[\\s-]*(?:ö|oe)l|aceite\\s+(?:vegetal|de\\s)|huile\\s+(?:v[ée]g|de\\s)|olio\\s+(?:vegetale|di\\s)'
const CANDIDATE = `${FREE_HINT}|${OIL_HINT}`
const HAS_FREE_HINT = new RegExp(FREE_HINT, 'iu')
const HAS_OIL_HINT = new RegExp(OIL_HINT, 'iu')
/**
 * A page with more sentences about seed oils than this is a shop or an article, not a
 * restaurant talking about its kitchen: we claim nothing. It also bounds the work on a
 * page built to be slow.
 */
const MAX_CANDIDATES = 40

/** "The kitchen cooks without seed oils", said outright. */
const FREE: RegExp[] = [
  // English: "seed oil free", "seed-oil-free"
  /seed[\s-]*oils?[\s-]*free/iu,
  // "no seed oils", "without seed oils", "free of seed oils", "zero seed oils", "we never use seed oils", "we don't cook with seed oils"
  /(?:\bno|\bzero|\bwithout|\bfree\s+(?:of|from)|\bnever\s+(?:use|cook\s+with|fry\s+(?:in|with))|(?:\bdo\s+not|\bdon['’]?t|\bdoes\s+not|\bdoesn['’]?t)\s+(?:use|cook\s+with|fry\s+(?:in|with)))\s+(?:any\s+|all\s+|industrial\s+|refined\s+|processed\s+|inflammatory\s+|harmful\s+){0,2}(?:[a-z]+\s+(?:or|and|nor)\s+)?seed[\s-]*oils?\b/iu,
  // German: "saatenölfrei", "samenölfrei"
  /(?:saaten|samen)[\s-]*(?:ö|oe)l[\s-]*frei/iu,
  // "ohne Saatenöle", "keine Samenöle", "frei von Saatenölen", "wir verzichten auf Saatenöle"
  /(?:ohne|keine?|keinerlei|frei\s+von|verzichten\s+(?:\p{L}+\s+){0,3}?auf)\s+(?:industrielle[nr]?\s+|raffinierte[nr]?\s+|jegliche\s+){0,2}(?:saaten|samen)[\s-]*(?:ö|oe)le?n?(?!\p{L})/iu,
  // Spanish: "sin aceites de semillas", "libre de aceites de semillas", "no usamos aceites de semillas"
  /(?:sin|libres?\s+de|cero|no\s+(?:usamos|utilizamos|cocinamos\s+con|fre[ií]mos\s+(?:en|con)))\s+(?:ning[uú]n\s+)?aceites?\s+(?:vegetal(?:es)?\s+)?de\s+semillas?(?!\p{L})/iu,
  // French: "sans huiles de graines", "aucune huile de graines", "pas d'huile de graines"
  /(?:sans|z[ée]ro|aucune?s?|pas\s+d['’]\s?|jamais\s+d['’]\s?)\s*huiles?\s+de\s+graines?(?!\p{L})/iu,
  // Italian: "senza oli di semi", "non usiamo olio di semi"
  /(?:senza|zero|niente|non\s+(?:usiamo|utilizziamo)(?:\s+mai)?)\s+(?:alcun\s+)?oli[io]?\s+di\s+semi(?!\p{L})/iu,
]

const OIL_EN = '(?:seed|sunflower|rapeseed|canola|soy(?:a|bean)?|corn|vegetable|cottonseed|safflower|grape\\s?seed|rice\\s?bran)[\\s-]*oils?'
const OIL_DE = '(?:saaten|samen|sonnenblumen|raps|soja|mais(?:keim)?|distel|traubenkern|pflanzen)[\\s-]*(?:ö|oe)l(?:e|en|s)?'
const WORD_EN = "[a-z%0-9'’-]+"
const WORD = '[\\p{L}%0-9-]+'

/** "The kitchen cooks or fries with a seed oil", said outright: a cooking word and the oil in one sentence. */
const USES: RegExp[] = [
  // English: "fried in sunflower oil", "cooked with canola oil", "we fry in rapeseed oil"
  new RegExp(`\\b(?:(?:deep[\\s-]?)?fr(?:y|ies|ied|ying)|cook(?:s|ed|ing)?|saut[ée]e?d?|roast(?:ed|ing)?|prepared?|made)\\s+(?:${WORD_EN}\\s+){0,3}?(?:in|with|using)\\s+(?:${WORD_EN}\\s+){0,3}?${OIL_EN}\\b`, 'iu'),
  // "we use sunflower oil"
  new RegExp(`\\b(?:we|our\\s+(?:kitchen|chefs?|fryers?))\\s+(?:only\\s+|always\\s+|proudly\\s+)?uses?\\s+(?:${WORD_EN}\\s+){0,3}?${OIL_EN}\\b`, 'iu'),
  // German: "in Rapsöl frittiert", "mit Sonnenblumenöl zubereitet"
  new RegExp(`(?:^|[^\\p{L}])(?:in|mit)\\s+(?:${WORD}\\s+){0,2}?${OIL_DE}\\s+(?:${WORD}\\s+){0,2}?(?:frit{1,2}iert|gebraten|ausgebacken|gebacken|zubereitet|gegart|gekocht)`, 'iu'),
  // "frittiert in Sonnenblumenöl", "wir frittieren mit Rapsöl", "wir verwenden Rapsöl"
  new RegExp(`(?:^|[^\\p{L}])(?:frit{1,2}ier\\p{L}*|brat\\p{L}*|gebraten|ausgebacken|zubereitet|gegart|koch\\p{L}*|verwende\\p{L}*|benutz\\p{L}*|nutz\\p{L}*)\\s+(?:${WORD}\\s+){0,3}?(?:(?:in|mit)\\s+)?(?:${WORD}\\s+){0,2}?${OIL_DE}(?!\\p{L})`, 'iu'),
  // Spanish: "frito en aceite de girasol"
  /(?:frit[oa]s?|fre[ií]mos|fr[ií]e\p{L}*|cocina(?:mos|d[oa]s?)|elaborad[oa]s?)\s+(?:\p{L}+\s+){0,2}?(?:en|con)\s+aceite\s+(?:vegetal|de\s+(?:girasol|soja|ma[ií]z|colza|canola|semillas))/iu,
  // French: "frites cuites dans l'huile de tournesol"
  /(?:frit(?:e|es|s)?|friture|cuit(?:e|es|s)?|cuisin\p{L}*)\s+(?:\p{L}+\s+){0,2}?(?:dans|à|a|avec)\s+(?:de\s+)?l['’]\s?huile\s+(?:v[ée]g[ée]tale|de\s+(?:tournesol|colza|soja|ma[iï]s|graines?))/iu,
  // Italian: "fritto in olio di semi di girasole"
  /(?:fritt[oiae]|friggiamo|cott[oiae]|cuciniamo)\s+(?:\p{L}+\s+){0,2}?(?:in|con|nell['’])\s*olio\s+(?:vegetale|di\s+(?:semi|girasole|mais|soia|colza))/iu,
]

/** Anything here near a "uses" match means the sentence may say the opposite: then it is no statement. A miss is fine, a wrong claim is not. */
const NEGATION = /(?:^|[^\p{L}])(?:no|not|never|none|without|nor|neither|instead|rather|free|don['’]?t|doesn['’]?t|won['’]?t|isn['’]?t|aren['’]?t|kein\p{L}*|nicht|nie|niemals|ohne|statt|anstatt|anstelle|weder|frei|sin|nunca|jam[aá]s|ni|sans|jamais|pas|aucune?|ne|non|senza|mai|invece)(?!\p{L})|n['’]t(?!\p{L})|(?:^|[^\p{L}])n['’]\p{L}/iu
/** "not seed oil free", "nicht ganz saatenölfrei": a denial in front of a "free" match. */
const DENIED_BEFORE = /(?:(?:^|[^\p{L}])(?:not|never|nicht|nie|kaum|hardly)|n['’]t)\s+(?:\p{L}+\s+){0,2}$/iu
/** "seed oil free is not something we promise": a denial right after it. */
const DENIED_AFTER = /^[^.!?]{0,25}?(?:(?:^|[^\p{L}])(?:not|nicht)(?!\p{L})|n['’]t(?!\p{L}))/iu

/** Whether the character at `i` ends a sentence: a line break (headings and list items rarely have a full stop), or . ! ? … in front of white space or the end. */
function endsSentence(text: string, i: number): boolean {
  const c = text[i]
  if (c === '\n') return true
  if (c !== '.' && c !== '!' && c !== '?' && c !== '…') return false
  const next = text[i + 1]
  return next === undefined || next === ' ' || next === '\n' || next === '\t' || next === '\r'
}

/** How far a sentence is followed from a seed-oil name, each way: text without a single full stop must not cost the whole page. */
const REACH = 300

/**
 * The sentence around a position, white space collapsed, and where it ends in the text.
 * A side that was cut at REACH is cut at a word and marked with an ellipsis.
 */
function sentenceAround(text: string, index: number): { sentence: string; end: number } {
  let start = index
  while (start > 0 && index - start < REACH && !endsSentence(text, start - 1)) start -= 1
  let end = index
  while (end < text.length && end - index < REACH && !endsSentence(text, end)) end += 1
  const cutStart = start > 0 && !endsSentence(text, start - 1)
  const cutEnd = end < text.length && !endsSentence(text, end)
  // Keep the full stop or the question mark.
  if (!cutEnd) end = Math.min(text.length, end + 1)
  if (cutStart) {
    const space = text.indexOf(' ', start)
    if (space !== -1 && space < index) start = space + 1
  }
  let stop = end
  if (cutEnd) {
    const space = text.lastIndexOf(' ', end)
    if (space > index) stop = space
  }
  const words = text.slice(start, stop).replace(/\s+/g, ' ').trim()
  return { sentence: `${cutStart ? '…' : ''}${words}${cutEnd ? '…' : ''}`, end }
}

const MAX_QUOTE = 180

/** The sentence as a quote: whole when it fits, else the part around the statement, cut at word ends. */
function quoteAround(sentence: string, at: number, length: number): string {
  if (sentence.length <= MAX_QUOTE) return sentence
  const room = MAX_QUOTE - 2
  let start = Math.max(0, Math.min(at - Math.floor(Math.max(0, room - length) / 2), sentence.length - room))
  let end = Math.min(sentence.length, start + room)
  if (start > 0) {
    const space = sentence.indexOf(' ', start)
    if (space !== -1 && space < at) start = space + 1
  }
  if (end < sentence.length) {
    const space = sentence.lastIndexOf(' ', end)
    if (space > at + length) end = space
  }
  return `${start > 0 ? '…' : ''}${sentence.slice(start, end).trim()}${end < sentence.length ? '…' : ''}`
}

function firstMatch(patterns: RegExp[], sentence: string): RegExpExecArray | null {
  for (const re of patterns) {
    const m = re.exec(sentence)
    if (m) return m
  }
  return null
}

/** What a restaurant's own website says about seed oils, or null when it says nothing clear. Conservative: only explicit statements count. */
export function findSeedOilMention(text: string): SeedOilMention | null {
  if (typeof text !== 'string' || !text) return null
  const page = text.length > 400_000 ? text.slice(0, 400_000) : text
  const candidate = new RegExp(CANDIDATE, 'giu')
  let free: SeedOilMention | null = null
  let uses: SeedOilMention | null = null
  let seen = 0
  for (let hit = candidate.exec(page); hit; hit = candidate.exec(page)) {
    seen += 1
    if (seen > MAX_CANDIDATES) return null
    const { sentence, end } = sentenceAround(page, hit.index)
    // The next name is looked for after this sentence.
    candidate.lastIndex = Math.max(candidate.lastIndex, end)
    // A question ("Are you seed oil free?") is not a claim.
    if (sentence.endsWith('?')) continue
    if (!free && HAS_FREE_HINT.test(sentence)) {
      const m = firstMatch(FREE, sentence)
      if (m && !DENIED_BEFORE.test(sentence.slice(Math.max(0, m.index - 40), m.index)) && !DENIED_AFTER.test(sentence.slice(m.index + m[0].length))) {
        free = { claim: 'free', quote: quoteAround(sentence, m.index, m[0].length) }
      }
    }
    if (!uses && HAS_OIL_HINT.test(sentence)) {
      const m = firstMatch(USES, sentence)
      if (m && !NEGATION.test(sentence.slice(Math.max(0, m.index - 40), m.index + m[0].length))) {
        uses = { claim: 'uses', quote: quoteAround(sentence, m.index, m[0].length) }
      }
    }
    // Both on one page: contradictory, we claim nothing.
    if (free && uses) return null
  }
  return free ?? uses
}
