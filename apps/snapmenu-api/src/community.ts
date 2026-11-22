/**
 * Community rules, pure and testable: Reddit-style hot ranking, vote arithmetic,
 * report hiding, the word and personal-data filter, rate limits and the community list.
 *
 * What a check tells a person is a fixed sentence from ./voice, in their language.
 */
import { say } from './voice/index.js'

export const COMMUNITIES = [
  { id: 'HighProtein', label: 'High protein', blurb: 'Big protein, sensible calories.', kind: 'goal' },
  { id: 'LoseFat', label: 'Lose fat', blurb: 'Filling meals that keep the calories honest.', kind: 'goal' },
  { id: 'Vegan', label: 'Vegan', blurb: 'Plant-based orders that actually fill you up.', kind: 'goal' },
  { id: 'Delivery', label: 'Delivery', blurb: 'Order delivery without wrecking your diet.', kind: 'topic' },
  { id: 'Kreuzberg', label: 'Kreuzberg', blurb: 'Best orders around Kotti, Bergmannkiez and the canal.', kind: 'kiez' },
  { id: 'Mitte', label: 'Mitte', blurb: 'Lunch near Alex, Hackescher Markt and Rosenthaler Platz.', kind: 'kiez' },
  { id: 'Neukölln', label: 'Neukölln', blurb: 'Sonnenallee, Weserstraße and Schillerkiez.', kind: 'kiez' },
  { id: 'PrenzlauerBerg', label: 'Prenzlauer Berg', blurb: 'Kastanienallee to Kollwitzplatz.', kind: 'kiez' },
  { id: 'Friedrichshain', label: 'Friedrichshain', blurb: 'Boxhagener Platz, Simon-Dach and the Warschauer.', kind: 'kiez' },
] as const

export type CommunityId = (typeof COMMUNITIES)[number]['id']
export const COMMUNITY_IDS = new Set<string>(COMMUNITIES.map((c) => c.id))

/** Rough centres of the five Kieze, for suggesting a community from a restaurant's position. */
const KIEZ_CENTRES: Array<{ id: CommunityId; lat: number; lng: number }> = [
  { id: 'Kreuzberg', lat: 52.4977, lng: 13.4108 },
  { id: 'Mitte', lat: 52.5235, lng: 13.4005 },
  { id: 'Neukölln', lat: 52.4811, lng: 13.4350 },
  { id: 'PrenzlauerBerg', lat: 52.5390, lng: 13.4240 },
  { id: 'Friedrichshain', lat: 52.5125, lng: 13.4540 },
]

export function kiezFor(lat: number, lng: number): CommunityId | null {
  let best: CommunityId | null = null
  let bestD = Infinity
  for (const k of KIEZ_CENTRES) {
    const d = distanceM(lat, lng, k.lat, k.lng)
    if (d < bestD) { bestD = d; best = k.id }
  }
  return bestD <= 2600 ? best : null
}

export function goalCommunity(goal: string): CommunityId {
  if (goal === 'build_muscle') return 'HighProtein'
  if (goal === 'plant_based') return 'Vegan'
  return 'LoseFat'
}

export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// ---------- Ranking ----------

/** Reddit's epoch for the hot formula (8 Dec 2005). */
const HOT_EPOCH_S = 1134028003

/**
 * Reddit's hot score: log10 of the net score plus a time term. Every 12.5 hours
 * (45000 s) of age weighs as much as a 10x difference in votes.
 */
export function hotScore(ups: number, downs: number, createdMs: number): number {
  const s = ups - downs
  const order = Math.log10(Math.max(Math.abs(s), 1))
  const sign = s > 0 ? 1 : s < 0 ? -1 : 0
  const seconds = createdMs / 1000 - HOT_EPOCH_S
  return Math.round((sign * order + seconds / 45000) * 1e7) / 1e7
}

export type VoteValue = -1 | 0 | 1

/** How ups and downs change when a device moves its vote from `prev` to `next`. */
export function voteDelta(prev: VoteValue, next: VoteValue): { ups: number; downs: number } {
  return {
    ups: (next === 1 ? 1 : 0) - (prev === 1 ? 1 : 0),
    downs: (next === -1 ? 1 : 0) - (prev === -1 ? 1 : 0),
  }
}

export function parseVote(v: unknown): VoteValue | null {
  return v === 1 || v === 0 || v === -1 ? v : null
}

/** A post or comment hides once this many different devices reported it. */
export const REPORT_HIDE_AT = 3
export const shouldHide = (distinctReports: number) => distinctReports >= REPORT_HIDE_AT

// ---------- Safety ----------

/**
 * Small word list: slurs and the worst insults in English and German. Matched on word
 * starts after folding leetspeak, so "Arschl0ch" and "f*ck" are caught too.
 */
const BLOCKED = [
  'fuck', 'fck', 'shit$', 'shitty', 'bullshit', 'cunt', 'bitch', 'whore', 'slut', 'nigg', 'fag$', 'faggot', 'retard$', 'retarded', 'kike', 'spic$', 'tranny', 'rapist',
  'fotze', 'hurensohn', 'hure$', 'wichser', 'arschloch', 'schlampe', 'missgeburt', 'spast$', 'kanake', 'schwuchtel', 'neger', 'nazi$', 'nazis$', 'heil hitler', 'sieg heil',
]

function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[0]/g, 'o').replace(/[1!|]/g, 'i').replace(/[3]/g, 'e').replace(/[4@]/g, 'a').replace(/[5$]/g, 's').replace(/[7]/g, 't')
    .replace(/\*/g, 'u')
}

export type TextCheck = { ok: true; text: string } | { ok: false; code: string; message: string }

/**
 * Trim, length-check and filter user text. No links, emails or phone numbers: no personal data, no spam.
 * `field` names what is checked for the reader of the code; the hint itself is in the person's language `lang`.
 */
export function checkText(raw: unknown, _field: string, min: number, max: number, lang: unknown = 'English'): TextCheck {
  const text = typeof raw === 'string' ? raw.replace(/\s+\n/g, '\n').replace(/[ \t]+/g, ' ').trim() : ''
  if (text.length < min) return { ok: false, code: 'too_short', message: min <= 1 || text.length === 0 ? say(lang, 'community.empty') : say(lang, 'community.too_short', { min }) }
  if (text.length > max) return { ok: false, code: 'too_long', message: say(lang, 'community.too_long', { max }) }
  const folded = fold(text)
  for (const w of BLOCKED) {
    if (w === 'retard$' && ['French', 'Spanish', 'Portuguese'].includes(String(lang))) continue
    // A trailing $ means whole word only, so "spicy" and "fagottini" stay fine.
    const whole = w.endsWith('$')
    const re = new RegExp(`(^|[^a-z])${w.replace('$', '').replace(/ /g, '\\s+')}${whole ? '($|[^a-z])' : ''}`, 'i')
    if (re.test(folded)) return { ok: false, code: 'blocked_word', message: say(lang, 'community.blocked_word') }
  }
  if (/[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(text)) return { ok: false, code: 'personal_data', message: say(lang, 'community.no_email') }
  if (/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|de|net|org|io|ly|me)\b/i.test(text)) return { ok: false, code: 'no_links', message: say(lang, 'community.no_links') }
  if (/(?:\+|\b00)\d(?:[\s/().-]?\d){7,}|\b0\d{2,4}(?:[\s/.-]?\d){6,}\b/.test(text)) return { ok: false, code: 'personal_data', message: say(lang, 'community.no_phone') }
  return { ok: true, text }
}

/** Nicknames: 2-24 letters, digits, dot, dash, underscore; filtered like any text. */
export function checkNickname(raw: unknown, lang: unknown = 'English'): TextCheck {
  const base = checkText(raw, 'nickname', 2, 24, lang)
  if (!base.ok) return base
  if (!/^[\p{L}\p{N}._-]+$/u.test(base.text)) return { ok: false, code: 'bad_nickname', message: say(lang, 'community.bad_nickname') }
  return base
}

/** Per-device limits, counted from the community tables: [max actions, window in ms]. */
export const RATE_LIMITS = {
  post: { max: 5, windowMs: 10 * 60_000 },
  comment: { max: 20, windowMs: 10 * 60_000 },
  vote: { max: 90, windowMs: 60_000 },
  report: { max: 15, windowMs: 60 * 60_000 },
  attach: { max: 12, windowMs: 60 * 60_000 },
} as const

export function initials(nickname: string): string {
  const parts = nickname.replace(/[._-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim().split(/\s+/)
  const a = parts[0]?.[0] ?? '?'
  const b = parts.length > 1 ? parts[1]![0]! : parts[0]?.[1] ?? ''
  return (a + b).toUpperCase()
}
