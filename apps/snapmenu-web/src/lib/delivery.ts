// Delivery on the client: the shared confidence rules, order links with click tracking, and the community vote.
import { deliveryConfidence, delivers, orderUrl, PROVIDERS, type DeliveryConfidence, type Provider } from '../../../snapmenu-api/src/delivery'
import type { Place } from '../../../snapmenu-api/src/types'
import { track } from './api'
import { store } from './storage'

export { deliveryConfidence, delivers, orderUrl, PROVIDERS }
export type { DeliveryConfidence, Provider }

export interface PlaceVotes { yes: number; no: number; myVote: -1 | 0 | 1 }

/** Record an "Order it" tap. The link itself opens the platform in a new tab. */
export function trackOrder(provider: Provider, place: Pick<Place, 'id'>, from: 'card' | 'sheet' | 'post') {
  track('order_click', { provider, place: place.id, from })
}

export async function voteDelivery(place: Pick<Place, 'id' | 'lat' | 'lng'>, value: -1 | 0 | 1): Promise<PlaceVotes> {
  const r = await fetch('/api/delivery-vote', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-device': store.deviceId(), ...(store.isTeam() ? { 'x-team': '1' } : {}) },
    body: JSON.stringify({ placeId: place.id, value, lat: place.lat, lng: place.lng }),
  })
  const body = (await r.json().catch(() => null)) as (PlaceVotes & { error?: { message: string } }) | null
  if (!r.ok || !body) throw new Error(body?.error?.message ?? 'Could not save your answer. Try again.')
  return body
}
