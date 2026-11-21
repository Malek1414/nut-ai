// "Open now" on the phone. The hours are OpenStreetMap's; the clock has to be the restaurant's local one.
import { deviceLocalTime, localTimeIn, openStatus, weekRows, type LocalTime, type OpenStatus } from '../../../snapmenu-api/src/discover/opening-hours'
import { distance, type LatLng } from '../lib/position'

export type { LocalTime, OpenStatus }
export { weekRows }

/**
 * The local time at a restaurant, or null when we cannot know it:
 *   - near the phone's own position (300 km): the phone's clock is the restaurant's clock;
 *   - anywhere in Germany and its Central European neighbours: Berlin time, whatever the phone is set to;
 *   - elsewhere without a shared position: unknown, and the app shows the hours without "open now".
 */
export function placeClock(place: LatLng, user: LatLng | null, at = new Date()): LocalTime | null {
  if (user && distance(user, place) < 300_000) return deviceLocalTime(at)
  if (place.lat > 45.8 && place.lat < 55.1 && place.lng > 5.8 && place.lng < 17.2) return localTimeIn('Europe/Berlin', at)
  return null
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export interface OpenLabel { text: string; short: string; tone: 'open' | 'soon' | 'closed' }

/** "Open until 22:00", "Closes 22:00", "Closed · opens 11:30", "Closed · opens Mon 11:30". Null when unknown. */
export function openLabel(s: OpenStatus, now: LocalTime): OpenLabel | null {
  if (s.state === 'unknown') return null
  if (s.state === 'open') {
    if (!s.closesAt) return { text: 'Open now', short: 'Open', tone: 'open' }
    if (s.closesInMin !== null && s.closesInMin <= 45) return { text: `Closes ${s.closesAt}`, short: `Closes ${s.closesAt}`, tone: 'soon' }
    return { text: `Open until ${s.closesAt}`, short: 'Open', tone: 'open' }
  }
  if (!s.opensAt) return { text: 'Closed', short: 'Closed', tone: 'closed' }
  const today = s.opensWeekday === null || s.opensWeekday === now.weekday
  // "Opens Sun 11:30" would read like today when it is next week's.
  const day = today && (s.opensInMin ?? 0) < 24 * 60 ? '' : `${DAYS[s.opensWeekday ?? now.weekday]} `
  return { text: `Closed · opens ${day}${s.opensAt}`, short: 'Closed', tone: 'closed' }
}

/** Everything a screen needs about a restaurant's hours right now. */
export function hoursNow(place: LatLng & { hours?: string | null | undefined }, user: LatLng | null): { label: OpenLabel | null; understood: boolean; rows: Array<{ days: string; hours: string }> | null } {
  if (!place.hours) return { label: null, understood: false, rows: null }
  // The week table needs no clock, only a date for month rules: the phone's is close enough for that.
  const now = placeClock(place, user)
  const rows = weekRows(place.hours, now ?? deviceLocalTime())
  const status = now ? openStatus(place.hours, now) : ({ state: 'unknown' } as OpenStatus)
  return { label: now ? openLabel(status, now) : null, understood: rows !== null, rows }
}
