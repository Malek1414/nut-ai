// Where discover is: a small stack of pages (search, a restaurant) drawn over the app by DiscoverHost.
// The stack lives in the browser history next to the app's own screen, so the phone's back button walks
// back through it, and any part of the app can open a page with one call and no props.
import { useSyncExternalStore } from 'react'
import type { PlaceDetails } from './api'

export type DiscoverPage = { view: 'search' } | { view: 'place'; place: PlaceDetails }

const EMPTY: DiscoverPage[] = []
let stack: DiscoverPage[] = EMPTY
const listeners = new Set<() => void>()

function set(next: DiscoverPage[]) {
  stack = next.length ? next : EMPTY
  listeners.forEach((l) => l())
}

function push(page: DiscoverPage) {
  const next = [...stack, page]
  // Keep the app's own state (`s`: its screen) in the entry, so its back handling stays on the same screen.
  try { history.pushState({ ...((history.state as object | null) ?? {}), discover: next }, '') } catch { /* history unavailable */ }
  set(next)
}

/** Open the restaurant search. */
export const openSearch = () => push({ view: 'search' })
/** Open one restaurant's details. */
export const openPlace = (place: PlaceDetails) => push({ view: 'place', place })
/** One page back (the phone's back button does the same). */
export const discoverBack = () => { try { history.back() } catch { set(stack.slice(0, -1)) } }
/** Leave discover because the app moves on (a scan starts, the map opens). The pages stay in the history. */
export const closeDiscover = () => set(EMPTY)

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', (e) => {
    const s = (e.state as { discover?: DiscoverPage[] } | null)?.discover
    set(Array.isArray(s) ? s : EMPTY)
  })
}

export function useDiscoverStack(): DiscoverPage[] {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => stack, () => EMPTY)
}
