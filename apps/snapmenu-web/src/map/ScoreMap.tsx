// Map adapted from the team's wohin app (apps/web/src/screens/map/ScoreMap.tsx), restyled to Snapmenu's palette.
// MapLibre map with score pins (kcal or goal fit) for restaurants that have community scans, on a tinted
// OpenFreeMap style. Pins are React components portalled into MapLibre markers. Every other OpenStreetMap
// restaurant is a quiet dot drawn by MapLibre itself (one GeoJSON layer), so hundreds of places stay smooth
// on a phone. Loaded lazily by MapScreen.
import { AttributionControl, GeoJSONSource, LngLatBounds, Map as MlMap, Marker, setWorkerUrl, type MapLayerMouseEvent } from 'maplibre-gl'
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
}

const SIDE = 28
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
        {active && (
          <span className="pin__name">
            {pin.name}
            <Icon name="chevron" size={14} strokeWidth={2} />
          </span>
        )}
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
  features: pins.filter((p) => !p.dish).map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] }, properties: { id: p.id, name: p.name } })),
})

export default function ScoreMap({ pins, metric, activeId, onSelect, onOpen, user, frameKey, focus, locateNonce, insets, onMoveEnd }: ScoreMapProps) {
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
  const padding = () => ({ top: insetsRef.current.top + 52, bottom: insetsRef.current.bottom + 16, left: SIDE, right: SIDE })
  const duration = (ms: number) => (reduced() ? 0 : ms)

  // Create the map once per mount.
  useEffect(() => {
    if (!container.current) return
    const map = new MlMap({
      container: container.current,
      style: STYLE_URL,
      center: [focusRef.current.lng, focusRef.current.lat],
      zoom: 14,
      minZoom: 9,
      maxZoom: 18,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
    })
    map.touchZoomRotate.disableRotation()
    map.keyboard.disableRotation()
    // OpenFreeMap credits OpenMapTiles and OpenStreetMap; the restaurant data is OpenStreetMap (ODbL) as well.
    map.addControl(new AttributionControl({ compact: true, customAttribution: 'Restaurants © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors, ODbL' }), 'top-right')
    map.on('style.load', () => {
      applyWarmStyle(map)
      map.addSource('places', { type: 'geojson', data: dotData(pinsRef.current) as Parameters<GeoJSONSource['setData']>[0] })
      map.addLayer({
        id: 'place-dots-halo',
        type: 'circle',
        source: 'places',
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 3.5, 16, 7], 'circle-color': '#ffffff', 'circle-opacity': 0.95 },
      })
      map.addLayer({
        id: 'place-dots',
        type: 'circle',
        source: 'places',
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 2.2, 16, 5], 'circle-color': '#8b978f' },
      })
      setStyleReady(true)
    })
    const openDot = (e: MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.['id']
      if (typeof id === 'string' && !dragging.current) openRef.current(id)
    }
    // Generous tap target: a 44 px box around the finger, not just the 5 px dot.
    map.on('click', (e) => {
      if (!map.getLayer('place-dots')) return
      const { x, y } = e.point
      const hits = map.queryRenderedFeatures([[x - 22, y - 22], [x + 22, y + 22]], { layers: ['place-dots'] })
      if (hits.length === 0) return
      const nearest = hits
        .map((f) => ({ f, d: (() => { const p = map.project((f.geometry as unknown as { coordinates: [number, number] }).coordinates); return (p.x - x) ** 2 + (p.y - y) ** 2 })() }))
        .sort((a, b) => a.d - b.d)[0]!
      openDot({ ...e, features: [nearest.f] } as unknown as MapLayerMouseEvent)
    })
    map.on('mouseenter', 'place-dots', () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', 'place-dots', () => { map.getCanvas().style.cursor = '' })
    // Pins and cards cover most of a phone screen: keep the attribution behind its info button.
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
    const valued = pins.filter((p) => p.dish)
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
    map.fitBounds(bounds, { padding: padding(), maxZoom: 16, duration: first ? 0 : duration(MAP_EASE_MS) })
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
        return el && p.dish
          ? createPortal(<Pin pin={p} metric={metric} active={p.id === activeId} onSelect={onSelect} onOpen={onOpen} ignoreClick={ignoreClick} />, el, p.id)
          : null
      })}
      {state === 'error' && (
        <div className="score-map__error" role="status" style={{ top: insets.top + 16 }}>
          <Icon name="map" size={18} />
          <span><b>The map is not loading right now.</b> The list below still works.</span>
        </div>
      )}
    </div>
  )
}
