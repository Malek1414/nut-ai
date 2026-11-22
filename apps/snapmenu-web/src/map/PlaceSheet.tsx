// Restaurant sheet: opened from a pin, a dot, a card or a list row. Name, the dishes the community scanned
// there (best for the user's goal first) and one clear action: "Scan menu", or "Order" when there is
// something scanned to order. The other action sits next to it, quieter.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { BadgeCheck } from 'lucide-react'
import type { DishLite, Place, Profile } from '../../../snapmenu-api/src/types'
import { DeliveryBadge, DeliveryVote } from '../components/Delivery'
import { Icon } from '../components/ui'
import { orderUrl, PROVIDERS, trackOrder, type DeliveryConfidence, type PlaceVotes } from '../lib/delivery'
import { fetchPlace } from '../lib/places'
import { formatDistance } from '../lib/position'
import { DishNums, ExampleBadge, GoalFit } from './RankCard'

const KIND: Record<Place['kind'], string> = { restaurant: 'Restaurant', fast_food: 'Fast food', cafe: 'Café' }

export function PlaceSheet({ place, distanceM, profile, onClose, onScan, delivery, preferOrder = false, onVotes, children }: {
  place: Place
  distanceM: number | null
  profile: Profile | null
  onClose: () => void
  onScan: (place: Place) => void
  delivery: DeliveryConfidence
  /** The delivery filter is on: lead with "Order" wherever the place may deliver, with the apps already open. */
  preferOrder?: boolean
  /** The community vote changed: the map refreshes this place's badge. */
  onVotes: (v: PlaceVotes) => void
  /** Extra sections below the dishes (community posts). */
  children?: React.ReactNode
}) {
  const [dishes, setDishes] = useState<DishLite[] | null>(null)
  const [error, setError] = useState(false)
  const [votes, setVotesState] = useState<PlaceVotes | null>(null)
  const [ordering, setOrdering] = useState(preferOrder && delivery.level !== 'none')
  const setVotes = (v: PlaceVotes) => { setVotesState(v); onVotes(v) }

  useEffect(() => {
    let live = true
    setDishes(null)
    setError(false)
    setVotesState(null)
    setOrdering(preferOrder && delivery.level !== 'none')
    fetchPlace(place.id, profile)
      .then((r) => { if (!live) return; setDishes(r.dishes); setVotesState(r.votes ?? { yes: 0, no: 0, myVote: 0 }) })
      .catch(() => live && setError(true))
    return () => { live = false }
    // Only a new restaurant resets the sheet: a vote changes `delivery` and must not close the panel.
  }, [place.id, profile])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const vegan = place.vegan === 'only' ? 'Vegan' : place.vegan === 'yes' ? 'Vegan options' : null
  const meta = [place.cuisine ?? KIND[place.kind], vegan, distanceM !== null ? formatDistance(distanceM) : null, place.address].filter(Boolean).join(' · ')
  const scanned = dishes !== null && dishes.length > 0
  const orderFirst = delivery.level !== 'none' && (scanned || preferOrder)
  const osm = `https://www.openstreetmap.org/${place.id[0] === 'w' ? 'way' : place.id[0] === 'r' ? 'relation' : 'node'}/${place.id.slice(1)}`

  const scan = (
    <button key="scan" type="button" className={`btn ${orderFirst || ordering ? 'btn-secondary' : 'btn-primary'}`} onClick={() => onScan(place)}>
      <Icon name="camera" size={20} /> Scan menu
    </button>
  )
  const order = (
    <button key="order" type="button" className={`btn ${orderFirst ? 'btn-primary' : 'btn-secondary'}`} aria-expanded={ordering} onClick={() => setOrdering((o) => !o)}>
      <Icon name="bag" size={20} /> Order
    </button>
  )

  // Portalled to <body>: the map screen is its own stacking context and the sheet must cover the tab bar.
  return createPortal(
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet place-sheet" role="dialog" aria-modal="true" aria-labelledby="place-title">
        <div className="grab" />
        <div className="place-sheet__head">
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 id="place-title" className="h2">{place.name}{place.verified === true && <BadgeCheck className="map-verified-icon" size={16} role="img" aria-label="OSM verified" />}</h2>
            {meta && <p className="small place-sheet__meta">{meta}</p>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={20} /></button>
        </div>

        {dishes === null && !error && (
          <div className="place-dishes" aria-busy="true">
            {[0, 1].map((i) => (
              <div key={i} className="place-dish">
                <span className="place-dish__body"><span className="skeleton" style={{ height: 15, width: `${70 - i * 15}%` }} /><span className="skeleton" style={{ height: 12, width: '50%' }} /></span>
                <span className="skeleton rank-skel--fit" />
              </div>
            ))}
          </div>
        )}
        {error && <p className="place-none" role="status">Dishes did not load</p>}
        {dishes && dishes.length === 0 && <p className="place-none">No scans yet</p>}
        {scanned && (
          <div className="place-dishes">
            {dishes.slice(0, 6).map((d) => (
              <div key={d.name} className="place-dish">
                <span className="place-dish__body">
                  <span className="place-dish__name"><b>{d.name}</b>{d.example && <ExampleBadge />}</span>
                  {d.translated && d.translated !== d.name && <span className="small">{d.translated}</span>}
                  <DishNums dish={d} />
                </span>
                <GoalFit score={d.score} />
              </div>
            ))}
          </div>
        )}

        {children}

        <a className="place-credit" href={osm} target="_blank" rel="noreferrer">© OpenStreetMap</a>

        <div className="place-actions">
          {ordering && (
            <div className="order-panel">
              {delivery.level !== 'none' && <DeliveryBadge level={delivery.level} label={delivery.label} size="sm" />}
              <div className="order-row" role="group" aria-label={`Order from ${place.name}`}>
                {PROVIDERS.map((p) => (
                  <a key={p.id} href={orderUrl(p.id, place)} target="_blank" rel="noopener noreferrer" onClick={() => trackOrder(p.id, place, 'sheet')}>
                    <i style={{ background: p.color }} aria-hidden="true" />{p.label}
                  </a>
                ))}
              </div>
              <DeliveryVote place={place} votes={votes} onVotes={setVotes} />
            </div>
          )}
          {/* With the delivery apps open, they are the order action: only "Scan menu" stays below. */}
          <div className="place-actions__row">{ordering ? scan : orderFirst ? [order, scan] : [scan, order]}</div>
        </div>
      </div>
    </>,
    document.body,
  )
}
