// Map adapted from the team's wohin app (apps/web/src/screens/map/ScoreMap.tsx), restyled to Snapmenu's palette.
// MapLibre map with score pins (kcal or goal fit) for restaurants that have community scans, on a tinted
// OpenFreeMap style. Pins are React components portalled into MapLibre markers. Every other OpenStreetMap
// restaurant is drawn by MapLibre itself from one clustered GeoJSON source (MapLibre clusters with
// supercluster, ISC): zoomed out they are quiet count bubbles, zoomed in dots with names. Hundreds of places
// stay smooth on a phone. Loaded lazily by MapScreen.
import { AttributionControl, GeoJSONSource, LngLatBounds, Map as MlMap, Marker, setWorkerUrl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// MapLibre 6 locates its worker next to its own module, which bundlers move; hand it a bundled worker instead.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../components/ui'
import type { LatLng } from '../lib/position'
import { applyWarmStyle, LAND, STYLE_URL } from './warm-style'

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
  /** The restaurant's best dish for the user's goal; null draws a quiet dot (nobody scanned it yet). */
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
}

const SIDE = 44
const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

function MiniRing({ score }: { score: number }) {
  const r = 6
  const c = 2 * Math.PI * r
  return (
    <svg className="pin__ring" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r={r} className="pin__ring-track" />
      <circle cx="8" cy="8" r={r} className="pin__ring-value" strokeDasharray={`${(score / 100) * c} ${c}`} transform="rotate(-90 8 8)" />
    </svg>
  )
}

function Pin({ pin, metric, active, onSelect, onOpen, ignoreClick }: {
  pin: PinData
  metric: PinMetric
  active: boolean
  onSelect: (id: string) => void
  onOpen: (id: string) => void
  ignoreClick: () => boolean
}) {
  const example = pin.isExample ? ', example data' : ''
  if (pin.label) return <span className={`pin is-active ${pin.isExample ? 'pin--example' : ''}`} role="img" aria-label={`${pin.name}${example}, ${pin.label}`}><span className="pin__body">{pin.label}</span></span>
  const { kcal, score } = pin.dish!
  const value = metric === 'kcal' ? `~${kcal}` : String(score)
  const spoken = metric === 'kcal' ? `about ${kcal} kcal` : `fit score ${score}`
  return (
    <button
      type="button"
      className={`pin ${active ? 'is-active' : ''} ${pin.isExample ? 'pin--example' : ''}`}
      aria-label={active ? `${pin.name}${example}: open restaurant` : `${pin.name}${example}: best dish ${spoken}`}
      onClick={(e) => {
        e.stopPropagation()
        if (ignoreClick()) return
        if (active) onOpen(pin.id)
        else onSelect(pin.id)
      }}
    >
      <span className="pin__body">
        {metric === 'score' && <MiniRing score={score} />}
        <span className="pin__value">{value}</span>
        {metric === 'kcal' && active && <span className="pin__unit">kcal</span>}
      </span>
    </button>
  )
}

interface DotFeatures {
  type: 'FeatureCollection'
  features: Array<{ type: 'Feature'; geometry: { type: 'Point'; coordinates: [number, number] }; properties: { id: string; name: string } }>
}
const dotData = (pins: PinData[]): DotFeatures => ({
  type: 'FeatureCollection',
  features: pins.filter((p) => !p.dish && !p.label).map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] }, properties: { id: p.id, name: p.name } })),
})

export default function ScoreMap({ pins, metric, activeId, onSelect, onOpen, user, frameKey, focus, locateNonce, insets, onMoveEnd, compact = false }: ScoreMapProps) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MlMap | null>(null)
  const hosts = useRef(new Map<string, { marker: Marker; el: HTMLDivElement }>())
  const [hostEls, setHostEls] = useState<Map<string, HTMLDivElement>>(() => new Map())
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [styleReady, setStyleReady] = useState(false)
  const dragging = useRef(false)
  const userMarker = useRef<Marker | null>(null)
  const insetsRef = useRef(insets)
  const pinsRef = useRef(pins)
  const userRef = useRef(user)
  const focusRef = useRef(focus)
  const openRef = useRef(onOpen)
  const moveRef = useRef(onMoveEnd)
  const framed = useRef<string | null>(null)

  useEffect(() => {
    insetsRef.current = insets
    pinsRef.current = pins
    userRef.current = user
    focusRef.current = focus
    openRef.current = onOpen
    moveRef.current = onMoveEnd
  }, [insets, pins, user, focus, onOpen, onMoveEnd])

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
        style: STYLE_URL,
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
    map.on('style.load', () => {
      applyWarmStyle(map)
      map.addSource('places', { type: 'geojson', data: dotData(pinsRef.current) as Parameters<GeoJSONSource['setData']>[0], cluster: true, clusterRadius: 36, clusterMaxZoom: 15 })
      const single: ['!', ['has', string]] = ['!', ['has', 'point_count']]
      map.addLayer({
        id: 'place-clusters',
        type: 'circle',
        source: 'places',
        filter: ['has', 'point_count'],
        paint: {
          'circle-radius': ['step', ['get', 'point_count'], 9, 8, 11, 25, 13, 80, 16],
          'circle-color': '#ffffff',
          'circle-opacity': 0.8,
          'circle-stroke-width': 1,
          'circle-stroke-color': 'rgba(20, 34, 27, 0.1)',
        },
      })
      map.addLayer({
        id: 'place-cluster-count',
        type: 'symbol',
        source: 'places',
        filter: ['has', 'point_count'],
        layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Bold'], 'text-size': 10.5, 'text-allow-overlap': true, 'text-ignore-placement': true },
        paint: { 'text-color': '#7d8a81' },
      })
      map.addLayer({
        id: 'place-dots-halo',
        type: 'circle',
        source: 'places',
        filter: single,
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 3.5, 16, 7], 'circle-color': '#ffffff', 'circle-opacity': 0.95 },
      })
      map.addLayer({
        id: 'place-dots',
        type: 'circle',
        source: 'places',
        filter: single,
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 2.2, 16, 5], 'circle-color': '#8b978f' },
      })
      // Zoomed in, every dot gets its name; MapLibre hides the ones that would collide.
      map.addLayer({
        id: 'place-names',
        type: 'symbol',
        source: 'places',
        filter: single,
        minzoom: 16,
        layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-anchor': 'top', 'text-offset': [0, 0.8], 'text-max-width': 8, 'text-optional': true },
        paint: { 'text-color': '#44524a', 'text-halo-color': '#eef1e9', 'text-halo-width': 1.4 },
      })
      setStyleReady(true)
    })
    // Generous tap target: a 44 px box around the finger, not just the 5 px dot. A count bubble zooms in
    // until its places come apart; a dot opens its restaurant.
    map.on('click', (e) => {
      if (dragging.current || !map.getLayer('place-dots')) return
      const { x, y } = e.point
      const hits = map.queryRenderedFeatures([[x - 22, y - 22], [x + 22, y + 22]], { layers: ['place-dots', 'place-clusters'] })
      if (hits.length === 0) return
      const at = (f: (typeof hits)[number]) => (f.geometry as unknown as { coordinates: [number, number] }).coordinates
      const nearest = hits
        .map((f) => { const p = map.project(at(f)); return { f, d: (p.x - x) ** 2 + (p.y - y) ** 2 } })
        .sort((a, b) => a.d - b.d)[0]!.f
      const props = nearest.properties ?? {}
      if (props['cluster']) {
        const src = map.getSource('places') as GeoJSONSource | undefined
        void src?.getClusterExpansionZoom(Number(props['cluster_id'])).then((zoom) => {
          map.easeTo({ center: at(nearest), zoom: Math.min(zoom + 0.3, 18), padding: padding(), duration: duration(MAP_EASE_MS) })
        }).catch(() => { /* the source changed under the tap */ })
        return
      }
      if (typeof props['id'] === 'string') openRef.current(props['id'])
    })
    for (const layer of ['place-dots', 'place-clusters']) {
      map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = '' })
    }
    // Keep the attribution behind its info button, next to the map controls.
    map.once('load', () => {
      setState('ready')
      container.current?.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show')
    })
    map.on('error', () => {
      if (!map.loaded()) setState((s) => (s === 'ready' ? s : 'error'))
    })
    map.on('dragstart', () => { dragging.current = true })
    map.on('dragend', () => { window.setTimeout(() => { dragging.current = false }, 0) })
    map.on('moveend', () => {
      const c = map.getCenter()
      moveRef.current?.({ lat: c.lat, lng: c.lng })
    })
    mapRef.current = map
    framed.current = null
    const refs = hosts.current
    return () => {
      refs.forEach(({ marker }) => marker.remove())
      refs.clear()
      userMarker.current?.remove()
      userMarker.current = null
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Quiet dots for every restaurant without a scan.
  useEffect(() => {
    const src = mapRef.current?.getSource('places') as GeoJSONSource | undefined
    if (styleReady && src) src.setData(dotData(pins) as Parameters<GeoJSONSource['setData']>[0])
  }, [pins, styleReady])

  // One marker host per value pin; React renders the pin into it through a portal.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const refs = hosts.current
    const valued = pins.filter((p) => p.dish || p.label)
    const ids = new Set(valued.map((p) => p.id))
    refs.forEach(({ marker }, id) => {
      if (!ids.has(id)) {
        marker.remove()
        refs.delete(id)
      }
    })
    for (const p of valued) {
      const existing = refs.get(p.id)
      if (existing) {
        existing.marker.setLngLat([p.lng, p.lat])
        continue
      }
      const el = document.createElement('div')
      el.className = 'pin-host'
      const marker = new Marker({ element: el, anchor: 'bottom' }).setLngLat([p.lng, p.lat]).addTo(map)
      refs.set(p.id, { marker, el })
    }
    setHostEls(new Map([...refs].map(([id, h]) => [id, h.el])))
  }, [pins])

  // Stacking: the active pin above everything, better places above worse ones.
  useEffect(() => {
    for (const p of pins) {
      const host = hosts.current.get(p.id)
      if (host) host.el.style.zIndex = p.id === activeId ? '1000' : String(900 - p.order)
    }
  }, [pins, activeId, hostEls])

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

  const ignoreClick = () => dragging.current

  return (
    <div className="score-map" style={{ background: LAND }}>
      <div ref={container} className="score-map__canvas" role="region" aria-label="Map of restaurants" />
      {pins.map((p) => {
        const el = hostEls.get(p.id)
        return el && (p.dish || p.label)
          ? createPortal(<Pin pin={p} metric={metric} active={p.id === activeId} onSelect={onSelect} onOpen={onOpen} ignoreClick={ignoreClick} />, el, p.id)
          : null
      })}
      {state === 'error' && (
        <div className="score-map__error" role="status" style={{ top: insets.top + 8 }}>
          <Icon name="map" size={16} /> Map unavailable
        </div>
      )}
    </div>
  )
}
