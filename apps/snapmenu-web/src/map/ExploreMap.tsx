import { lazy, Suspense, useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { ArrowUpRight, BadgeCheck, Bookmark, Clock3, Crosshair, Leaf, MapPin, Navigation, ScanLine, Search, Share2, ShoppingBag, Target, UserRound, Utensils, X } from 'lucide-react'
import { SendToChat, placeCard } from '../friends/ShareToChat'
import type { DishLite, Place, PlacesResponse, Profile } from '../../../snapmenu-api/src/types'
import { dietOf } from '../../../snapmenu-api/src/types'
import { foldWords } from '../../../snapmenu-api/src/me/taste'
import { openStatus } from '../../../snapmenu-api/src/discover/opening-hours'
import { DeliveryVote } from '../components/Delivery'
import { PlaceMore } from '../discover/DiscoverHost'
import { openLabel as describeHours, placeClock } from '../discover/hours'
import type { PlaceDetails } from '../discover/api'
import { openSearch } from '../discover/nav'
import { cachedPlaces, fetchPlace, fetchPlaces } from '../lib/places'
import { orderUrl, PROVIDERS, trackOrder, type PlaceVotes } from '../lib/delivery'
import { distance, formatDistance, requestPosition, usePosition, type LatLng } from '../lib/position'
import { togglePlace, useSavedPlaces } from '../me/account'
import { social } from '../social'
import { DishNums, GoalFit } from './RankCard'
import { MapList } from './MapList'
import { placeDelivery } from './ranking'
import type { PinData } from './ScoreMap'
import './map.css'
import './explore.css'

const ScoreMap = lazy(() => import('./ScoreMap'))
type Filter = 'goal' | 'diet' | 'open' | 'delivers'
const KIND: Record<Place['kind'], string> = { restaurant: 'Restaurant', fast_food: 'Fast food', cafe: 'Café' }
const CLOSED_SHEET = 250
const localeCuisine = (p: Place) => p.cuisine || KIND[p.kind] || 'Restaurant'
function openLabel(place: PlaceDetails, user: LatLng | null) {
  if (!place.hours) return null
  const now = placeClock(place, user)
  return now ? describeHours(openStatus(place.hours, now), now) : null
}

function Summary({ place, user, centre, dish, example, onOpen }: { place: Place; user: LatLng | null; centre: LatLng; dish?: DishLite; example?: boolean; onOpen: () => void }) {
  const hours = openLabel(place, user)
  return <button type="button" className="explore-place-row" onClick={onOpen}>
    <span className="explore-place-icon"><Utensils size={18} /></span>
    <span className="explore-place-text"><b>{place.name}{place.verified === true && <BadgeCheck className="map-verified-icon" size={13} role="img" aria-label="OSM verified" />}</b><span>{localeCuisine(place)} · {formatDistance(distance(user ?? centre, place))}{!user && ' from center'}</span>
      {(dish || hours) && <span>{hours && <i className={`explore-hours is-${hours.tone}`}>{hours.short}</i>}{hours && dish && ' · '}{dish && <>{dish.name}{example && <small> · Example</small>}</>}</span>}
    </span>
    {dish ? <GoalFit score={dish.score} /> : <ArrowUpRight className="explore-link" size={17} />}
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
  const directions = `https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}&travelmode=walking`
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
      <div className="explore-status">
        {label && <span className={`explore-hours is-${label.tone}`}>{label.text}</span>}
        {place.verified === true && <span className="explore-verified" title="Place identity matched to OpenStreetMap"><BadgeCheck size={14} aria-hidden="true" />OSM verified</span>}
      </div>
      {best && <button className="explore-best" onClick={() => setTab('Menu picks')}>
        <span>{best.example ? 'Example menu pick' : profile ? 'Best dish for your goal' : 'Top menu pick'}<b>{best.name}</b></span>
        <GoalFit score={best.score} />
      </button>}
    <div className="explore-actions" aria-label="Place actions">
      <a href={directions} target="_blank" rel="noreferrer"><span><Navigation size={20} /></span>Directions</a>
        <button type="button" aria-expanded={order} onClick={() => setOrder(!order)}><span><ShoppingBag size={20} /></span>Delivery</button>
      <button type="button" onClick={onScan}><span><ScanLine size={21} /></span>Scan menu</button>
      <button type="button" aria-label={saved ? 'Unsave place' : 'Save place'} aria-pressed={saved} onClick={() => togglePlace(place)}><span><Bookmark size={20} fill={saved ? 'currentColor' : 'none'} /></span>{saved ? 'Saved' : 'Save'}</button>
      <button type="button" onClick={() => social.share({ kind: 'place', place })}><span><Share2 size={20} /></span>Share</button>
    </div>
    {order && <div className="explore-order"><div className="order-row">{PROVIDERS.map((p) => <a key={p.id} href={orderUrl(p.id, place)} target="_blank" rel="noreferrer" onClick={() => trackOrder(p.id, place, 'sheet')}>{p.label}</a>)}</div><DeliveryVote place={place} votes={votes} onVotes={setVotes} /></div>}
    <div className="explore-tabs" role="tablist" aria-label="Place details">{(['Overview', 'Menu picks', 'Posts'] as const).map((name) => <button key={name} id={`explore-tab-${name.split(' ')[0]}`} type="button" role="tab" aria-controls="explore-tab-body" aria-selected={tab === name} onClick={() => setTab(name)}>{name}</button>)}</div>
    <div className="explore-panel-inner" id="explore-tab-body" role="tabpanel" aria-labelledby={`explore-tab-${tab.split(' ')[0]}`}>
      {tab === 'Overview' && <>
        <SendToChat card={placeCard(place)} />
        <div className="explore-address"><MapPin size={18} /><span>{place.address || 'Address not listed'}</span></div>
        <PlaceMore place={place} quiet />
      </>}
        {tab === 'Menu picks' && (error ? <div className="explore-empty"><span>Menu picks didn’t load.</span><button className="link-btn" onClick={() => setRetry((n) => n + 1)}>Try again</button></div> : !dishes ? <Skeleton /> : dishes.length ? <MapList items={dishes} label="Menu picks" className="explore-dishes" row={(d, i) => <li key={`${d.name}-${i}`}><div><b>{d.name}</b><DishNums dish={d} /><p>{d.example && 'Example · '}{d.why}</p></div><GoalFit score={d.score} /></li>} /> : <div className="explore-empty"><span>No menu picks yet</span><button className="link-btn" onClick={onScan}>Scan a menu</button></div>)}
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
  const [search, setSearch] = useState('')
  const [queryAt, setQueryAt] = useState<LatLng | null>(focusPlace ?? null)
  const query = queryAt ?? pos.position
  const [selected, setActive] = useState<Place | null>(() => focusPlace ? { ...focusPlace, verified: false } : null)
  const [data, setData] = useState<PlacesResponse | null>(() => cachedPlaces(query.lat, query.lng, profile))
  // A deep link can carry an old or community-supplied label. Only the loaded OSM area can verify it.
  const active = selected ? data?.places.find((p) => p.id === selected.id) ?? selected : null
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  const [nonce, setNonce] = useState(0)
  const [info, setInfo] = useState('')
  const [centre, setCentre] = useState<LatLng | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [offset, setOffset] = useState<number | null>(null)
  const [openTick, setOpenTick] = useState(0)
  const drag = useRef<{ y: number; start: number } | null>(null)
  const skipClick = useRef(false)
  useEffect(() => { const t = window.setInterval(() => setOpenTick((n) => n + 1), 60_000); return () => window.clearInterval(t) }, [])
  useEffect(() => {
    let live = true
    setLoading(true); setFailed(false)
    setData(cachedPlaces(query.lat, query.lng, profile))
    fetchPlaces(query.lat, query.lng, profile, retry > 0).then((res) => {
      if (!live) return
      setFailed(res.source === 'unavailable')
      if (res.source !== 'unavailable' || res.places.length) setData(res)
    }).catch(() => { if (live) setFailed(true) }).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [query.lat, query.lng, profile, retry])
  const vegetarian = profile ? dietOf(profile) === 'vegetarian' : false
  const dietLabel = vegetarian ? 'Vegetarian' : 'Vegan'
  const hasHours = useMemo(() => data?.places.some((p) => openLabel(p, user) !== null), [data, user, openTick])
  const openOnly = Boolean(hasHours && filters.includes('open'))
  const choices: Array<{ id: Filter; label: string; Icon: typeof Target }> = [
    { id: 'goal', label: 'Goal fit', Icon: Target },
    { id: 'diet', label: dietLabel, Icon: Leaf },
    ...(hasHours ? [{ id: 'open' as const, label: 'Open now', Icon: Clock3 }] : []),
    { id: 'delivers', label: 'Delivery', Icon: ShoppingBag },
  ]
  const ranked = useMemo(() => {
    const byGoal = filters.includes('goal')
    return (data?.places ?? []).flatMap(place => {
      const summary = data?.scored[place.id]
      if (byGoal && !summary) return []
      if (filters.includes('delivers') && placeDelivery(place, user, data?.deliveryVotes ?? {}).level === 'none') return []
      if (filters.includes('diet')) {
        const vegan = place.vegan || summary?.best.vegan
        if (!vegan && !(vegetarian && (place.vegetarian || summary?.best.vegetarian))) return []
      }
      if (openOnly) {
        const status = openLabel(place, user)
        if (!status || status.tone === 'closed') return []
      }
      return [{ place, text: foldWords(`${place.name} ${place.cuisine ?? ''}`), distance: distance(query, place), score: summary?.best.score ?? -1 }]
    }).sort((a, b) => (byGoal ? b.score - a.score : Number(b.score >= 0) - Number(a.score >= 0)) || a.distance - b.distance)
  }, [data, filters, openOnly, user, query, vegetarian, openTick])
  const term = foldWords(search.trim())
  const listed = useMemo(() => ranked.filter(row => row.text.includes(term)).map(row => row.place), [ranked, term])
  const pins = useMemo<PinData[]>(() => {
    const shown = active && !listed.some((p) => p.id === active.id) ? [active, ...listed] : listed
    return shown.map((p, i) => { const s = data?.scored[p.id]; return { id: p.id, lat: p.lat, lng: p.lng, name: p.name, order: i, isExample: Boolean(s?.example), dish: s ? { kcal: s.best.kcal.mid, score: s.best.score, protein: s.best.protein } : null, ...(!s && p.id === active?.id ? { label: p.name } : {}) } })
  }, [listed, active, data])
  const openPlace = (id: string) => { const place = listed.find((p) => p.id === id); if (place) { setActive(place); setExpanded(false); setOffset(null) } }
  async function locate() {
    setInfo('Finding your location…')
    const s = await requestPosition()
    if (s.status === 'granted') { setInfo(''); setQueryAt(null); setActive(null); setNonce((n) => n + 1) }
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
  const area = queryAt ? 'This area' : user ? 'Near you' : 'Berlin Mitte'
  const listTitle = term ? 'Search results' : filters.includes('goal') ? (profile ? 'Best for your goal' : 'Menu picks') : area
  const empty = term ? 'No matching name or cuisine here.' : 'No places match these filters.'
  function clearFilters() { setFilters([]); setSearch('') }
  return <main className="explore" aria-label="Explore map" style={{ '--peek': `${sheet}px`, ...(offset === null ? {} : { '--drag-height': `${offset}px` }) } as React.CSSProperties}>
    <Suspense fallback={<div className="score-map score-map--loading" aria-busy="true" />}>
      <ScoreMap liberty pins={pins} metric="score" activeId={active?.id ?? null} onSelect={openPlace} onOpen={openPlace} user={user} focus={query} frameKey={frameKey} locateNonce={nonce} insets={{ top: 112, bottom: sheet }} onMoveEnd={setCentre} />
    </Suspense>
    <div className="explore-chrome">
      <div className="explore-search" role="search">
        <Search size={20} aria-hidden="true" />
        <input type="search" placeholder="Search name or cuisine" aria-label="Search restaurants by name or cuisine in this area" autoComplete="off" enterKeyHint="search" value={search}
          onChange={(e) => { setSearch(e.target.value); setActive(null) }}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} />
        {search && <button className="explore-clear" type="button" aria-label="Clear search" onClick={() => setSearch('')}><X size={16} /></button>}
        <button type="button" className="explore-avatar" aria-label="Me and account" onClick={onMe}>{username ? username[0]?.toUpperCase() : <UserRound size={17} />}</button>
      </div>
      <div className="explore-chips" role="group" aria-label="Map filters">{choices.map(({ id, label, Icon }) => <button type="button" key={id} aria-pressed={filters.includes(id)} onClick={() => { setActive(null); setFilters((f) => f.includes(id) ? f.filter((x) => x !== id) : [...f, id]) }}><Icon size={15} />{label}</button>)}</div>
      {centre && distance(query, centre) > 900 && !active && <button type="button" className="explore-here" onClick={() => { setQueryAt(centre); setInfo('') }}><Search size={16} /> Search this area</button>}
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
          <header className="explore-list-header"><h1>{listTitle}</h1>{data && <span aria-live="polite">{listed.length} {listed.length === 1 ? 'place' : 'places'}</span>}</header>
          {data && (failed || data.source === 'stale' || data.source === 'nearby') && <p className="explore-cache-note" role="status">{data.source === 'unavailable' ? 'Map data is busy. Showing available menu picks.' : data.source === 'nearby' ? 'Showing saved places nearby.' : 'Showing saved places for this area.'}</p>}
          {failed && !data ? <div className="explore-empty"><span>Nearby places are temporarily unavailable.</span><button className="link-btn" onClick={() => setRetry((n) => n + 1)}>Retry</button></div>
            : loading && !data ? <Skeleton />
            : listed.length ? <MapList key={`${frameKey}|${term}|${filters.join(',')}`} label="Places" items={listed} className="explore-list" row={p => <li key={p.id}><Summary place={p} user={user} centre={query} dish={data?.scored[p.id]?.best} example={data?.scored[p.id]?.example} onOpen={() => openPlace(p.id)} /></li>} />
            : <div className="explore-empty"><span>{term || filters.length ? empty : 'No places found here.'}</span>{Boolean(term || filters.length) && <button className="link-btn" onClick={clearFilters}>Clear filters</button>}</div>}
          <button type="button" className="explore-area" onClick={openSearch}><MapPin size={16} />Find another area</button>
        </>}
      </div>
    </section>
  </main>
}
