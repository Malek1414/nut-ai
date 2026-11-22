import type { D1Like } from './d1-adapter.js'
import { DEFAULT_CENTER, placesNear } from './group/api.js'
import { matchPlaces } from './group/match.js'
import { cleanNeeds, parseNeedsText } from './group/needs.js'
import type { NearbyAnswer } from './group/types.js'
import { userLanguage } from './voice/index.js'

/** A short request against scanned menus only. No model, network lookup or invented dish. */
export async function nearbyPick(db: D1Like, body: Record<string, unknown>): Promise<NearbyAnswer | null> {
  const { message, profile, lat, lng, example, language } = body
  if (typeof message !== 'string' || !message.trim() || message.length > 600) return null
  const demo = example === true
  const center = demo ? DEFAULT_CENTER : (
    typeof lat === 'number' && Math.abs(lat) <= 85 && typeof lng === 'number' && Math.abs(lng) <= 180 ? { lat, lng } : null
  )
  if (!center) return null
  const saved = cleanNeeds(profile)
  const said = parseNeedsText(message).needs
  // A voice request can tighten the saved diet, but not silently loosen it.
  const diets = [saved.diet, said.diet]
  const diet = diets.includes('vegan') ? 'vegan' : diets.includes('vegetarian') ? 'vegetarian' : 'any'
  const needs = cleanNeeds({ ...saved, ...said, diet, allergies: [...saved.allergies, ...(said.allergies ?? [])] })
  const area = demo ? 'berlin' : 'local'
  if (Object.keys(said).length === 0) return { area, match: null, needs, reason: 'not_understood' }
  const { places } = await placesNear(db, center, needs.allergies.length > 0)
  const out = matchPlaces([{ id: 'you', name: 'You', needs }], places, userLanguage({ saved: language }), 1)
  const match = out.matches.find((p) => p.fits === 1) ?? null
  return { match, needs, area, reason: match ? null : places.length ? 'no_fit' : 'no_data' }
}
