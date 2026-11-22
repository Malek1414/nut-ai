// Draws discover's pages (search, a restaurant) over the app. Mounted once in App.tsx; any part of the app
// opens a page with `openSearch()` or `openPlace(place)` from ./nav. The screens load on first use.
import { lazy, Suspense } from 'react'
import { createPortal } from 'react-dom'
import type { Place, Profile } from '../../../snapmenu-api/src/types'
import { Icon } from '../components/ui'
import { usePosition } from '../lib/position'
import type { PlaceDetails } from './api'
import { hoursNow } from './hours'
import { openPlace, useDiscoverStack } from './nav'
import './discover.css'

const SearchScreen = lazy(() => import('./SearchScreen'))
const PlaceScreen = lazy(() => import('./PlaceScreen'))

export function DiscoverHost({ profile, onScanPlace, onViewMap, onToast }: {
  profile: Profile | null
  /** "Scan menu" on a restaurant: the app starts a scan for it. */
  onScanPlace: (place: Place) => void
  /** "Map" on a restaurant: the app shows it on the map. */
  onViewMap: (place: Place) => void
  onToast: (t: string) => void
}) {
  const stack = useDiscoverStack()
  if (stack.length === 0) return null
  // Portalled to <body> like the sheets: the pages must cover the map and the tab bar.
  return createPortal(
    <>
      {stack.map((page, i) => (
        // Pages under the top one stay mounted (the search keeps its results) but cannot be reached.
        <div key={`${i}:${page.view === 'place' ? page.place.id : 'search'}`} className="dsc-layer" inert={i < stack.length - 1}>
          <Suspense fallback={<div className="dsc-boot" aria-busy="true" />}>
            {page.view === 'search'
              ? <SearchScreen profile={profile} />
              : <PlaceScreen place={page.place} profile={profile} onScanPlace={onScanPlace} onViewMap={onViewMap} onToast={onToast} />}
          </Suspense>
        </div>
      ))}
    </>,
    document.body,
  )
}

/** A row for the restaurant sheet on the map: open now at a glance, and the way into the details. */
export function PlaceMore({ place, quiet = false }: { place: PlaceDetails; quiet?: boolean }) {
  const position = usePosition()
  const { label: hours } = hoursNow(place, position.status === 'granted' ? position.position : null)
  const label = quiet ? null : hours
  return (
    <button type="button" className="dsc-more" onClick={() => openPlace(place)}>
      {label ? <span className={`dsc-open dsc-open--${label.tone}`}>{label.text}</span> : <span className="dsc-more__ic"><Icon name="info" size={18} /></span>}
      <b>{label ? 'Details' : 'Hours and details'}</b>
      <Icon name="chevron" size={18} />
    </button>
  )
}
