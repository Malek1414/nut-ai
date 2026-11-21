// Restaurant sheet: opened from a pin, a dot, a card or a list row. Shows the dishes the community scanned
// there (best for the user's goal first) and leads into scanning this restaurant's menu.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { DishLite, Place, Profile } from '../../../snapmenu-api/src/types'
import { DeliveryBadge, DeliveryVote, OrderLinks } from '../components/Delivery'
import { Icon } from '../components/ui'
import type { DeliveryConfidence, PlaceVotes } from '../lib/delivery'
import { kcalRange, n0 } from '../lib/format'
import { fetchPlace } from '../lib/places'
import { formatDistance } from '../lib/position'
import { DishArt, ExampleBadge, ScoreRing } from './RankCard'

const KIND: Record<Place['kind'], string> = { restaurant: 'Restaurant', fast_food: 'Fast food', cafe: 'Café' }

function MiniRange({ d }: { d: DishLite }) {
  const max = 1500
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`
  return (
    <span className="mini-range" aria-hidden="true">
      <i style={{ left: pct(d.kcal.low), width: `calc(${pct(d.kcal.high)} - ${pct(d.kcal.low)})` }} />
      <b style={{ left: pct(d.kcal.mid) }} />
    </span>
  )
}

export function PlaceSheet({ place, distanceM, profile, onClose, onScan, delivery, onVotes, children }: {
  place: Place
  distanceM: number | null
  profile: Profile | null
  onClose: () => void
  onScan: (place: Place) => void
  delivery: DeliveryConfidence
  /** The community vote changed: the map refreshes this place's badge. */
  onVotes: (v: PlaceVotes) => void
  /** Extra sections below the dishes (community posts). */
  children?: React.ReactNode
}) {
  const [dishes, setDishes] = useState<DishLite[] | null>(null)
  const [error, setError] = useState(false)
  const [votes, setVotesState] = useState<PlaceVotes | null>(null)
  const setVotes = (v: PlaceVotes) => { setVotesState(v); onVotes(v) }

  useEffect(() => {
    let live = true
    setDishes(null)
    setError(false)
    setVotesState(null)
    fetchPlace(place.id, profile)
      .then((r) => { if (!live) return; setDishes(r.dishes); setVotesState(r.votes ?? { yes: 0, no: 0, myVote: 0 }) })
      .catch(() => live && setError(true))
    return () => { live = false }
  }, [place.id, profile])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const meta = [place.cuisine ?? KIND[place.kind], distanceM !== null ? formatDistance(distanceM) : null, place.address].filter(Boolean).join(' · ')
  const allExample = dishes !== null && dishes.length > 0 && dishes.every((d) => d.example)
  const osm = `https://www.openstreetmap.org/${place.id[0] === 'w' ? 'way' : place.id[0] === 'r' ? 'relation' : 'node'}/${place.id.slice(1)}`

  // Portalled to <body>: the map screen is its own stacking context and the sheet must cover the tab bar.
  return createPortal(
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet place-sheet" role="dialog" aria-modal="true" aria-labelledby="place-title">
        <div className="grab" />
        <div className="place-sheet__head">
          <div style={{ minWidth: 0, flex: 1 }}>
            <p className="eyebrow">{KIND[place.kind]}{place.vegan === 'only' ? ' · fully vegan' : place.vegan === 'yes' ? ' · vegan options' : ''}</p>
            <h2 id="place-title" className="h2" style={{ marginTop: 4 }}>{place.name}</h2>
            {meta && <p className="small" style={{ marginTop: 4 }}>{meta}</p>}
            {delivery.level !== 'none' && <div style={{ marginTop: 8 }}><DeliveryBadge level={delivery.level} label={delivery.label} /></div>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={20} /></button>
        </div>

        <div className="section-title" style={{ marginTop: 20 }}>
          <h3 className="h3">Scanned here</h3>
          {allExample ? <ExampleBadge /> : dishes && dishes.length > 0 ? <span className="small">best for you first</span> : null}
        </div>

        {dishes === null && !error && (
          <div className="card-flat list-card" aria-busy="true">
            {[0, 1].map((i) => <div key={i} className="dish-row"><span className="skeleton" style={{ width: 44, height: 44, borderRadius: 12 }} /><span style={{ flex: 1, display: 'grid', gap: 6 }}><span className="skeleton" style={{ height: 14, width: '70%' }} /><span className="skeleton" style={{ height: 10, width: '45%' }} /></span></div>)}
          </div>
        )}
        {error && <p className="body">Could not load the dishes. Check your connection and try again.</p>}
        {dishes && dishes.length === 0 && (
          <div className="place-empty">
            <span className="s-ic"><Icon name="camera" size={22} /></span>
            <div>
              <b>Nobody scanned this menu yet.</b>
              <p className="small" style={{ marginTop: 2 }}>Scan it and your best dishes show up on this pin for everyone nearby.</p>
            </div>
          </div>
        )}
        {dishes && dishes.length > 0 && (
          <div className="card-flat list-card">
            {dishes.slice(0, 6).map((d) => (
              <div key={d.name} className="place-dish">
                <DishArt name={d.name} className="place-dish__art" />
                <span className="place-dish__body">
                  <span className="row" style={{ gap: 8, justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <b className="place-dish__name">{d.name}</b>
                    {d.price && <span className="place-dish__price">{d.price}</span>}
                  </span>
                  {d.translated && d.translated !== d.name && <span className="small">{d.translated}</span>}
                  <span className="place-dish__nums">
                    <span className="num">{kcalRange(d.kcal)} <small>kcal</small></span>
                    <span className="place-dish__protein">{n0(d.protein)} g protein</span>
                  </span>
                  <MiniRange d={d} />
                </span>
                <ScoreRing score={d.score} size={34} />
              </div>
            ))}
          </div>
        )}
        {dishes && dishes.length > 0 && <p className="small" style={{ marginTop: 8 }}>Ranges from community scans with the Nut AI engine. The ring is how well each dish fits your goal.</p>}

        <section className="dl-section" aria-labelledby="dl-title">
          <div className="dl-section__head">
            <h3 id="dl-title" className="h3"><Icon name="bag" size={18} strokeWidth={2} /> Order it</h3>
            <DeliveryBadge level={delivery.level} label={delivery.level === 'none' ? '' : delivery.level === 'likely' ? 'Likely' : delivery.level === 'osm' ? 'OSM' : `${delivery.yes} confirmed`} size="sm" />
          </div>
          <p className="small" style={{ marginTop: -4 }}>{delivery.reason} Search opens in a new tab.</p>
          <OrderLinks place={place} from="sheet" />
          <DeliveryVote place={place} votes={votes} onVotes={setVotes} />
        </section>

        {children}

        <div className="place-sheet__actions">
          <button className="btn btn-primary" onClick={() => onScan(place)}><Icon name="camera" size={20} /> Scan this menu</button>
          <a className="btn btn-secondary" href={osm} target="_blank" rel="noreferrer"><Icon name="navigate" size={18} /> Open in OpenStreetMap</a>
        </div>
        <p className="small" style={{ textAlign: 'center', marginTop: 12 }}>Restaurant data © OpenStreetMap contributors, ODbL</p>
      </div>
    </>,
    document.body,
  )
}
