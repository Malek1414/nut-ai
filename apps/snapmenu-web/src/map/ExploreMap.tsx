import { lazy, Suspense, useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { ArrowUpRight, Bookmark, Clock3, Crosshair, Dumbbell, Leaf, MapPin, Navigation, ScanLine, Search, Share2, ShoppingBag, UserRound, Utensils, X } from 'lucide-react'
import type { DishLite, Place, PlacesResponse, Profile } from '../../../snapmenu-api/src/types'
import { DeliveryVote } from '../components/Delivery'
import { PlaceMore } from '../discover/DiscoverHost'
import { hoursNow } from '../discover/hours'
import type { PlaceDetails } from '../discover/api'
import { openSearch } from '../discover/nav'
import { fetchPlace, fetchPlaces } from '../lib/places'
import { orderUrl, PROVIDERS, trackOrder, type PlaceVotes } from '../lib/delivery'
import { distance, formatDistance, requestPosition, usePosition, type LatLng } from '../lib/position'
import { togglePlace, useSavedPlaces } from '../me/account'
import { social } from '../social'
import { DishNums, ScoreRing } from './RankCard'
import { placeDelivery, PROTEIN_GOAL_G } from './ranking'
import type { PinData } from './ScoreMap'
import './map.css'
import './explore.css'

const ScoreMap = lazy(() => import('./ScoreMap'))
const chips = [{ id: 'restaurants', label: 'Restaurants', Icon: Utensils }, { id: 'delivers', label: 'Delivers', Icon: ShoppingBag }, { id: 'protein', label: 'High protein', Icon: Dumbbell }, { id: 'vegan', label: 'Vegan', Icon: Leaf }, { id: 'open', label: 'Open now', Icon: Clock3 }] as const
type Filter = typeof chips[number]['id']
const KIND: Record<Place['kind'], string> = { restaurant: 'Restaurant', fast_food: 'Fast food', cafe: 'Café' }
const CLOSED_SHEET = 250
const localeCuisine = (p: Place) => p.cuisine || KIND[p.kind] || 'Restaurant'
const openLabel = (p: Place, user: LatLng | null) => hoursNow(p as PlaceDetails, user).label

function Summary({ place, user, centre, dish, example, onOpen }: { place: Place; user: LatLng | null; centre: LatLng; dish?: DishLite; example?: boolean; onOpen: () => void }) {
  const hours = openLabel(place, user)
  return <button type="button" className="explore-place-row" onClick={onOpen}>
    <span className="explore-place-icon"><Utensils size={18} /></span>
    <span className="explore-place-text"><b>{place.name}</b><span>{localeCuisine(place)} · {formatDistance(distance(user ?? centre, place))}{!user && ' from center'}</span>
      {(dish || hours) && <span>{hours && <i className={`explore-hours is-${hours.tone}`}>{hours.short}</i>}{hours && dish && ' · '}{dish && <>{dish.name}{example && <small> · Example</small>}</>}</span>}
    </span>
    {dish ? <ScoreRing score={dish.score} size={32} /> : <ArrowUpRight className="explore-link" size={17} />}
  </button>
}

function PlacePanel({ place, initial, user, centre, profile, onClose, onScan, posts }: { place: Place; initial?: DishLite; user: LatLng | null; centre: LatLng; profile: Profile | null; onClose: () => void; onScan: () => void; posts: ReactNode }) {
  const [tab, setTab] = useState<'Overview' | 'Menu picks' | 'Posts'>('Overview')
  const [dishes, setDishes] = useState<DishLite[] | null>(null)
  const [votes, setVotes] = useState<PlaceVotes | null>(null)
  const [order, setOrder] = useState(false)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)
  const saved = useSavedPlaces().some((p) => p.id === place.id)
  const label = openLabel(place, user)
  const best = dishes?.[0] ?? initial
  const directions = user ? `https://www.openstreetmap.org/directions?engine=fossgis_osrm_foot&route=${user.lat},${user.lng};${place.lat},${place.lng}` : `https://www.openstreetmap.org/?mlat=${place.lat}&mlon=${place.lng}#map=17/${place.lat}/${place.lng}`
  useEffect(() => {
    let live = true
    setError(false)
    fetchPlace(place.id, profile).then((r) => { if (live) { setDishes(r.dishes); setVotes(r.votes ?? null) } }).catch(() => { if (live) setError(true) })
    return () => { live = false }
  }, [place.id, profile, retry])
  useEffect(() => {
    function back(e: KeyboardEvent) { if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('[aria-modal="true"]')) onClose() }
    window.addEventListener('keydown', back)
    return () => window.removeEventListener('keydown', back)
  }, [onClose])
  return <section className="explore-panel" aria-label={place.name}>
    <header><span><h2>{place.name}</h2><span className="explore-place-meta">{localeCuisine(place)} · {formatDistance(distance(user ?? centre, place))}{!user && ' from center'}</span></span><button type="button" className="explore-close" aria-label="Close place" onClick={onClose}><X size={20} /></button></header>
    <div className="explore-status"><span className={label ? `explore-hours is-${label.tone}` : ''}>{label?.text ?? 'Hours not listed'}</span>{best && <span className="explore-fit">{best.score}% fit{best.example ? ' · Example' : ''}</span>}</div>
    <div className="explore-actions" aria-label="Place actions">
      <a href={directions} target="_blank" rel="noreferrer"><span><Navigation size={20} /></span>Directions</a>
      <button type="button" aria-expanded={order} onClick={() => setOrder(!order)}><span><ShoppingBag size={20} /></span>Order</button>
      <button type="button" onClick={onScan}><span><ScanLine size={21} /></span>Scan menu</button>
      <button type="button" aria-label={saved ? 'Unsave place' : 'Save place'} aria-pressed={saved} onClick={() => togglePlace(place)}><span><Bookmark size={20} fill={saved ? 'currentColor' : 'none'} /></span>{saved ? 'Saved' : 'Save'}</button>
      <button type="button" onClick={() => social.share({ kind: 'place', place })}><span><Share2 size={20} /></span>Share</button>
    </div>
    {order && <div className="explore-order"><div className="order-row">{PROVIDERS.map((p) => <a key={p.id} href={orderUrl(p.id, place)} target="_blank" rel="noreferrer" onClick={() => trackOrder(p.id, place, 'sheet')}>{p.label}</a>)}</div><DeliveryVote place={place} votes={votes} onVotes={setVotes} /></div>}
    <div className="explore-tabs" role="tablist" aria-label="Place details">{(['Overview', 'Menu picks', 'Posts'] as const).map((name) => <button key={name} id={`explore-tab-${name.split(' ')[0]}`} type="button" role="tab" aria-controls="explore-tab-body" aria-selected={tab === name} onClick={() => setTab(name)}>{name}</button>)}</div>
    <div className="explore-panel-inner" id="explore-tab-body" role="tabpanel" aria-labelledby={`explore-tab-${tab.split(' ')[0]}`}>
      {tab === 'Overview' && <>
        <div className="explore-address"><MapPin size={18} /><span>{place.address || 'Address not listed'}</span></div>
        {best && <button className="explore-best" onClick={() => setTab('Menu picks')}><span>Top menu pick<b>{best.name}</b><small>{best.example ? 'Example · ' : ''}Estimated nutrition</small></span><ArrowUpRight size={16} /></button>}
        <PlaceMore place={place} quiet />
      </>}
      {tab === 'Menu picks' && (error ? <div className="explore-empty"><span>Menu picks didn’t load.</span><button className="link-btn" onClick={() => setRetry((n) => n + 1)}>Try again</button></div> : !dishes ? <Skeleton /> : dishes.length ? <ul className="explore-dishes">{dishes.map((d, i) => <li key={`${d.name}-${i}`}><div><b>{d.name}</b><DishNums dish={d} /><p>{d.example && 'Example · '}{d.why}</p></div><ScoreRing score={d.score} size={34} /></li>)}</ul> : <div className="explore-empty"><span>No menu picks yet</span><button className="link-btn" onClick={onScan}>Scan a menu</button></div>)}
      {tab === 'Posts' && (posts ?? <p className="small">No posts for this place yet.</p>)}
    </div>
  </section>
}
function Skeleton() { return <div className="explore-skel" aria-label="Loading places" role="status">{[0, 1, 2].map((i) => <div key={i}><i className="skeleton" /><span><i className="skeleton" /><i className="skeleton" /></span></div>)}</div> }

export function ExploreMap({ profile, onScanPlace, onMe, username, focusPlace, renderPosts, deliveryMode = false }: {
  profile: Profile | null; onScanPlace: (place: Place) => void; onScan: () => void; onMe: () => void; username?: string; focusPlace?: Place | null; renderPosts: (place: Place) => ReactNode; deliveryMode?: boolean
}) {
  const pos = usePosition()
  const user = pos.status === 'granted' ? pos.position : null
  const [filters, setFilters] = useState<Filter[]>(deliveryMode ? ['delivers'] : [])
  const [queryAt, setQueryAt] = useState<LatLng | null>(focusPlace ?? null)
  const query = queryAt ?? pos.position
  const [active, setActive] = useState<Place | null>(focusPlace ?? null)
  const [data, setData] = useState<PlacesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  const [nonce, setNonce] = useState(0)
  const [info, setInfo] = useState('')
  const [centre, setCentre] = useState<LatLng | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [offset, setOffset] = useState<number | null>(null)
  const [openTick, setOpenTick] = useState(0)
  const [limit, setLimit] = useState(45)
  const drag = useRef<{ y: number; start: number } | null>(null)
  const skipClick = useRef(false)
  useEffect(() => { const t = window.setInterval(() => setOpenTick((n) => n + 1), 60_000); return () => window.clearInterval(t) }, [])
  useEffect(() => {
    let live = true
    setLoading(true); setFailed(false)
    setData((p) => p && distance(p.center, query) < 1500 ? p : null)
    fetchPlaces(query.lat, query.lng, profile, retry > 0).then((res) => {
      if (!live) return
      setFailed(res.source === 'unavailable'); setData(res)
    }).catch(() => { if (live) setFailed(true) }).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [query.lat, query.lng, profile, retry])
  const listed = useMemo(() => (data?.places ?? []).filter((p) => {
    const best = data?.scored[p.id]?.best
    if (filters.includes('restaurants') && p.kind !== 'restaurant') return false
    if (filters.includes('delivers') && placeDelivery(p, user, data?.deliveryVotes ?? {}).level === 'none') return false
    if (filters.includes('protein') && (!best || best.protein < PROTEIN_GOAL_G)) return false
    if (filters.includes('vegan') && !p.vegan && !best?.vegan) return false
    if (filters.includes('open') && !['open', 'soon'].includes(openLabel(p, user)?.tone ?? '')) return false
    return true
  }).sort((a, b) => Number(Boolean(data?.scored[b.id])) - Number(Boolean(data?.scored[a.id])) || distance(query, a) - distance(query, b)), [data, filters, user, query, openTick])
  const pins = useMemo<PinData[]>(() => {
    const shown = active && !listed.some((p) => p.id === active.id) ? [active, ...listed] : listed
    return shown.map((p, i) => { const s = data?.scored[p.id]; return { id: p.id, lat: p.lat, lng: p.lng, name: p.name, order: i, isExample: Boolean(s?.example), dish: s ? { kcal: s.best.kcal.mid, score: s.best.score, protein: s.best.protein } : null, ...(!s && p.id === active?.id ? { label: p.name } : {}) } })
  }, [listed, active, data])
  const openPlace = (id: string) => { const place = listed.find((p) => p.id === id); if (place) { setActive(place); setExpanded(false); setOffset(null) } }
  async function locate() {
    setInfo('Finding your location…')
    const s = await requestPosition()
    if (s.status === 'granted') { setInfo(''); setLimit(45); setQueryAt(null); setActive(null); setNonce((n) => n + 1) }
    else setInfo(s.status === 'denied' ? 'Allow location in your browser settings.' : 'Location not available. Search by area instead.')
  }
  function finish(e: PointerEvent<HTMLButtonElement>) {
    if (!drag.current) return
    const delta = drag.current.y - e.clientY
    drag.current = null; setOffset(null)
    if (Math.abs(delta) > 24) { skipClick.current = true; setExpanded(delta > 0) }
  }
  const sheet = active ? 346 : CLOSED_SHEET
  const frameKey = `${query.lat.toFixed(4)}:${query.lng.toFixed(4)}:${data ? 'loaded' : 'empty'}`
  return <main className="explore" aria-label="Explore map" style={{ '--peek': `${sheet}px`, ...(offset === null ? {} : { '--drag-height': `${offset}px` }) } as React.CSSProperties}>
    <Suspense fallback={<div className="score-map score-map--loading" aria-busy="true" />}>
      <ScoreMap liberty pins={pins} metric="score" activeId={active?.id ?? null} onSelect={openPlace} onOpen={openPlace} user={user} focus={query} frameKey={frameKey} locateNonce={nonce} insets={{ top: 112, bottom: sheet }} onMoveEnd={setCentre} />
    </Suspense>
    <div className="explore-chrome">
      <div className="explore-search"><button type="button" onClick={openSearch}><Search size={21} /> <span>Search restaurants or areas</span></button><button type="button" className="explore-avatar" aria-label="Me and account" onClick={onMe}>{username ? username[0]?.toUpperCase() : <UserRound size={17} />}</button></div>
      <div className="explore-chips" role="group" aria-label="Map filters">{chips.map(({ id, label, Icon }) => <button type="button" key={id} aria-pressed={filters.includes(id)} onClick={() => { setActive(null); setLimit(45); setFilters((f) => f.includes(id) ? f.filter((x) => x !== id) : [...f, id]) }}><Icon size={16} />{label}</button>)}</div>
      {centre && distance(query, centre) > 900 && !active && <button type="button" className="explore-here" onClick={() => { setQueryAt(centre); setInfo(''); setLimit(45) }}><Search size={16} /> Search this area</button>}
    </div>
    {info && <button type="button" className="explore-location-note" onClick={() => setInfo('')}>{info} <X size={15} /></button>}
    <section className={`explore-sheet ${expanded ? 'is-expanded' : ''} ${offset === null ? '' : 'is-dragging'}`} aria-label={active ? 'Restaurant panel' : 'Nearby places'}>
      <button type="button" className="explore-locate" aria-label="My location" disabled={pos.status === 'locating'} onClick={() => void locate()}><Crosshair size={23} /></button>
      <button type="button" className="explore-handle" aria-label={expanded ? 'Collapse place list' : 'Expand place list'} aria-expanded={expanded}
        onPointerDown={(e) => { if (e.button !== 0) return; skipClick.current = false; drag.current = { y: e.clientY, start: e.currentTarget.parentElement?.offsetHeight ?? sheet }; e.currentTarget.setPointerCapture(e.pointerId) }}
        onPointerMove={(e) => { const d = drag.current; if (d && Math.abs(d.y - e.clientY) > 5) setOffset(Math.min(window.innerHeight - 150, Math.max(166, d.start + d.y - e.clientY))) }}
        onPointerUp={finish} onPointerCancel={() => { drag.current = null; setOffset(null) }} onClick={() => { if (skipClick.current) { skipClick.current = false; return }; setExpanded((v) => !v) }}><span /></button>
      <div className="explore-scroll" key={active?.id ?? 'places'}>
        {active ? <PlacePanel key={active.id} place={active} initial={data?.scored[active.id]?.best} profile={profile} user={user} centre={query} onClose={() => { setActive(null); setExpanded(false) }} onScan={() => onScanPlace(active)} posts={renderPosts(active)} /> : <>
          <header className="explore-list-header"><h1>{queryAt ? 'Explore this area' : user ? 'Near you' : 'Berlin Mitte'}</h1>{loading ? <span className="skeleton" style={{ width: 54, height: 11 }} /> : !failed && <span>{listed.length} places</span>}</header>
          {failed ? <div className="explore-empty"><span>Places didn’t load.</span><button className="link-btn" onClick={() => setRetry((n) => n + 1)}>Try again</button></div> : loading && !data ? <Skeleton /> : !listed.length ? <div className="explore-empty"><span>{filters.length ? 'No places match these filters.' : 'No places found here.'}</span><button className="link-btn" onClick={() => filters.length ? setFilters([]) : openSearch()}>{filters.length ? 'Clear filters' : 'Search another area'}</button></div> : <ul className="explore-list">{listed.slice(0, limit).map((p) => <li key={p.id}><Summary place={p} user={user} centre={query} dish={data?.scored[p.id]?.best} example={data?.scored[p.id]?.example} onOpen={() => openPlace(p.id)} /></li>)}{listed.length > limit && <li><button className="link-btn explore-more" onClick={() => setLimit((n) => n + 45)}>Show more places</button></li>}</ul>}
        </>}
      </div>
    </section>
  </main>
}
