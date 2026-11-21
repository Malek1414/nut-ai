// Map adapted from the team's wohin app (apps/web/src/screens/map/MapScreen.tsx), restyled to Snapmenu.
// Tinted MapLibre map with score pins, floating filter chips, a carousel of big dish cards synced with the
// pins, and a draggable sheet with the full ranking. Restaurants come from OpenStreetMap; dishes and numbers
// come from Snapmenu scans the community filed under a restaurant.
import { motion, useReducedMotion } from 'framer-motion'
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Place, PlacesResponse, Profile } from '../../../snapmenu-api/src/types'
import { Icon, Logo } from '../components/ui'
import { fetchPlaces } from '../lib/places'
import { declinePosition, distance, requestPosition, usePosition, type LatLng, type PositionState } from '../lib/position'
import { KiezPicker } from './KiezPicker'
import { springTransition } from './motion'
import { PlaceSheet } from './PlaceSheet'
import { RankCard, RankCardSkeleton, RankRow } from './RankCard'
import { BUDGET_EUR, dishCount, KIEZ_CENTRE, PROTEIN_GOAL_G, rankingTitle, rankResults, type DishResult, type MapChoice } from './ranking'
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

const DEFAULT_CHOICE: MapChoice = { kiez: null, underBudget: false, proteinPlus: false }

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

// ---------- Top chrome: title and filter chips ----------

function Chip({ pressed, onClick, icon, children, popup = false }: { pressed: boolean; onClick: () => void; icon: string; children: ReactNode; popup?: boolean }) {
  return (
    <button type="button" className="map-chip" aria-pressed={pressed} aria-haspopup={popup ? 'dialog' : undefined} onClick={onClick}>
      <Icon name={icon} size={15} strokeWidth={1.9} />
      {children}
      {popup && <Icon name="chevron" size={14} strokeWidth={1.9} className="map-chip__caret" />}
    </button>
  )
}

// ---------- Controls above the carousel ----------

function MetricToggle({ metric, onChange }: { metric: PinMetric; onChange: (m: PinMetric) => void }) {
  const reduce = useReducedMotion()
  const options: Array<{ value: PinMetric; label: string }> = [
    { value: 'kcal', label: 'kcal' },
    { value: 'score', label: 'Fit' },
  ]
  return (
    <div className="metric-toggle" role="radiogroup" aria-label="Value on the pins">
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

function LocateButton({ status, onLocate }: { status: PositionState['status']; onLocate: () => void }) {
  const label = status === 'locating' ? 'Locating…' : status === 'denied' ? 'Location blocked' : status === 'unavailable' ? 'No location' : 'Near me'
  return (
    <button type="button" className={`locate-btn ${status === 'granted' ? 'is-on' : ''}`} onClick={onLocate} disabled={status === 'locating'} aria-label={status === 'granted' ? 'Go to my position' : undefined}>
      <Icon name="locate" size={18} strokeWidth={1.9} />
      {status !== 'granted' && <span>{label}</span>}
    </button>
  )
}

// ---------- Carousel of big cards, synced with the pins ----------

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
          initial={reduce ? false : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={springTransition('appear', 80 + Math.min(i, 4) * 60)}
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

function EmptyCard({ filtered, onReset, onScan, nearby }: { filtered: boolean; onReset: () => void; onScan: () => void; nearby: number }) {
  return (
    <div className="map-empty" role="status">
      {filtered ? (
        <>
          <p className="map-empty__title">Nothing matches these filters here.</p>
          <p className="small">Loosen a filter or pick another Kiez.</p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onReset}>Reset filters</button>
        </>
      ) : (
        <>
          <p className="map-empty__title">No scanned menus around here yet.</p>
          <p className="small">{nearby > 0 ? `${nearby} restaurants nearby. ` : ''}Tap a dot to open one, then scan its menu. Your best dishes appear here for everyone.</p>
          <button type="button" className="btn btn-primary btn-sm" onClick={onScan}><Icon name="camera" size={18} /> Scan a menu</button>
        </>
      )}
    </div>
  )
}

function PositionAsk({ onAllow, onDecline }: { onAllow: () => void; onDecline: () => void }) {
  return (
    <div className="map-ask" role="dialog" aria-labelledby="map-ask-title">
      <span className="map-ask__ic"><Icon name="locate" size={22} /></span>
      <h2 id="map-ask-title" className="h3">See restaurants around you?</h2>
      <p className="small">Snapmenu uses your location only to load the restaurants and scans nearby. It stays on your phone, rounded to about 100 m when we ask OpenStreetMap.</p>
      <div className="map-ask__actions">
        <button className="btn btn-primary btn-sm" onClick={onAllow}>Use my location</button>
        <button className="btn btn-ghost btn-sm" onClick={onDecline}>Not now, show Berlin Mitte</button>
      </div>
    </div>
  )
}

// ---------- Screen ----------

export function MapScreen({ profile, onScanPlace, onScan, focusPlace, renderPlaceExtras }: {
  profile: Profile | null
  /** "Scan this menu" in a restaurant sheet. */
  onScanPlace: (place: Place) => void
  onScan: () => void
  /** Open this restaurant's sheet on arrival (e.g. from a post). */
  focusPlace?: Place | null
  renderPlaceExtras?: (place: Place) => ReactNode
}) {
  const position = usePosition()
  const reduce = useReducedMotion()
  const [choice, setChoiceState] = useState<MapChoice>(() => readStored('snapmenu.map.choice', DEFAULT_CHOICE))
  const [metric, setMetricState] = useState<PinMetric>(() => readStored<PinMetric>('snapmenu.map.metric', profile?.goal === 'build_muscle' ? 'score' : 'kcal'))
  const [active, setActive] = useState<string | null>(focusPlace?.id ?? null)
  const [expanded, setExpanded] = useState(false)
  const [kiezOpen, setKiezOpen] = useState(false)
  const [locateNonce, setLocateNonce] = useState(0)
  const [openId, setOpenId] = useState<string | null>(focusPlace?.id ?? null)
  const [extraPlace] = useState<Place | null>(focusPlace ?? null)
  const [chromeRef, chromeHeight] = useHeight<HTMLDivElement>(112)
  const [layerRef, layerHeight] = useHeight<HTMLDivElement>(300)
  const [sheetHead, setSheetHead] = useState(96)
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
  const [retryIn, setRetryIn] = useState(0)
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
          setRetryIn(wait)
          timer = window.setTimeout(() => live && setNonce((n) => n + 1), wait * 1000)
        } else {
          setRetryIn(0)
          if (d.source !== 'unavailable') retries.current = 0
        }
      })
      .catch(() => { if (live) { setLoading(false); setFailed(true) } })
    return () => { live = false; window.clearTimeout(timer) }
    // query is captured through queryKey.
  }, [queryKey, profile, nonce])

  const places = data?.places ?? []
  const scored = data?.scored ?? {}
  const items = useMemo(() => rankResults(places, scored, choice, user), [places, scored, choice, user])
  const unfiltered = useMemo(() => rankResults(places, scored, DEFAULT_CHOICE, user), [places, scored, user])

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

  const placeById = (id: string) => places.find((p) => p.id === id) ?? (extraPlace?.id === id ? extraPlace : null)
  const openPlace = (id: string) => { setActive(id); setOpenId(id) }
  const openedPlace = openId ? placeById(openId) : null

  const locate = async () => {
    setSearchAt(null)
    const s = await requestPosition()
    if (s.status === 'granted') {
      if (choice.kiez) setChoice({ ...choice, kiez: null })
      setLocateNonce((n) => n + 1)
    }
  }
  const update = (next: Partial<MapChoice>) => {
    setActive(null)
    if ('kiez' in next) setSearchAt(null)
    setChoice({ ...choice, ...next })
  }
  const reset = () => { setActive(null); setSearchAt(null); setChoice(DEFAULT_CHOICE) }
  const farFromQuery = mapCentre !== null && distance(mapCentre, query) > 1400
  const frameKey = `${choice.kiez ?? 'near'}|${searchAt ? 'here' : ''}|${queryKey}|${data ? 'd' : ''}|${locateNonce}`

  return (
    <div className="map-screen" style={{ ['--chrome' as string]: `${chromeHeight}px` }}>
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

        {farFromQuery && !loading && (
          <button type="button" className="map-here" style={{ top: chromeHeight + 4 }} onClick={() => { setActive(null); setSearchAt(mapCentre) }}>
            <Icon name="search" size={16} strokeWidth={2} /> Search this area
          </button>
        )}

        <div ref={layerRef} className="map-layer" inert={expanded}>
          <div className="map-controls">
            <MetricToggle metric={metric} onChange={setMetric} />
            <LocateButton status={position.status} onLocate={locate} />
          </div>
          {!data && loading ? (
            <div className="carousel carousel--loading"><RankCardSkeleton className="carousel__card" /><RankCardSkeleton className="carousel__card" /></div>
          ) : failed || data?.source === 'unavailable' ? (
            <div className="map-empty" role="status">
              <p className="map-empty__title">{failed ? 'Could not load restaurants.' : 'OpenStreetMap is busy right now.'}</p>
              <p className="small">{retryIn > 0 ? `Trying again in a few seconds. Scanned dishes still show on the map.` : 'Check your connection and try again.'}</p>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => { retries.current = 0; setNonce((n) => n + 1) }}><Icon name="refresh" size={16} /> Try again</button>
            </div>
          ) : items.length > 0 ? (
            <Carousel items={items} activeId={active} onActive={setActive} onOpen={openPlace} />
          ) : (
            <EmptyCard filtered={unfiltered.length > 0} onReset={reset} onScan={onScan} nearby={places.length} />
          )}
        </div>

        <RankSheet
          expanded={expanded}
          onExpandedChange={setExpanded}
          onHeaderHeight={onHeaderHeight}
          header={
            <>
              <h2 className="rank-sheet__heading">{rankingTitle(choice, profile)}</h2>
              <p className="rank-sheet__meta">
                <span>{dishCount(items.length)}{places.length > 0 && ` · ${places.length} restaurants`}</span>
                {anyExample && <span className="example-badge">Examples</span>}
              </p>
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
              <h3 className="rank-sheet__sub">All restaurants {user ? 'nearby' : choice.kiez ? `in ${choice.kiez}` : 'around here'}</h3>
              <ul className="near-list">
                {nearbyList.map(({ p, d }) => (
                  <li key={p.id}>
                    <button type="button" className="near-row" onClick={() => openPlace(p.id)}>
                      <span className={`near-row__dot ${scored[p.id] ? 'is-scanned' : ''}`} aria-hidden="true" />
                      <span className="near-row__body">
                        <b>{p.name}</b>
                        <span className="small">{[p.cuisine, `${d < 950 ? Math.max(10, Math.round(d / 10) * 10) + ' m' : (d / 1000).toFixed(1) + ' km'}`].filter(Boolean).join(' · ')}</span>
                      </span>
                      <Icon name="chevron" size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="rank-sheet__note">
            Ranked by how well the best scanned dish fits your goal. Calories are ranges from the open Nut AI engine. Entries marked Example are illustrative,
            not real scans. Restaurant data © OpenStreetMap contributors, ODbL. Map tiles by OpenFreeMap.
          </p>
        </RankSheet>
      </div>

      <motion.div ref={chromeRef} className="map-chrome" initial={reduce ? false : { opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={springTransition('appear')}>
        <div className="map-title">
          <Logo size={26} />
          <span className="map-title__text">
            <b>{choice.kiez ?? (searchAt ? 'This area' : user ? 'Near you' : 'Berlin Mitte')}</b>
            <span>{loading ? 'Loading restaurants…' : `${places.length} restaurants · ${Object.keys(scored).length} with scans`}</span>
          </span>
        </div>
        <div className="map-chips" role="toolbar" aria-label="Filters">
          <Chip icon="pin" pressed={choice.kiez !== null} popup onClick={() => setKiezOpen(true)}>{choice.kiez ?? 'Kiez'}</Chip>
          <Chip icon="euro" pressed={choice.underBudget} onClick={() => update({ underBudget: !choice.underBudget })}>Under {BUDGET_EUR} €</Chip>
          <Chip icon="bolt" pressed={choice.proteinPlus} onClick={() => update({ proteinPlus: !choice.proteinPlus })}>{PROTEIN_GOAL_G} g+ protein</Chip>
        </div>
      </motion.div>

      {!position.asked && position.status === 'fallback' && (
        <PositionAsk onAllow={() => void locate()} onDecline={declinePosition} />
      )}

      <KiezPicker open={kiezOpen} value={choice.kiez} onChange={(kiez) => update({ kiez })} onClose={() => setKiezOpen(false)} />

      {openedPlace && (
        <PlaceSheet
          place={openedPlace}
          distanceM={user ? distance(user, openedPlace) : null}
          profile={profile}
          onClose={() => setOpenId(null)}
          onScan={onScanPlace}
        >
          {renderPlaceExtras?.(openedPlace)}
        </PlaceSheet>
      )}
    </div>
  )
}
