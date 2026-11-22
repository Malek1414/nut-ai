// Restaurant counts come from one MapLibre clustered source. Only visible markers mount as buttons.
import { AttributionControl, GeoJSONSource, LngLatBounds, Map as MlMap, Marker, setWorkerUrl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// MapLibre 6 locates its worker next to its own module, which bundlers move; hand it a bundled worker instead.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { FeatureCollection, Point } from 'geojson'
import { Utensils } from 'lucide-react'
import { createPortal } from 'react-dom'
import { Icon } from '../components/ui'
import type { LatLng } from '../lib/position'
import { applyWarmStyle, LAND, STYLE_URL } from './warm-style'
import './score-pins.css'

setWorkerUrl(workerUrl)

export type PinMetric = 'kcal' | 'score'
const MAP_EASE_MS = 600

export interface PinData {
  id: string
  lat: number
  lng: number
  name: string
  isExample: boolean
  /** Place in the ranking; better places stack above worse ones. */
  order: number
  /** The restaurant's best dish for the user's goal; null draws a restaurant icon. */
  dish: { kcal: number; score: number; protein: number } | null
  /** A fixed restaurant marker, e.g. the selected group restaurant. */
  label?: string
}

export interface MapInsets {
  top: number
  bottom: number
}

export interface ScoreMapProps {
  pins: PinData[]
  metric: PinMetric
  activeId: string | null
  /** A value pin was tapped while not active. */
  onSelect: (id: string) => void
  /** The active pin or a dot was tapped: open the restaurant. */
  onOpen: (id: string) => void
  /** The user's shared position, drawn as a dot; null until shared. */
  user: LatLng | null
  /** Frame the pins again whenever this changes (first load, a new Kiez, a new area). */
  frameKey: string
  /** Where to look when there is nothing to frame. */
  focus: LatLng
  /** Fly to the user whenever this increases. */
  locateNonce: number
  /** Screen chrome that covers the map: pins and camera moves keep clear of it. */
  insets: MapInsets
  /** The map stopped moving; reports its centre, for "Search this area". */
  onMoveEnd?: (centre: LatLng) => void
  compact?: boolean
  liberty?: boolean
}

const SIDE = 44
const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

type VisiblePoint =
  | { type: 'place'; id: string }
  | { type: 'cluster'; id: number; count: number; lng: number; lat: number }

function placesData(pins: PinData[], activeId: string | null): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: pins.filter((pin) => pin.id !== activeId && !pin.label).map((pin) => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [pin.lng, pin.lat] },
      properties: { id: pin.id, name: pin.name, hasDish: Boolean(pin.dish) },
    })),
  }
}

function MapMarker({ map, lng, lat, priority, children }: {
  map: MlMap; lng: number; lat: number; priority: number; children: ReactNode
}) {
  const [host] = useState(() => document.createElement('div'))
  useLayoutEffect(() => {
    const marker = new Marker({ element: host, anchor: 'center' }).setLngLat([lng, lat]).addTo(map)
    return () => { marker.remove() }
  }, [map, host, lng, lat])
  useLayoutEffect(() => { host.style.zIndex = String(priority) }, [host, priority])
  return createPortal(children, host)
}

function PlacePin({ pin, active, metric, onClick }: {
  pin: PinData; active: boolean; metric: PinMetric; onClick: () => void
}) {
  const dish = pin.dish
  const spoken = dish ? metric === 'score' ? `, best dish goal fit ${dish.score} out of 100` : `, best dish about ${dish.kcal} kilocalories` : ''
  return (
    <button type="button" className={`map-pin ${active ? 'is-selected' : ''}`}
      aria-label={`${pin.name}${spoken}${pin.isExample ? ', example data' : ''}`} aria-pressed={active}
      onClick={(event) => { event.stopPropagation(); onClick() }}>
      <span className={`map-pin__face ${dish || active ? 'has-label' : ''}`}>
        {active && <span className="map-pin__name">{pin.name}</span>}
        {dish ? <span className="map-pin__metric">{metric === 'score' ? <>Fit <b>{dish.score}</b></> : <>~<b>{dish.kcal}</b> kcal</>}</span>
          : !active && <Utensils aria-hidden="true" size={13} strokeWidth={2.25} />}
      </span>
    </button>
  )
}

export default function ScoreMap({ pins, metric, activeId, onSelect, onOpen, user, frameKey, focus, locateNonce, insets, onMoveEnd, compact = false, liberty = false }: ScoreMapProps) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MlMap | null>(null)
  const [points, setPoints] = useState<VisiblePoint[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const refreshMarkers = useRef<() => void>(() => {})
  const dragging = useRef(false)
  const userMarker = useRef<Marker | null>(null)
  const insetsRef = useRef(insets)
  const pinsRef = useRef(pins)
  const userRef = useRef(user)
  const focusRef = useRef(focus)
  const activeRef = useRef(activeId)
  const byId = useMemo(() => new Map(pins.map((pin) => [pin.id, pin])), [pins])
  const moveRef = useRef(onMoveEnd)
  const framed = useRef<string | null>(null)

  useEffect(() => {
    insetsRef.current = insets
    pinsRef.current = pins
    userRef.current = user
    focusRef.current = focus
    activeRef.current = activeId
    moveRef.current = onMoveEnd
  }, [insets, pins, user, focus, activeId, onMoveEnd])

  // Pins hang above their point, so the top keeps a pin's height free as well.
  const padding = () => ({ top: insetsRef.current.top + 44, bottom: insetsRef.current.bottom + 16, left: SIDE, right: SIDE })
  const duration = (ms: number) => (reduced() ? 0 : ms)

  // Create the map once per mount.
  useEffect(() => {
    if (!container.current) return
    let map: MlMap
    try {
      map = new MlMap({
        container: container.current,
        style: liberty ? 'https://tiles.openfreemap.org/styles/liberty' : STYLE_URL,
        center: [focusRef.current.lng, focusRef.current.lat],
        zoom: 14,
        minZoom: 9,
        maxZoom: 18,
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
        cooperativeGestures: compact,
      })
    } catch {
      setState('error')
      return
    }
    map.touchZoomRotate.disableRotation()
    map.keyboard.disableRotation()
    // OpenFreeMap credits OpenMapTiles and OpenStreetMap; the restaurant data is OpenStreetMap (ODbL) as well.
    map.addControl(new AttributionControl({ compact: true, customAttribution: 'Restaurants © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors, ODbL' }), 'bottom-left')
    let markersDirty = true
    function invalidateMarkers() {
      markersDirty = true
      map.triggerRepaint()
    }
    refreshMarkers.current = invalidateMarkers
    map.on('style.load', () => {
      if (!liberty) applyWarmStyle(map)
      map.addSource('places', {
        type: 'geojson', data: placesData(pinsRef.current, activeRef.current),
        cluster: true, clusterRadius: 64, clusterMaxZoom: 17,
      })
      // The invisible layer lets us query the worker's clustered features inside the uncovered viewport.
      map.addLayer({ id: 'place-points', type: 'circle', source: 'places', paint: { 'circle-radius': 1, 'circle-opacity': 0 } })
      map.addLayer({
        id: 'place-names', type: 'symbol', source: 'places', minzoom: 16.5,
        filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'hasDish'], false]],
        layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-anchor': 'top', 'text-offset': [0, 1.5], 'text-max-width': 9 },
        paint: { 'text-color': '#364658', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
      })
      setState('ready')
    })
    map.on('sourcedata', (event) => { if (event.sourceId === 'places') invalidateMarkers() })
    map.on('moveend', invalidateMarkers)
    map.on('resize', invalidateMarkers)
    map.on('render', () => {
      if (!markersDirty || map.isMoving() || !map.getLayer('place-points') || !map.isSourceLoaded('places')) return
      markersDirty = false
      const { clientWidth: width, clientHeight: height } = map.getContainer()
      const { top, bottom } = insetsRef.current
      const features = map.queryRenderedFeatures([[0, Math.min(top, height)], [width, Math.max(top, height - bottom)]], { layers: ['place-points'] })
      const seen = new Set<string>()
      const next: VisiblePoint[] = []
      for (const feature of features) {
        if (feature.geometry.type !== 'Point') continue
        const p = feature.properties
        const key = p.cluster ? `cluster:${p.cluster_id}` : String(p.id)
        if (seen.has(key)) continue
        seen.add(key)
        if (p.cluster) {
          const [lng, lat] = feature.geometry.coordinates
          next.push({ type: 'cluster', id: p.cluster_id, count: p.point_count, lng, lat })
        } else next.push({ type: 'place', id: p.id })
      }
      setPoints(next)
    })
    // Keep the attribution behind its info button, next to the map controls.
    map.once('load', () => {
      container.current?.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show')
    })
    map.on('error', () => {
      if (!map.getLayer('place-points')) setState('error')
    })
    map.on('dragstart', () => { dragging.current = true })
    map.on('dragend', () => { window.setTimeout(() => { dragging.current = false }, 0) })
    map.on('moveend', () => {
      const c = map.getCenter()
      moveRef.current?.({ lat: c.lat, lng: c.lng })
    })
    mapRef.current = map
    framed.current = null
    return () => {
      refreshMarkers.current = () => {}
      userMarker.current?.remove()
      userMarker.current = null
      map.remove()
      mapRef.current = null
    }
  }, [liberty, compact])

  useEffect(() => {
    const src = mapRef.current?.getSource('places') as GeoJSONSource | undefined
    if (src) void src.setData(placesData(pins, activeId))
  }, [pins, activeId])

  useEffect(() => { refreshMarkers.current() }, [insets.top, insets.bottom])

  // Frame the value pins on first load and whenever the frame key changes; with none, look at the focus point.
  useEffect(() => {
    const map = mapRef.current
    if (!map || framed.current === frameKey) return
    const first = framed.current === null
    framed.current = frameKey
    const f = focusRef.current
    const valued = pins.filter((p) => p.dish && Math.abs(p.lat - f.lat) < 0.02 && Math.abs(p.lng - f.lng) < 0.03)
    if (valued.length < 2) {
      map.easeTo({ center: [f.lng, f.lat], zoom: 15, padding: padding(), duration: first ? 0 : duration(MAP_EASE_MS) })
      return
    }
    const bounds = new LngLatBounds()
    valued.forEach((p) => bounds.extend([p.lng, p.lat]))
    bounds.extend([f.lng, f.lat])
    // fitBounds adds its padding on top of what an earlier easeTo left on the map: pass only the difference,
    // so the pins are framed the same way whether or not the camera moved before the places arrived.
    const want = padding()
    const have = map.getPadding()
    const side = (k: 'top' | 'bottom' | 'left' | 'right') => Math.max(0, want[k] - (have[k] ?? 0))
    map.fitBounds(bounds, { padding: { top: side('top'), bottom: side('bottom'), left: side('left'), right: side('right') }, maxZoom: 16, duration: first ? 0 : duration(MAP_EASE_MS) })
    // padding() reads the latest insets through a ref, so insets are not a dependency.
  }, [frameKey, pins])

  // Bring the active pin into the free part of the map.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !activeId) return
    const pin = pinsRef.current.find((p) => p.id === activeId)
    if (!pin) return
    map.easeTo({ center: [pin.lng, pin.lat], zoom: Math.max(map.getZoom(), 14), padding: padding(), duration: duration(MAP_EASE_MS) })
  }, [activeId])

  // The user's dot.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!user) {
      userMarker.current?.remove()
      userMarker.current = null
      return
    }
    if (!userMarker.current) {
      const el = document.createElement('div')
      el.className = 'user-dot'
      el.setAttribute('role', 'img')
      el.setAttribute('aria-label', 'Your position')
      userMarker.current = new Marker({ element: el, anchor: 'center' }).setLngLat([user.lng, user.lat]).addTo(map)
    } else {
      userMarker.current.setLngLat([user.lng, user.lat])
    }
  }, [user])

  // Fly to the user after "Near me".
  useEffect(() => {
    const map = mapRef.current
    const u = userRef.current
    if (!map || !u || locateNonce === 0) return
    map.easeTo({ center: [u.lng, u.lat], zoom: 15, padding: padding(), duration: duration(MAP_EASE_MS) })
  }, [locateNonce])

  const map = mapRef.current
  function renderPlace(pin: PinData) {
    if (!map) return null
    const active = pin.id === activeId
    return <MapMarker key={pin.id} map={map} lng={pin.lng} lat={pin.lat} priority={active ? 1000 : pin.dish ? Math.max(3, 900 - pin.order) : 1}>
      {compact && pin.label
        ? <span className="map-pin__face has-label is-fixed" role="img" aria-label={`${pin.name}, ${pin.label}${pin.isExample ? ', example data' : ''}`}>{pin.label}</span>
        : <PlacePin pin={pin} active={active} metric={metric} onClick={() => {
            if (dragging.current) return
            if (active || !pin.dish) onOpen(pin.id)
            else onSelect(pin.id)
          }} />}
    </MapMarker>
  }
  function expand(point: Extract<VisiblePoint, { type: 'cluster' }>) {
    const source = map?.getSource('places') as GeoJSONSource | undefined
    if (!source || !map || dragging.current) return
    void source.getClusterExpansionZoom(point.id).then((zoom) => {
      if (mapRef.current === map) map.easeTo({ center: [point.lng, point.lat], zoom: Math.min(zoom + 0.1, 18), padding: padding(), duration: duration(MAP_EASE_MS) })
    }).catch(() => { /* The source changed while the cluster was opening. */ })
  }

  return (
    <div className="score-map" style={{ background: LAND }}>
      <div ref={container} className="score-map__canvas" role="region" aria-label="Map of restaurants" />
      {map && points.map((point) => {
        if (point.type === 'cluster') return <MapMarker key={`cluster:${point.id}`} map={map} lng={point.lng} lat={point.lat} priority={3}>
          <button type="button" className="map-cluster" aria-label={`Zoom in to ${point.count} places`} onClick={(e) => { e.stopPropagation(); expand(point) }}>
            <span><b>{point.count}</b> places</span>
          </button>
        </MapMarker>
        const pin = byId.get(point.id)
        return pin && pin.id !== activeId && !pin.label ? renderPlace(pin) : null
      })}
      {pins.filter((pin) => pin.id === activeId || pin.label).map(renderPlace)}
      {state === 'error' && (
        <div className="score-map__error" role="status" style={{ top: insets.top + 8 }}>
          <Icon name="map" size={16} /> Map unavailable
        </div>
      )}
    </div>
  )
}
