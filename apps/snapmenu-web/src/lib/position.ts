// The user's position for the map and "closest restaurants". Falls back to Berlin Mitte until shared.
// Adapted from the team's wohin app (apps/web/src/lib/position.ts).
import { useSyncExternalStore } from 'react'

export interface LatLng { lat: number; lng: number }

/** Fallback when no position is shared: Berlin Mitte, between Hackescher Markt and Rosenthaler Platz. */
export const BERLIN_MITTE: LatLng = { lat: 52.5235, lng: 13.404 }

export interface PositionState {
  position: LatLng
  /** fallback: not shared yet. granted: real device position. denied: user said no. */
  status: 'fallback' | 'locating' | 'granted' | 'denied' | 'unavailable'
  /** The polite ask was answered (either way), so the map does not ask again. */
  asked: boolean
}

const KEY = 'snapmenu.position'
const listeners = new Set<() => void>()

function load(): PositionState {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (raw) {
      const s = JSON.parse(raw) as PositionState
      // A saved "locating" never finished: treat it as not shared.
      return s.status === 'locating' ? { ...s, status: 'fallback' } : s
    }
  } catch { /* storage blocked */ }
  return { position: BERLIN_MITTE, status: 'fallback', asked: false }
}

let state: PositionState = typeof window === 'undefined' ? { position: BERLIN_MITTE, status: 'fallback', asked: false } : load()

function set(next: PositionState | ((s: PositionState) => PositionState)) {
  state = typeof next === 'function' ? next(state) : next
  try { window.localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* ignore */ }
  listeners.forEach((l) => l())
}

export function usePosition(): PositionState {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => state, () => state)
}

export const getPosition = () => state

/** Ask the browser for the current position. Safe to call repeatedly. */
export function requestPosition(): Promise<PositionState> {
  return new Promise((resolve) => {
    if (!navigator.geolocation?.getCurrentPosition) {
      set((s) => ({ ...s, status: 'unavailable', asked: true }))
      resolve(state)
      return
    }
    set((s) => ({ ...s, status: 'locating', asked: true }))
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => { set({ position: { lat: coords.latitude, lng: coords.longitude }, status: 'granted', asked: true }); resolve(state) },
      (error) => { set((s) => ({ ...s, position: BERLIN_MITTE, status: error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable' })); resolve(state) },
      { enableHighAccuracy: false, maximumAge: 5 * 60_000, timeout: 10_000 },
    )
  })
}

/** "Not now": keep Berlin Mitte and do not ask again. */
export function declinePosition() {
  set((s) => ({ ...s, asked: true }))
}

/** Forget the shared position and fall back to Berlin Mitte again. */
export function resetPosition() {
  set({ position: BERLIN_MITTE, status: 'fallback', asked: false })
}

/** A saved location is refreshed only with an existing browser grant; never prompt on launch. */
export function refreshPosition(): void {
  if (state.status !== 'granted') return
  if (!navigator.permissions?.query) { resetPosition(); return }
  void navigator.permissions.query({ name: 'geolocation' }).then(permission => {
    if (permission.state === 'granted') void requestPosition()
    else resetPosition()
  }).catch(() => resetPosition())
}

/** Great-circle distance in metres. */
export function distance(a: LatLng, b: LatLng): number {
  const R = 6371000
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(h)))
}

export function formatDistance(m: number): string {
  if (m < 950) return `${Math.max(10, Math.round(m / 10) * 10)} m`
  return `${(m / 1000).toFixed(1)} km`
}
