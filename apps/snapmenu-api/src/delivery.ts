/**
 * Delivery signal, honest and free. Pure and shared by the Worker and the web app.
 *
 * Inputs: OpenStreetMap tags (delivery=yes|only|no, takeaway, delivery:* keys, brand), the kind of place,
 * the distance from the user, and one-tap community votes ("Delivers? yes / no").
 * Output: a badge that never claims more than we know. "Delivers (OSM)" only when OpenStreetMap says so,
 * "Likely delivers" for hints, "Delivers · n confirmed" when the community backs it up.
 */
import type { Place } from './types.js'

export type OsmYesNo = 'yes' | 'only' | 'no' | null

export interface OsmDelivery {
  delivery: OsmYesNo
  takeaway: OsmYesNo
  /** First delivery:* tag that is not "no", e.g. "delivery:partner=wolt". */
  deliveryHint: string | null
  brand: string | null
  postcode: string | null
}

const yesNo = (v: string | undefined): OsmYesNo => {
  const s = v?.trim().toLowerCase()
  return s === 'yes' || s === 'only' || s === 'no' ? s : null
}

/** Read the delivery-related tags of one OSM element. */
export function osmDeliveryTags(tags: Record<string, string>): OsmDelivery {
  let hint: string | null = null
  for (const [k, v] of Object.entries(tags)) {
    if (!k.startsWith('delivery:') || typeof v !== 'string') continue
    const val = v.trim().toLowerCase()
    if (!val || val === 'no' || val === 'none') continue
    hint = `${k}=${v.trim()}`.slice(0, 80)
    break
  }
  const brand = (tags['brand'] ?? '').trim()
  const pc = (tags['addr:postcode'] ?? '').trim()
  return {
    delivery: yesNo(tags['delivery']),
    takeaway: yesNo(tags['takeaway']),
    deliveryHint: hint,
    brand: brand ? brand.slice(0, 60) : null,
    postcode: /^\d{5}$/.test(pc) ? pc : null,
  }
}

/** Delivery radius we assume for "likely" hints. Couriers in Berlin mostly ride 2-4 km. */
export const DELIVERY_RADIUS_M = 3000

export interface DeliveryVotes { yes: number; no: number }

export type DeliveryLevel = 'osm' | 'confirmed' | 'likely' | 'none'

export interface DeliveryConfidence {
  level: DeliveryLevel
  /** Short badge text. Empty when level is none. */
  label: string
  /** One plain sentence on why. */
  reason: string
  /** Internal score, for sorting and tests. */
  score: number
  yes: number
  no: number
}

type PlaceLike = Pick<Place, 'kind'> & Partial<Pick<Place, 'delivery' | 'takeaway' | 'deliveryHint' | 'brand'>>

/** Points from hints that are not a delivery tag. Capped, so hints alone never beat a real tag. */
export function hintPoints(p: PlaceLike): number {
  let pts = 0
  if (p.deliveryHint) pts += 2
  if (p.kind === 'fast_food') pts += 2
  if (p.takeaway === 'yes' || p.takeaway === 'only') pts += 1
  if (p.brand) pts += 1
  return Math.min(3, pts)
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/**
 * How sure we are that a place delivers to the user.
 * - OSM delivery=yes|only: +4, delivery=no: -4
 * - hints (delivery:* tag, fast food, takeaway, chain brand): up to +3, only within the delivery radius
 * - community: +1 per yes, -1 per no, capped at ±6 (so a clear majority can overrule a stale tag)
 * Badge: "Delivers (OSM)" needs the tag and a score of 4+; "Delivers · n confirmed" needs 2+ more yes than no
 * and a score of 2+; "Likely delivers" needs 2+. Anything below shows no badge.
 */
export function deliveryConfidence(p: PlaceLike, distanceM: number | null, votes: DeliveryVotes = { yes: 0, no: 0 }): DeliveryConfidence {
  const yes = Math.max(0, Math.floor(votes.yes || 0))
  const no = Math.max(0, Math.floor(votes.no || 0))
  const net = yes - no
  const tagged = p.delivery === 'yes' || p.delivery === 'only'
  const refused = p.delivery === 'no'
  const near = distanceM === null || distanceM <= DELIVERY_RADIUS_M
  const hints = near ? hintPoints(p) : 0
  const score = (tagged ? 4 : refused ? -4 : 0) + hints + clamp(net, -6, 6)
  const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`
  const votesNote = yes || no ? ` ${people(yes)} said yes, ${no} no.` : ''
  const base = { score, yes, no }

  if (tagged && score >= 4) {
    return { ...base, level: 'osm', label: 'Delivers (OSM)', reason: `Tagged delivery=${p.delivery} on OpenStreetMap.${votesNote}` }
  }
  if (net >= 2 && score >= 2) {
    return { ...base, level: 'confirmed', label: `Delivers · ${yes} confirmed`, reason: `${people(yes)} from the community confirmed delivery${no ? `, ${no} said no` : ''}.` }
  }
  if (score >= 2) {
    const why: string[] = []
    if (tagged) why.push('OpenStreetMap says it delivers, but some people disagree')
    if (p.deliveryHint) why.push(`OpenStreetMap has ${p.deliveryHint}`)
    if (p.kind === 'fast_food') why.push('fast food')
    if (p.takeaway === 'yes' || p.takeaway === 'only') why.push('does takeaway')
    if (p.brand) why.push(`part of ${p.brand}`)
    if (net > 0) why.push(`${people(yes)} said yes`)
    const where = distanceM !== null ? ` and ${distanceM < 950 ? `${Math.max(10, Math.round(distanceM / 10) * 10)} m` : `${(distanceM / 1000).toFixed(1)} km`} from you` : ''
    return { ...base, level: 'likely', label: 'Likely delivers', reason: `A guess: ${why.join(', ') || 'hints on OpenStreetMap'}${where}. Not confirmed.` }
  }
  const reason = refused ? 'OpenStreetMap says no delivery.' : !near && (tagged || hintPoints(p) > 0) ? 'Probably too far to deliver to you.' : net < 0 ? 'The community says it does not deliver.' : 'No delivery info yet.'
  return { ...base, level: 'none', label: '', reason: reason + votesNote }
}

export const delivers = (c: DeliveryConfidence) => c.level !== 'none'

// ---------- Order links ----------

export type Provider = 'wolt' | 'lieferando' | 'ubereats'
export const PROVIDERS: Array<{ id: Provider; label: string; color: string }> = [
  { id: 'wolt', label: 'Wolt', color: '#009de0' },
  { id: 'lieferando', label: 'Lieferando', color: '#ff8000' },
  { id: 'ubereats', label: 'Uber Eats', color: '#06c167' },
]
export const PROVIDER_IDS = new Set<string>(PROVIDERS.map((p) => p.id))

/** Berlin postcodes run 10115-14199. Default: Mitte, around Alexanderplatz. */
const berlinPostcode = (pc: string | null | undefined) => (pc && /^1[0-4]\d{3}$/.test(pc) ? pc : '10178')

/**
 * A public search page on each platform with the restaurant name, for Berlin. Formats checked by hand on
 * 21 Nov 2026 with a plain GET of the public page (no scraping, nothing stored):
 *   Wolt        https://wolt.com/de/deu/berlin/search?q=<name>
 *   Lieferando  https://www.lieferando.de/lieferservice/essen/berlin-<postcode>?search=<name>
 *   Uber Eats   https://www.ubereats.com/de/search?q=<name>&pl=<base64 of the url-encoded location JSON>
 */
export function orderUrl(provider: Provider, place: Pick<Place, 'name' | 'lat' | 'lng'> & Partial<Pick<Place, 'postcode'>>): string {
  const q = encodeURIComponent(place.name.trim())
  if (provider === 'wolt') return `https://wolt.com/de/deu/berlin/search?q=${q}`
  if (provider === 'lieferando') return `https://www.lieferando.de/lieferservice/essen/berlin-${berlinPostcode(place.postcode)}?search=${q}`
  const pl = btoa(encodeURIComponent(JSON.stringify({ address: 'Berlin', reference: '', referenceType: '', latitude: +place.lat.toFixed(5), longitude: +place.lng.toFixed(5) })))
  return `https://www.ubereats.com/de/search?q=${q}&pl=${encodeURIComponent(pl)}`
}

/** Each platform's Berlin page, when we cannot build a search. */
export const PROVIDER_HOME: Record<Provider, string> = {
  wolt: 'https://wolt.com/de/deu/berlin',
  lieferando: 'https://www.lieferando.de/lieferservice/essen/berlin-10178',
  ubereats: 'https://www.ubereats.com/de/city/berlin-be',
}
