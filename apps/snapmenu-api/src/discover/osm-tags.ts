/**
 * What OpenStreetMap carries about a restaurant next to its name: opening hours, website, phone.
 * Read from the same Overpass answer as the map's list (overpass.ts spreads `osmDetailTags` into every
 * place), so a details page costs no extra request. Pure, shared with the web app.
 */
import type { Place } from '../types.js'

export interface OsmDetails {
  /** `opening_hours` exactly as tagged, e.g. "Mo-Fr 11:00-22:00; Sa 12:00-23:00". */
  hours: string | null
  /** `check_date:opening_hours`: the day a mapper last confirmed the hours (YYYY-MM-DD). */
  hoursChecked: string | null
  website: string | null
  /** A menu page the restaurant links itself (`website:menu`). */
  menuUrl: string | null
  phone: string | null
  city: string | null
}

/** A map place with its details. The details are missing on lists cached before this feature. */
export type PlaceDetails = Place & Partial<OsmDetails>

/** Whether a cached place was parsed with the details (even when every one of them is null). */
export const hasDetails = (p: object): boolean => 'hours' in p

/**
 * A link a person may open: http(s) only, a real host name, no credentials. Tags hold many spellings
 * ("www.example.de", "example.de/menu", two links separated by ";"): the first usable one wins.
 */
export function webUrl(raw: string | null | undefined): string | null {
  for (const part of (raw ?? '').split(/[;\s]+/)) {
    const s = part.trim()
    if (!s || s.length > 300) continue
    const withScheme = /^https?:\/\//i.test(s) ? s : /^[\w-]+(\.[\w-]+)+([/?#].*)?$/.test(s) ? `https://${s}` : ''
    if (!withScheme) continue
    try {
      const u = new URL(withScheme)
      if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password || !u.hostname.includes('.')) continue
      return u.toString()
    } catch { /* not a link */ }
  }
  return null
}

/** "example.de" from a link, for showing it. */
export function hostOf(url: string | null | undefined): string {
  try { return new URL(url ?? '').hostname.replace(/^www\./, '') } catch { return '' }
}

/** A phone number as tagged, when it looks like one. */
export function phoneNumber(raw: string | null | undefined): string | null {
  const s = (raw ?? '').split(';')[0]!.trim()
  return /^\+?[\d][\d\s\-/().]{4,24}$/.test(s) ? s : null
}

const text = (v: string | undefined, max: number) => {
  const s = (v ?? '').trim()
  return s ? s.slice(0, max) : null
}

/** Read the detail tags of one OSM element. Every field is present (null when not tagged). */
export function osmDetailTags(tags: Record<string, string>): OsmDetails {
  const checked = (tags['check_date:opening_hours'] ?? tags['opening_hours:check_date'] ?? '').trim()
  return {
    hours: text(tags['opening_hours'], 240),
    hoursChecked: /^\d{4}-\d{2}-\d{2}$/.test(checked) ? checked : null,
    website: webUrl(tags['website'] ?? tags['contact:website'] ?? tags['url']),
    menuUrl: webUrl(tags['website:menu'] ?? tags['menu:url']),
    phone: phoneNumber(tags['phone'] ?? tags['contact:phone']),
    city: text(tags['addr:city'], 60),
  }
}

/** "Oranienstraße 12, 10999 Berlin": as much of the address as is tagged. */
export function fullAddress(p: Pick<PlaceDetails, 'address' | 'postcode' | 'city'>): string | null {
  const town = [p.postcode, p.city].filter(Boolean).join(' ')
  const out = [p.address, town].filter(Boolean).join(', ')
  return out || null
}
