import { lazy, Suspense, useMemo } from 'react'
import type { PlaceMatch } from '../../../snapmenu-api/src/group/types'
import { Icon } from '../components/ui'
import './map.css'

const ScoreMap = lazy(() => import('./ScoreMap'))
const noop = () => {}

export function osmPlaceLink({ lat, lng }: { lat: number; lng: number }) {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`
}

/** Keep the selected restaurant and its dishes together, without leaving the app. */
export function PickMap({ place, label, example }: { place: PlaceMatch['place']; label: string; example: boolean }) {
  const pins = useMemo(() => [{ id: place.id, name: place.name, lat: place.lat, lng: place.lng, label, order: 0, isExample: example, dish: null }], [place.id, place.name, place.lat, place.lng, label, example])
  return (
    <div className="pick-map">
      <Suspense fallback={<div className="score-map score-map--loading" aria-label="Loading map" />}>
        <ScoreMap pins={pins} metric="score" activeId={null} onSelect={noop} onOpen={noop} user={null} frameKey={place.id} focus={place} locateNonce={0} insets={{ top: 0, bottom: 0 }} compact />
      </Suspense>
      <a className="pick-map__open" href={osmPlaceLink(place)} target="_blank" rel="noreferrer" aria-label={`Open ${place.name} in OpenStreetMap`}><Icon name="external" size={16} /></a>
    </div>
  )
}
