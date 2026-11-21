/**
 * One data-confidence indicator for the whole app: high, medium or low, always with the reason.
 *
 * Every kind of data gets its level from the same three steps and is drawn by the same component
 * (apps/snapmenu-web/src/discover/Confidence.tsx): a scanned dish, a dish from the community, opening
 * hours, the delivery signal and the seed-oil status. Pure and shared by the Worker and the web app.
 *
 *   high    measured or confirmed: a tight range from a known recipe, a recently confirmed fact
 *   medium  a fair estimate or a volunteer-kept fact: likely right, may be off or out of date
 *   low     a rough estimate, a guess from hints, or a claim nobody verified
 */
export type ConfidenceLevel = 'high' | 'medium' | 'low'

export interface Confidence {
  level: ConfidenceLevel
  /** Why, in one to three short plain sentences. The first one is the headline reason. */
  why: string[]
}

export const CONFIDENCE_WORD: Record<ConfidenceLevel, string> = { high: 'High', medium: 'Medium', low: 'Low' }
export const confidenceLabel = (c: Pick<Confidence, 'level'>): string => `${CONFIDENCE_WORD[c.level]} confidence`

const DAY = 24 * 60 * 60_000
const lower = (l: ConfidenceLevel): ConfidenceLevel => (l === 'high' ? 'medium' : 'low')

interface RowLike { counted: boolean; isEstimate: boolean; grams: number; per100: { kcal: number } }

/**
 * A dish from a scan. The level follows the width of the engine's own range (its band tier); a dish whose
 * calories mostly come from estimated rows is never "high". The reasons are the engine's.
 */
export function dishConfidence(d: { bandTier: string; bandReasons?: readonly string[]; rows?: readonly RowLike[] }): Confidence {
  let level: ConfidenceLevel = d.bandTier === 'none' || d.bandTier === 'tight' ? 'high' : d.bandTier === 'moderate' ? 'medium' : 'low'
  const counted = (d.rows ?? []).filter((r) => r.counted)
  const kcal = (r: RowLike) => (r.grams * r.per100.kcal) / 100
  const total = counted.reduce((s, r) => s + kcal(r), 0)
  const estimated = counted.filter((r) => r.isEstimate).reduce((s, r) => s + kcal(r), 0)
  const mostlyEstimated = total > 0 && estimated / total > 0.5
  if (level === 'high' && mostlyEstimated) level = 'medium'
  const lead = level === 'high' ? 'A narrow range: known foods with database nutrition.'
    : level === 'medium' ? 'A fair estimate: typical portions, real ones vary.'
    : 'A rough estimate: the range is wide, read it as a guide.'
  return { level, why: [lead, ...(mostlyEstimated ? ['Most of its calories come from estimated rows.'] : []), ...(d.bandReasons ?? [])].slice(0, 3) }
}

/** A dish the community scanned at a restaurant: one scan of a menu, as old as it is. */
export function communityDishConfidence(d: { example: boolean; kcal: { low: number; mid: number; high: number }; ts: number }, now = Date.now()): Confidence {
  if (d.example) return { level: 'low', why: ['An example entry, not a real scan.'] }
  const spread = d.kcal.mid > 0 ? (d.kcal.high - d.kcal.low) / (2 * d.kcal.mid) : 1
  let level: ConfidenceLevel = spread <= 0.15 ? 'high' : spread <= 0.3 ? 'medium' : 'low'
  const why = ['From a community scan of the menu.']
  if (now - d.ts > 180 * DAY) {
    level = lower(level)
    why.push('Scanned over six months ago. The menu may have changed.')
  }
  why.push(level === 'high' ? 'The calorie range is narrow.' : level === 'medium' ? 'Portions are typical ones, not measured.' : 'The calorie range is wide.')
  return { level, why }
}

/** Opening hours from OpenStreetMap. Null when there are none. */
export function hoursConfidence(h: { hours: string | null | undefined; understood: boolean; hoursChecked?: string | null | undefined }, now = Date.now()): Confidence | null {
  if (!h.hours) return null
  if (!h.understood) return { level: 'low', why: ['These hours are written in a form we cannot read reliably.', 'Check with the restaurant.'] }
  const checked = h.hoursChecked ? Date.parse(h.hoursChecked) : NaN
  if (Number.isFinite(checked) && now - checked < 365 * DAY && checked <= now + DAY) {
    return { level: 'high', why: [`Confirmed on OpenStreetMap on ${h.hoursChecked}.`, 'Public holidays are not covered.'] }
  }
  return { level: 'medium', why: ['From OpenStreetMap, kept by volunteers. Hours can be out of date.', 'Public holidays are not covered.'] }
}

/** The seed-oil status. Null when unknown: no data is not low confidence, it is no claim at all. */
export function seedOilConfidence(s: { status: 'verified' | 'reported' | 'unknown'; yes: number; no: number }): Confidence | null {
  if (s.status === 'verified') return { level: 'medium', why: ["Stated on the restaurant's own website.", 'Nobody checked the kitchen. Ask the restaurant.'] }
  if (s.status === 'reported') {
    return { level: 'low', why: [`${s.yes} community ${s.yes === 1 ? 'report' : 'reports'}${s.no ? `, ${s.no} against` : ''}. Not verified.`, 'Ask the restaurant.'] }
  }
  return null
}

/** The "Reported seed-oil free" filter keeps a place only when someone other than us says so. */
export const reportedSeedOilFree = (v: { status: 'verified' | 'reported' | 'unknown' } | null | undefined): boolean => v?.status === 'reported' || v?.status === 'verified'

/** The delivery signal (delivery.ts). Null when there is no badge. */
export function deliveryConfidenceOf(c: { level: 'osm' | 'confirmed' | 'likely' | 'none'; reason: string; yes: number }): Confidence | null {
  if (c.level === 'none') return null
  const level: ConfidenceLevel = c.level === 'likely' ? 'low' : c.level === 'confirmed' && c.yes >= 5 ? 'high' : 'medium'
  return { level, why: [c.reason, 'A signal, not a promise. The delivery app has the final word.'] }
}
