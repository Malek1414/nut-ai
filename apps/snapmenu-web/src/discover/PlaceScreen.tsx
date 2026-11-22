// One restaurant in full: open now, address, website, delivery hand-off, seed oils and the dishes the
// community scanned there. One action: scan its menu. Everything else is a quiet row or a link.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { inBerlin } from '../../../snapmenu-api/src/discover/areas'
import { communityDishConfidence, deliveryConfidenceOf, hoursConfidence, type Confidence } from '../../../snapmenu-api/src/discover/confidence'
import { fullAddress, hostOf } from '../../../snapmenu-api/src/discover/osm-tags'
import type { Place, Profile } from '../../../snapmenu-api/src/types'
import { DeliveryBadge, DeliveryVote } from '../components/Delivery'
import { SendToChat, placeCard } from '../friends/ShareToChat'
import { Icon } from '../components/ui'
import { track } from '../lib/api'
import { deliveryConfidence, orderUrl, PROVIDERS, trackOrder, type PlaceVotes } from '../lib/delivery'
import { distance, formatDistance, usePosition } from '../lib/position'
import { DishNums, ExampleBadge, GoalFit } from '../map/RankCard'
import { fetchDetails, type DetailsResponse, type PlaceDetails, type SeedOilView } from './api'
import { ConfidencePill } from './Confidence'
import { hoursNow } from './hours'
import { closeDiscover, discoverBack } from './nav'
import { NO_SEED_OIL_INFO, SeedOilCard } from './SeedOil'
// The dish rows and the fit ring look exactly like the restaurant sheet on the map.
import '../map/map.css'

const KIND: Record<Place['kind'], string> = { restaurant: 'Restaurant', fast_food: 'Fast food', cafe: 'Café' }
const ORDER = { low: 0, medium: 1, high: 2 } as const

/** Icons this screen needs that the shared set does not have, drawn to the same grid and stroke. */
function Glyph({ children }: { children: ReactNode }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
}
const PhoneGlyph = () => <Glyph><path d="M7 4.5h2.6l1.4 3.9-1.9 1.4a10.5 10.5 0 0 0 5.1 5.1l1.4-1.9 3.9 1.4V17a2.5 2.5 0 0 1-2.7 2.5A14.6 14.6 0 0 1 4.5 7.2 2.5 2.5 0 0 1 7 4.5Z" /></Glyph>

export default function PlaceScreen({ place: initial, profile, onScanPlace, onViewMap, onToast }: {
  place: PlaceDetails
  profile: Profile | null
  onScanPlace: (place: Place) => void
  onViewMap: (place: Place) => void
  onToast: (t: string) => void
}) {
  const position = usePosition()
  const user = position.status === 'granted' ? position.position : null
  const [details, setDetails] = useState<DetailsResponse | null>(null)
  const [failed, setFailed] = useState(false)
  const [votes, setVotes] = useState<PlaceVotes | null>(null)
  const [seedOil, setSeedOil] = useState<SeedOilView | null>(null)
  const [week, setWeek] = useState(false)

  useEffect(() => {
    let live = true
    let timer = 0
    const load = (first: boolean) => {
      fetchDetails(initial, profile, first)
        .then((d) => {
          if (!live) return
          setDetails(d)
          setSeedOil(d.seedOil)
          setVotes(d.votes)
          // The restaurant's website is read in the background: look once more for what it says.
          if (d.webPending && first) timer = window.setTimeout(() => load(false), 4500)
        })
        .catch(() => { if (live && first) setFailed(true) })
    }
    load(true)
    track('discover_place', { place: initial.id })
    return () => { live = false; window.clearTimeout(timer) }
    // Only a new restaurant reloads the page.
  }, [initial.id, profile])

  const place = useMemo<PlaceDetails>(() => ({ ...initial, ...(details?.place ?? {}) }), [initial, details])
  const loading = details === null && !failed
  const hours = hoursNow(place, user)
  const hoursConf = hoursConfidence({ hours: place.hours, understood: hours.understood, hoursChecked: place.hoursChecked })
  const dist = user ? distance(user, place) : null
  const delivery = deliveryConfidence(place, dist, votes ? { yes: votes.yes, no: votes.no } : undefined)
  const dishes = details?.dishes ?? []
  const dishConf = useMemo<Confidence | null>(() => {
    const all = dishes.slice(0, 8).map((d) => communityDishConfidence(d))
    return all.reduce<Confidence | null>((worst, c) => (!worst || ORDER[c.level] < ORDER[worst.level] ? c : worst), null)
  }, [dishes])
  const address = fullAddress(place)
  const vegan = place.vegan === 'only' ? 'Vegan' : place.vegan === 'yes' ? 'Vegan options' : null
  const meta = [place.cuisine ?? KIND[place.kind], vegan, dist !== null ? formatDistance(dist) : null].filter(Boolean).join(' · ')
  const osm = `https://www.openstreetmap.org/${place.id[0] === 'w' ? 'way' : place.id[0] === 'r' ? 'relation' : 'node'}/${place.id.slice(1)}`
  const showWeek = hours.rows !== null && (week || !hours.label)

  return (
    <main className="screen with-cta dsc dsc-place">
      <div className="topbar">
        <button className="icon-btn" onClick={discoverBack} aria-label="Back"><Icon name="back" size={20} /></button>
        <button className="btn btn-secondary btn-sm" onClick={() => { closeDiscover(); onViewMap(place) }}><Icon name="map" size={18} /> Map</button>
      </div>

      <header className="dsc-head">
        <h1 className="h1">{place.name}</h1>
        {meta && <p className="body">{meta}</p>}
      </header>

      <section className="card-flat dsc-card" aria-label="Opening hours">
        <div className="dsc-card__head">
          {loading && !place.hours ? <span className="skeleton" style={{ width: 168, height: 32, borderRadius: 999 }} />
            : hours.label ? <span className={`dsc-open dsc-open--lg dsc-open--${hours.label.tone}`}>{hours.label.text}</span>
            : <span className="dsc-quiet">{place.hours ? 'Opening hours' : 'Hours not listed'}</span>}
          <ConfidencePill value={hoursConf} />
        </div>
        {showWeek && (
          <dl className="dsc-hours">
            {hours.rows!.map((r) => <div key={r.days}><dt>{r.days}</dt><dd>{r.hours}</dd></div>)}
          </dl>
        )}
        {place.hours && hours.rows === null && <p className="small dsc-raw">{place.hours}</p>}
        {hours.rows !== null && hours.label && (
          <button type="button" className="link-btn dsc-toggle" aria-expanded={week} onClick={() => setWeek((w) => !w)}>
            {week ? 'Hide hours' : 'All hours'} <Icon name="chevronDown" size={16} />
          </button>
        )}
      </section>

      {(address || place.website || place.menuUrl || place.phone) && (
        <div className="card-flat list-card dsc-info">
          {address && (
            <div className="dsc-info__row">
              <span className="set-row__ic" style={{ background: 'var(--basil-tint)', color: 'var(--basil)' }}><Icon name="pin" size={18} /></span>
              <span className="dsc-info__text">{address}</span>
            </div>
          )}
          {place.website && (
            <a className="dsc-info__row" href={place.website} target="_blank" rel="noopener noreferrer" onClick={() => track('discover_link', { kind: 'website' })}>
              <span className="set-row__ic" style={{ background: 'var(--protein-tint)', color: 'var(--protein)' }}><Icon name="globe" size={18} /></span>
              <span className="dsc-info__text">{hostOf(place.website)}</span>
              <Icon name="external" size={16} strokeWidth={2} />
            </a>
          )}
          {place.menuUrl && (
            <a className="dsc-info__row" href={place.menuUrl} target="_blank" rel="noopener noreferrer" onClick={() => track('discover_link', { kind: 'menu' })}>
              <span className="set-row__ic" style={{ background: 'var(--saffron-tint)', color: '#7a5208' }}><Icon name="receipt" size={18} /></span>
              <span className="dsc-info__text">Menu online</span>
              <Icon name="external" size={16} strokeWidth={2} />
            </a>
          )}
          {place.phone && (
            <a className="dsc-info__row" href={`tel:${place.phone.replace(/[^\d+]/g, '')}`}>
              <span className="set-row__ic" style={{ background: 'var(--carbs-tint)', color: '#7d4f07' }}><PhoneGlyph /></span>
              <span className="dsc-info__text">{place.phone}</span>
            </a>
          )}
        </div>
      )}

      {inBerlin(place) && (
        <section className="card-flat dsc-card" aria-labelledby="dsc-dl">
          <div className="dsc-card__head">
            <h2 id="dsc-dl" className="h3">Delivery</h2>
            <ConfidencePill value={deliveryConfidenceOf(delivery)} />
          </div>
          {delivery.level !== 'none' && <div><DeliveryBadge level={delivery.level} label={delivery.label} size="sm" /></div>}
          <div className="dsc-order" role="group" aria-label={`Order from ${place.name}`}>
            {PROVIDERS.map((p) => (
              <a key={p.id} href={orderUrl(p.id, place)} target="_blank" rel="noopener noreferrer" onClick={() => trackOrder(p.id, place, 'sheet')}>
                <i style={{ background: p.color }} aria-hidden="true" />{p.label}
              </a>
            ))}
          </div>
          <DeliveryVote place={place} votes={votes} onVotes={setVotes} />
          <p className="small">Opens a search in that app. Nothing is ordered here.</p>
        </section>
      )}

      <SeedOilCard place={place} view={seedOil ?? NO_SEED_OIL_INFO} onView={setSeedOil} onToast={onToast} />

      <section className="card-flat dsc-card" aria-labelledby="dsc-dishes">
        <div className="dsc-card__head">
          <h2 id="dsc-dishes" className="h3">Scanned dishes{dishes.length > 0 && <span className="dsc-count num">{dishes.length}</span>}</h2>
          <ConfidencePill value={dishConf} />
        </div>
        {loading ? (
          <span className="skeleton" style={{ height: 15, width: '60%' }} />
        ) : failed ? (
          <p className="small" role="status">Details did not load. Check your connection.</p>
        ) : dishes.length === 0 ? (
          <p className="small">No scans yet. Scan the menu to add the first.</p>
        ) : (
          <div className="place-dishes dsc-dishes">
            {dishes.slice(0, 8).map((d) => (
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
        {dishes.length > 0 && <p className="small">Calories are estimated ranges, never a guarantee.</p>}
      </section>

      <SendToChat card={placeCard(place)} />
      <a className="dsc-credit" href={osm} target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>

      <div className="cta-bar">
        <button className="btn btn-primary" onClick={() => { closeDiscover(); onScanPlace(place) }}>
          <Icon name="camera" size={20} /> Scan menu
        </button>
      </div>
    </main>
  )
}
