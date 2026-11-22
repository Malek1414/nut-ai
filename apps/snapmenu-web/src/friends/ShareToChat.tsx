import { createContext, useContext } from 'react'
import { MessageCircle, X } from 'lucide-react'
import type { Card } from '../../../snapmenu-api/src/chats/types'
import type { MenuResult, Place } from '../../../snapmenu-api/src/types'
import { Sheet } from '../components/ui'
import './shared-pick.css'

export const ShareToChat = createContext<(card: Card) => void>(() => {})

export function menuCard(result: MenuResult): Card {
  const top = new Set(result.top)
  const sorted = [...result.dishes.filter(d => top.has(d.id)), ...result.dishes.filter(d => !top.has(d.id))]
  const picks = sorted.slice(0, 12).map(d => ({ name: d.name.slice(0, 150), low: Math.round(d.kcal.low), high: Math.round(d.kcal.high) }))
  return { kind: 'menu', title: result.restaurant || 'Menu scan', scanId: result.scanId, picks,
    subtitle: result.dishes.length + ' dishes · ' + picks.slice(0, 3).map(pick => pick.name).join(' · ') }
}

export function SharedPick({ card, onClose }: { card: Card; onClose: () => void }) {
  return <Sheet label="Shared pick" onClose={onClose} className="shared-pick">
    <header><h2 className="h2">{card.title}</h2><button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button></header>
    <p className="body">{card.subtitle}</p>
    {!!card.picks?.length && <><h3>Shared dishes <span>({card.picks.length})</span></h3><ul>{card.picks.map((pick, i) =>
      <li key={i}><strong>{pick.name}</strong><span>{pick.low}–{pick.high} kcal</span></li>)}</ul></>}
  </Sheet>
}

export function placeCard(place: Place): Card {
  return { kind: 'restaurant', title: place.name, placeId: place.id, lat: place.lat, lng: place.lng,
    subtitle: [place.cuisine, place.address].filter(Boolean).join(' · ') || undefined }
}

export function SendToChat({ card, label = 'Send to chat' }: { card: Card; label?: string }) {
  const share = useContext(ShareToChat)
  return <button className="so-share-place" type="button" onClick={() => share({ ...card, title: card.title.slice(0, 150), subtitle: card.subtitle?.slice(0, 600) })}><MessageCircle size={17} />{label}</button>
}
