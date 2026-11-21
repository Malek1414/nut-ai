/**
 * What the discover routes answer with. Types only and no Worker imports: the web app reads this file too.
 */
import type { DishLite } from '../types.js'
import type { PlaceDetails } from './osm-tags.js'

/** A named spot to look for restaurants around: a district, a street, a station, a town. */
export interface AreaHit { name: string; label: string; lat: number; lng: number; kind: string }
export interface GeoResult { areas: AreaHit[]; places: PlaceDetails[] }

export type SeedOilStatus = 'verified' | 'reported' | 'unknown'

/** What a restaurant's own website says about seed oils, when we read it. */
export interface SeedOilWeb { url: string; claim: 'free' | 'uses' | null; quote: string | null; checkedAt: number }

export interface SeedOilView {
  status: SeedOilStatus
  /** Badge text; empty when unknown. It says "reported", never "is". */
  label: string
  /** Who says so, as one plain sentence. */
  source: string
  yes: number
  no: number
  myReport: -1 | 0 | 1
  /** Links people attached to their reports, newest first, at most three. */
  links: string[]
  /** The restaurant's website, when we read it. */
  web: SeedOilWeb | null
}

export type SearchPlace = PlaceDetails & {
  /** Dishes the community scanned there. */
  scanned: number
  /** Present when someone reported on seed oils there or its website mentions them. */
  seedOil: SeedOilView | null
}

export interface SearchResponse {
  q: string
  places: SearchPlace[]
  areas: AreaHit[]
  /** How the area lookup went. `local`: only names we already had (asking Nominatim needs a submitted search). */
  geo: 'local' | 'cache' | 'live' | 'busy' | 'unavailable'
  attribution: string
}

export interface DetailsResponse {
  /** The restaurant as OpenStreetMap has it; null when it is in none of the cached lists. */
  place: PlaceDetails | null
  /** Community-scanned dishes, best for the viewer's goal first. */
  dishes: DishLite[]
  /** Community "Delivers? yes / no". */
  votes: { yes: number; no: number; myVote: -1 | 0 | 1 }
  seedOil: SeedOilView
  /** Its website is being read right now: ask again in a few seconds for what it says. */
  webPending: boolean
  attribution: string
}
