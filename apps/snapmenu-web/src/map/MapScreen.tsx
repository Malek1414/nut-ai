// Map adapted from the team's wohin app (apps/web/src/screens/map/MapScreen.tsx), restyled to Snapmenu.
// One row of controls on top (area, delivery, filters), the map, one row of dish cards synced with the pins,
// and a slim sheet that pulls up into the full list. Restaurants come from OpenStreetMap; dishes and numbers
// come from Snapmenu scans the community filed under a restaurant.
import { motion, useReducedMotion } from 'framer-motion'
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Place, PlacesResponse, Profile } from '../../../snapmenu-api/src/types'
import { DeliveryBadge } from '../components/Delivery'
import { Icon } from '../components/ui'
import { openSearch } from '../discover/nav'
import { fetchPlaces } from '../lib/places'
import { declinePosition, distance, formatDistance, requestPosition, usePosition, type LatLng, type PositionState } from '../lib/position'
import { KiezPicker } from './KiezPicker'
import { springTransition } from './motion'
import { PlaceSheet } from './PlaceSheet'
import { RankCard, RankCardSkeleton, RankRow } from './RankCard'
import { BUDGET_EUR, dishCount, KIEZ_CENTRE, placeDelivery, PROTEIN_GOAL_G, rankingTitle, rankResults, type DeliveryVotesMap, type DishResult, type MapChoice } from './ranking'
import { RankSheet } from './RankSheet'
import type { MapInsets, PinData, PinMetric } from './ScoreMap'
import './map.css'

const ScoreMap = lazy(() => import('./ScoreMap'))

function readStored<T>(key: string, fallback: T): T {
  try {
    const v = window.localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}
function writeStored(key: string, v: unknown) {
  try { window.localStorage.setItem(key, JSON.stringify(v)) } catch { /* ignore */ }
}

const DEFAULT_CHOICE: MapChoice = { kiez: null, underBudget: false, proteinPlus: false, delivers: false }

/** Height of an element, kept current. */
function useHeight<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null)
  const [height, setHeight] = useState(fallback)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setHeight(el.offsetHeight)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, height] as const
}

// ---------- Controls ----------

function Pill({ pressed, onClick, icon, children, small = false }: { pressed: boolean; onClick: () => void; icon?: string; children: ReactNode; small?: boolean }) {
  return (
    <button type="button" className={`map-pill ${small ? 'map-pill--sm' : ''}`} aria-pressed={pressed} onClick={onClick}>
      {icon && <Icon name={icon} size={16} strokeWidth={1.9} />}
      {children}
    </button>
  )
}

function FiltersIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
      <path d="M4 8h9m5 0h2M4 16h2m5 0h9" />
      <circle cx="15.5" cy="8" r="2.5" />
      <circle cx="8.5" cy="16" r="2.5" />
    </svg>
  )
}

function MetricToggle({ metric, onChange }: { metric: PinMetric; onChange: (m: PinMetric) => void }) {
  const reduce = useReducedMotion()
  const options: Array<{ value: PinMetric; label: string }> = [
    { value: 'kcal', label: 'kcal' },
    { value: 'score', label: 'Fit' },
  ]
  return (
    <div className="metric-toggle" role="radiogroup" aria-label="Number on the pins">
      {options.map((o) => {
        const on = metric === o.value
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} className="metric-toggle__option" onClick={() => onChange(o.value)}>
            {on && <motion.span layoutId="metric-indicator" className="metric-toggle__indicator" transition={reduce ? { duration: 0 } : springTransition('state')} />}
            <span className="metric-toggle__label">{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}

const LOCATE_LABEL: Record<PositionState['status'], string> = {
  granted: 'Go to my position',
  locating: 'Locating',
  denied: 'Location is blocked',
  unavailable: 'No location',
  fallback: 'Near me',
}

function LocateButton({ status, onLocate }: { status: PositionState['status']; onLocate: () => void }) {
  return (
    <button type="button" className={`locate-btn is-${status}`} onClick={onLocate} disabled={status === 'locating'} aria-label={LOCATE_LABEL[status]}>
      {status === 'locating' ? <span className="map-spin" /> : <Icon name="locate" size={20} strokeWidth={1.9} />}
    </button>
  )
}

// ---------- Carousel of dish cards, synced with the pins ----------

function Carousel({ items, activeId, onActive, onOpen }: { items: DishResult[]; activeId: string | null; onActive: (id: string) => void; onOpen: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const settle = useRef(0)
  const fromScroll = useRef(false)
  const mounted = useRef(false)
  const reduce = useReducedMotion()

  // Bring the active restaurant's card into the centre when the selection comes from a pin.
  useEffect(() => {
    const el = ref.current
    const first = !mounted.current
    mounted.current = true
    if (!el || !activeId) return
    if (fromScroll.current) {
      fromScroll.current = false
      return
    }
    const i = items.findIndex((x) => x.place.id === activeId)
    const card = el.children[i] as HTMLElement | undefined
    if (!card) return
    el.scrollTo({ left: card.offsetLeft - (el.clientWidth - card.offsetWidth) / 2, behavior: first || reduce ? 'auto' : 'smooth' })
  }, [activeId, items, reduce])

  useEffect(() => () => window.clearTimeout(settle.current), [])

  const onScroll = () => {
    window.clearTimeout(settle.current)
    settle.current = window.setTimeout(() => {
      const el = ref.current
      if (!el) return
      const centre = el.scrollLeft + el.clientWidth / 2
      let best = -1
      let bestDistance = Infinity
      Array.from(el.children).forEach((child, i) => {
        const c = child as HTMLElement
        const d = Math.abs(c.offsetLeft + c.offsetWidth / 2 - centre)
        if (d < bestDistance) {
          bestDistance = d
          best = i
        }
      })
      const id = items[best]?.place.id
      if (id && id !== activeId) {
        fromScroll.current = true
        onActive(id)
      }
    }, 140)
  }

  return (
    <div ref={ref} className="carousel" onScroll={onScroll} role="list" aria-label="Best dish per restaurant">
      {items.map((result, i) => (
        <motion.div
          key={result.place.id}
          role="listitem"
          className="carousel__item"
          initial={reduce ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={springTransition('appear', 60 + Math.min(i, 3) * 50)}
          onFocus={() => {
            if (result.place.id !== activeId) {
              fromScroll.current = false
              onActive(result.place.id)
            }
          }}
        >
          <RankCard result={result} active={result.place.id === activeId} className="carousel__card" onOpen={() => onOpen(result.place.id)} />
        </motion.div>
      ))}
    </div>
  )
}

/** One line and one button, in the place of the cards: nothing to show, or something went wrong. */
function Note({ text, action, icon, primary = false, onAction }: { text: string; action: string; icon?: string; primary?: boolean; onAction: () => void }) {
  return (
    <div className="map-note" role="status">
      <span className="map-note__text">{text}</span>
      <button type="button" className={`map-note__btn ${primary ? 'is-primary' : ''}`} onClick={onAction}>
        {icon && <Icon name={icon} size={16} strokeWidth={2} />}
        {action}
      </button>
    </div>
  )
}

function PositionAsk({ top, onAllow, onDecline }: { top: number; onAllow: () => void; onDecline: () => void }) {
  return (
    <div className="map-ask" role="dialog" aria-labelledby="map-ask-title" style={{ top }}>
      <span className="map-ask__ic"><Icon name="locate" size={20} /></span>
      <span className="map-ask__text">
        <b id="map-ask-title">Places near you?</b>
        <span>Only used to find them.</span>
      </span>
      <button type="button" className="map-ask__allow" onClick={onAllow}>Allow</button>
      <button type="button" className="map-ask__no" onClick={onDecline} aria-label="Not now"><Icon name="close" size={18} /></button>
    </div>
  )
}

// ---------- Screen ----------

export function MapScreen({ profile, onScanPlace, onScan, focusPlace, renderPlaceExtras, deliveryMode = false }: {
  profile: Profile | null
  /** "Scan this menu" in a restaurant sheet. */
  onScanPlace: (place: Place) => void
  onScan: () => void
  /** Open this restaurant's sheet on arrival (e.g. from a post). */
  focusPlace?: Place | null
  renderPlaceExtras?: (place: Place) => ReactNode
  /** Arrived from "Healthy delivery near me": start with the Delivers filter on and the goal-fit ranking. */
  deliveryMode?: boolean
}) {
  const position = usePosition()
  const reduce = useReducedMotion()
  const [choice, setChoiceState] = useState<MapChoice>(() => {
    const stored = { ...DEFAULT_CHOICE, ...readStored<MapChoice>('snapmenu.map.choice', DEFAULT_CHOICE) }
    if (!deliveryMode) return stored
    const next = { ...stored, delivers: true }
    writeStored('snapmenu.map.choice', next)
    return next
  })
  const [metric, setMetricState] = useState<PinMetric>(() => (deliveryMode ? 'score' : readStored<PinMetric>('snapmenu.map.metric', profile?.goal === 'build_muscle' ? 'score' : 'kcal')))
  const [votes, setVotes] = useState<DeliveryVotesMap>({})
  const [active, setActive] = useState<string | null>(focusPlace?.id ?? null)
  const [expanded, setExpanded] = useState(false)
  const [kiezOpen, setKiezOpen] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const hintTimer = useRef(0)
  const [locateNonce, setLocateNonce] = useState(0)
  const [openId, setOpenId] = useState<string | null>(focusPlace?.id ?? null)
  const [extraPlace] = useState<Place | null>(focusPlace ?? null)
  const [chromeRef, chromeHeight] = useHeight<HTMLDivElement>(64)
  const [layerRef, layerHeight] = useHeight<HTMLDivElement>(160)
  const [sheetHead, setSheetHead] = useState(56)
  // Opening a restaurant from elsewhere: only load a new area when it is far from the usual one.
  const [searchAt, setSearchAt] = useState<LatLng | null>(() => {
    if (!focusPlace) return null
    const usual = choice.kiez ? KIEZ_CENTRE[choice.kiez] : position.position
    return distance(usual, focusPlace) > 1500 ? { lat: focusPlace.lat, lng: focusPlace.lng } : null
  })
  const [mapCentre, setMapCentre] = useState<LatLng | null>(null)
  const [data, setData] = useState<PlacesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const retries = useRef(0)

  const setChoice = (next: MapChoice) => { setChoiceState(next); writeStored('snapmenu.map.choice', next) }
  const setMetric = (m: PinMetric) => { setMetricState(m); writeStored('snapmenu.map.metric', m) }

  const user: LatLng | null = position.status === 'granted' ? position.position : null
  const query: LatLng = searchAt ?? (choice.kiez ? KIEZ_CENTRE[choice.kiez] : position.position)
  const queryKey = `${query.lat.toFixed(3)},${query.lng.toFixed(3)}`

  // Load the restaurants around the query point; while OpenStreetMap is busy, try again with a growing pause.
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    let live = true
    let timer = 0
    setLoading(true)
    setFailed(false)
    // A different part of town: drop the old list instead of showing it under the new name.
    setData((d) => (d && distance(d.center, query) > 1500 ? null : d))
    fetchPlaces(query.lat, query.lng, profile)
      .then((d) => {
        if (!live) return
        setData(d)
        setLoading(false)
        if ((d.source === 'unavailable' || d.source === 'nearby') && retries.current < 4) {
          const wait = 6 * 2 ** retries.current
          retries.current += 1
          timer = window.setTimeout(() => live && setNonce((n) => n + 1), wait * 1000)
        } else if (d.source !== 'unavailable') {
          retries.current = 0
        }
      })
      .catch(() => { if (live) { setLoading(false); setFailed(true) } })
    return () => { live = false; window.clearTimeout(timer) }
    // query is captured through queryKey.
  }, [queryKey, profile, nonce])

  // Votes from the server, plus this device's taps since (kept until the next load).
  useEffect(() => { if (data) setVotes(data.deliveryVotes ?? {}) }, [data])

  const allPlaces = data?.places ?? []
  const scored = data?.scored ?? {}
  const deliveryById = useMemo(() => new Map(allPlaces.map((p) => [p.id, placeDelivery(p, user, votes)])), [allPlaces, user, votes])
  const places = useMemo(() => (choice.delivers ? allPlaces.filter((p) => deliveryById.get(p.id)?.level !== 'none') : allPlaces), [allPlaces, choice.delivers, deliveryById])
  const items = useMemo(() => rankResults(allPlaces, scored, choice, user, votes), [allPlaces, scored, choice, user, votes])
  const unfiltered = useMemo(() => rankResults(allPlaces, scored, DEFAULT_CHOICE, user, votes), [allPlaces, scored, user, votes])

  const pins = useMemo<PinData[]>(() => {
    const order = new Map(items.map((x, i) => [x.place.id, i]))
    return places.map((p) => {
      const s = order.has(p.id) ? scored[p.id] : undefined
      return {
        id: p.id, lat: p.lat, lng: p.lng, name: p.name, isExample: s?.example ?? false, order: order.get(p.id) ?? 0,
        dish: s ? { kcal: Math.round(s.best.kcal.mid / 10) * 10, score: s.best.score, protein: Math.round(s.best.protein) } : null,
      }
    })
  }, [places, scored, items])

  const nearbyList = useMemo(() => {
    const from = user ?? query
    return places.map((p) => ({ p, d: distance(from, p) })).sort((a, b) => a.d - b.d).slice(0, 40)
  }, [places, user, query])

  const insets = useMemo<MapInsets>(() => ({ top: chromeHeight, bottom: sheetHead + layerHeight }), [chromeHeight, sheetHead, layerHeight])
  const onHeaderHeight = useCallback((h: number) => setSheetHead(h), [])
  const onMoveEnd = useCallback((c: LatLng) => setMapCentre(c), [])
  const anyExample = items.some((r) => r.example)

  const placeById = (id: string) => allPlaces.find((p) => p.id === id) ?? (extraPlace?.id === id ? extraPlace : null)
  const openPlace = (id: string) => { setActive(id); setOpenId(id) }
  const openedPlace = openId ? placeById(openId) : null

  useEffect(() => () => window.clearTimeout(hintTimer.current), [])
  const say = (text: string) => {
    setHint(text)
    window.clearTimeout(hintTimer.current)
    hintTimer.current = window.setTimeout(() => setHint(null), 3200)
  }
  const locate = async () => {
    setSearchAt(null)
    const s = await requestPosition()
    if (s.status === 'granted') {
      if (choice.kiez) setChoice({ ...choice, kiez: null })
      setLocateNonce((n) => n + 1)
    } else if (s.status === 'denied') say('Location is blocked')
    else if (s.status === 'unavailable') say('No location right now')
  }
  const update = (next: Partial<MapChoice>) => {
    setActive(null)
    if ('kiez' in next) setSearchAt(null)
    setChoice({ ...choice, ...next })
  }
  const reset = () => { setActive(null); setSearchAt(null); setChoice(DEFAULT_CHOICE) }
  const retry = () => { retries.current = 0; setNonce((n) => n + 1) }
  const farFromQuery = mapCentre !== null && distance(mapCentre, query) > 1400
  const frameKey = `${choice.kiez ?? 'near'}|${searchAt ? 'here' : ''}|${queryKey}|${data ? 'd' : ''}|${locateNonce}`
  const area = choice.kiez ?? (searchAt ? 'This area' : user ? 'Near you' : 'Berlin Mitte')
  const filterCount = Number(choice.underBudget) + Number(choice.proteinPlus)
  const asking = !position.asked && position.status === 'fallback'
  const down = failed || data?.source === 'unavailable'

  return (
    <div className="map-screen" style={{ ['--chrome' as string]: `${chromeHeight}px`, ['--map-bottom' as string]: `${sheetHead + layerHeight}px` }}>
      <div className={`map-results ${loading && data ? 'is-stale' : ''}`} style={{ ['--sheet-head' as string]: `${sheetHead}px` }}>
        <Suspense fallback={<div className="score-map score-map--loading" aria-busy="true" />}>
          <ScoreMap
            pins={pins}
            metric={metric}
            activeId={active}
            onSelect={setActive}
            onOpen={openPlace}
            user={user}
            frameKey={frameKey}
            focus={query}
            locateNonce={locateNonce}
            insets={insets}
            onMoveEnd={onMoveEnd}
          />
        </Suspense>

        {farFromQuery && !loading && !asking && (
          <button type="button" className="map-here" style={{ top: chromeHeight + 4 }} onClick={() => { setActive(null); setSearchAt(mapCentre) }}>
            <Icon name="search" size={16} strokeWidth={2} /> Search here
          </button>
        )}

        <div ref={layerRef} className="map-layer" inert={expanded}>
          <div className="map-float">
            {hint && <span className="map-hint" role="status">{hint}</span>}
            <LocateButton status={position.status} onLocate={() => void locate()} />
          </div>
          {!data && loading ? (
            <div className="carousel carousel--loading" aria-busy="true"><RankCardSkeleton className="carousel__card" /></div>
          ) : down ? (
            <Note text={failed ? 'Places did not load' : 'Map data is busy'} action="Retry" icon="refresh" onAction={retry} />
          ) : items.length > 0 ? (
            <Carousel items={items} activeId={active} onActive={setActive} onOpen={openPlace} />
          ) : unfiltered.length > 0 ? (
            <Note text={choice.delivers && filterCount === 0 ? 'No scanned dish delivers here' : 'No matches'} action={choice.delivers && filterCount === 0 ? 'Show all' : 'Reset'} onAction={reset} />
          ) : (
            <Note text="No scans here yet" action="Scan a menu" icon="camera" primary onAction={onScan} />
          )}
        </div>

        <RankSheet
          expanded={expanded}
          onExpandedChange={setExpanded}
          onHeaderHeight={onHeaderHeight}
          header={
            <>
              <h2 className="rank-sheet__heading">{rankingTitle(choice, profile)}</h2>
              <span className="rank-sheet__meta">{items.length > 0 ? dishCount(items.length) : places.length > 0 ? `${places.length} places` : ''}</span>
            </>
          }
        >
          {items.length > 0 && (
            <ol className="rank-list">
              {items.map((result, i) => (
                <li key={result.place.id}><RankRow result={result} rank={i + 1} onOpen={() => openPlace(result.place.id)} /></li>
              ))}
            </ol>
          )}
          {nearbyList.length > 0 && (
            <>
              <h3 className="rank-sheet__sub">{choice.delivers ? 'May deliver' : 'All places'}</h3>
              <ul className="near-list">
                {nearbyList.map(({ p, d }) => {
                  const dl = choice.delivers ? deliveryById.get(p.id) : undefined
                  return (
                    <li key={p.id}>
                      <button type="button" className="near-row" onClick={() => openPlace(p.id)}>
                        <span className="near-row__body">
                          <b>{p.name}</b>
                          <span>{[p.cuisine, formatDistance(d)].filter(Boolean).join(' · ')}</span>
                        </span>
                        {dl && <DeliveryBadge level={dl.level} label={dl.level === 'likely' ? 'Likely' : dl.level === 'osm' ? 'OSM' : 'Confirmed'} size="sm" />}
                        <Icon name="chevron" size={16} />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
          <p className="rank-sheet__note">
            Calories are estimated ranges.{anyExample && ' Example entries are not real scans.'}{choice.delivers && ' Delivery is a signal, not a promise.'}
            <br />© OpenStreetMap contributors, ODbL · OpenFreeMap
          </p>
        </RankSheet>
      </div>

      <motion.div ref={chromeRef} className="map-top" initial={reduce ? false : { opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={springTransition('appear')}>
        <div className="map-bar" role="toolbar" aria-label="Map controls">
          <button type="button" className="map-pill map-area" aria-haspopup="dialog" aria-label={`Area: ${area}`} onClick={() => setKiezOpen(true)}>
            <Icon name={area === 'Near you' ? 'locate' : 'pin'} size={17} strokeWidth={1.9} />
            <span>{area}</span>
            {loading ? <span className="map-spin" role="status" aria-label="Loading" /> : <Icon name="chevron" size={14} strokeWidth={2} className="map-area__caret" />}
          </button>
          <span className="map-bar__gap" />
          <button type="button" className="map-pill map-pill--icon" aria-label="Search restaurants" onClick={openSearch}><Icon name="search" size={18} strokeWidth={1.9} /></button>
          <Pill icon="bag" pressed={Boolean(choice.delivers)} onClick={() => update({ delivers: !choice.delivers })}>Delivery</Pill>
          <button type="button" className="map-pill map-pill--icon" aria-expanded={filtersOpen} aria-label={filterCount > 0 ? `Filters, ${filterCount} on` : 'Filters'} onClick={() => setFiltersOpen((o) => !o)}>
            <FiltersIcon />
            {filterCount > 0 && <i className="map-pill__dot" aria-hidden="true" />}
          </button>
        </div>
        {filtersOpen && (
          <div className="map-filters" role="group" aria-label="Filters">
            <Pill small pressed={choice.underBudget} onClick={() => update({ underBudget: !choice.underBudget })}>Under {BUDGET_EUR} €</Pill>
            <Pill small pressed={choice.proteinPlus} onClick={() => update({ proteinPlus: !choice.proteinPlus })}>{PROTEIN_GOAL_G} g+ protein</Pill>
            <MetricToggle metric={metric} onChange={setMetric} />
          </div>
        )}
      </motion.div>

      {asking && <PositionAsk top={chromeHeight + 4} onAllow={() => void locate()} onDecline={declinePosition} />}

      <KiezPicker
        open={kiezOpen}
        value={choice.kiez ?? (searchAt || !user ? undefined : null)}
        onChange={(kiez) => {
          if (kiez === null && !user) { setActive(null); setSearchAt(null); if (choice.kiez) setChoice({ ...choice, kiez: null }); void locate() }
          else update({ kiez })
        }}
        onClose={() => setKiezOpen(false)}
      />

      {openedPlace && (
        <PlaceSheet
          place={openedPlace}
          distanceM={user ? distance(user, openedPlace) : null}
          profile={profile}
          onClose={() => setOpenId(null)}
          onScan={onScanPlace}
          delivery={deliveryById.get(openedPlace.id) ?? placeDelivery(openedPlace, user, votes)}
          preferOrder={Boolean(choice.delivers)}
          onVotes={(v) => setVotes((m) => ({ ...m, [openedPlace.id]: { yes: v.yes, no: v.no } }))}
        >
          {renderPlaceExtras?.(openedPlace)}
        </PlaceSheet>
      )}
    </div>
  )
}
