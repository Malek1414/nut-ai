// After a scan: "Where are you eating?" File the scan under one of the 5 closest restaurants (or skip),
// so its best dishes show on that restaurant's map pin for everyone nearby.
import { useEffect, useRef, useState } from 'react'
import type { MenuResult, Place, Profile } from '../../../snapmenu-api/src/types'
import { Icon } from '../components/ui'
import { attachScan, fetchPlaces } from '../lib/places'
import { distance, formatDistance, requestPosition, usePosition } from '../lib/position'

const KEY = (scanId: string) => `snapmenu.attach.${scanId}`
type Saved = { place: Place } | { skipped: true }

function readSaved(scanId: string): Saved | null {
  try {
    const saved = JSON.parse(window.localStorage.getItem(KEY(scanId)) ?? 'null') as Saved | null
    if (!saved) return null
    // Attachments made before OSM verification are private until the place is confirmed.
    return 'skipped' in saved || saved.place?.verified === true ? saved : null
  } catch {
    return null
  }
}
function save(scanId: string, v: Saved) {
  try { window.localStorage.setItem(KEY(scanId), JSON.stringify(v)) } catch { /* ignore */ }
}

export function AttachCard({ result, profile, pendingPlace, onViewMap, onAttached }: {
  result: MenuResult
  profile: Profile | null
  /** The restaurant whose "Scan this menu" started this scan: attach to it straight away. */
  pendingPlace: Place | null
  onViewMap: (place: Place) => void
  onAttached?: (place: Place) => void
}) {
  const position = usePosition()
  const [saved, setSaved] = useState<Saved | null>(() => readSaved(result.scanId))
  const [closest, setClosest] = useState<Array<{ place: Place; d: number }> | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [chooseAnother, setChooseAnother] = useState(false)
  const auto = useRef(false)

  const attach = async (place: Place) => {
    setBusy(place.id)
    setError(null)
    try {
      const confirmed = await attachScan(result, place)
      const v = { place: confirmed }
      save(result.scanId, v)
      setSaved(v)
      onAttached?.(confirmed)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not attach the scan.')
    } finally {
      setBusy(null)
    }
  }

  // Came from a restaurant's "Scan this menu": file it there without asking again.
  useEffect(() => {
    if (pendingPlace && !saved && !auto.current) {
      auto.current = true
      void attach(pendingPlace)
    }
    // attach is stable enough for a one-shot.
  }, [pendingPlace, saved])

  // Otherwise offer the 5 closest restaurants.
  const where = position.position
  useEffect(() => {
    if (saved || (pendingPlace && !chooseAnother) || !expanded || position.status !== 'granted') return
    let live = true
    setClosest(null)
    fetchPlaces(where.lat, where.lng, profile)
      .then((d) => {
        if (!live) return
        setClosest(d.places.filter((place) => place.verified).map((place) => ({ place, d: distance(where, place) })).sort((a, b) => a.d - b.d).slice(0, 5))
      })
      .catch(() => live && setClosest([]))
    return () => { live = false }
  }, [where.lat, where.lng, saved, pendingPlace, chooseAnother, profile, expanded, position.status])

  if (saved && 'skipped' in saved) return null

  if (saved && 'place' in saved) {
    return (
      <div className="attach attach--done" role="status">
        <span className="attach__check"><Icon name="check" size={18} strokeWidth={2.4} /></span>
        <span className="attach__done-text">
          <b>On the map at {saved.place.name}</b>
        </span>
        <button className="btn btn-secondary btn-sm" onClick={() => onViewMap(saved.place)}><Icon name="map" size={16} /> View</button>
      </div>
    )
  }

  if (pendingPlace && !chooseAnother) {
    return (
      <div className="attach attach--done" role="status" aria-busy={!error}>
        {!error && <span className="attach__check is-busy" />}
        <span className="attach__done-text"><b>{error ? 'Couldn’t confirm the attachment' : `Adding to ${pendingPlace.name}…`}</b>{error && <span className="small">{error}</span>}</span>
        {error && <button className="btn btn-secondary btn-sm" onClick={() => { setError(null); setChooseAnother(true); setExpanded(true) }}>Choose a place</button>}
      </div>
    )
  }

  const precise = position.status === 'granted'
  if (!expanded) return <button className="card attach attach__head" style={{ width: '100%', textAlign: 'left' }} onClick={() => { setExpanded(true); if (!precise) void requestPosition() }}><Icon name="pin" size={20} /><b style={{ flex: 1 }}>Add to the map</b><Icon name="chevron" size={18} /></button>
  return (
    <section className="card attach" aria-labelledby="attach-title">
      <div className="attach__head">
        <span className="attach__ic"><Icon name="pin" size={20} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
            <h2 id="attach-title" className="h3">Add to the map</h2>
        </div>
      </div>
      {!precise && (
        <button className="attach__locate" onClick={() => void requestPosition()} disabled={position.status === 'locating'}>
            <Icon name="locate" size={16} /> {position.status === 'locating' ? 'Locating…' : position.status === 'denied' ? 'Turn on location to add this menu to the map.' : 'Use my location for the closest places'}
        </button>
      )}
        {precise && <div className="attach__list" aria-busy={closest === null}>
        {closest === null && [0, 1, 2].map((i) => <div key={i} className="attach__row"><span className="skeleton" style={{ height: 14, width: `${60 - i * 10}%` }} /></div>)}
        {closest?.length === 0 && <p className="small" style={{ padding: '8px 0' }}>No restaurants found nearby right now. You can skip this.</p>}
        {closest?.map(({ place, d }) => (
          <button key={place.id} className="attach__row" onClick={() => void attach(place)} disabled={busy !== null}>
            <span style={{ flex: 1, minWidth: 0, display: 'grid' }}>
              <b>{place.name}</b>
              <span className="small">{[place.cuisine, formatDistance(d)].filter(Boolean).join(' · ')}</span>
            </span>
            {busy === place.id ? <span className="attach__spin" aria-label="Adding" /> : <Icon name="plus" size={18} />}
          </button>
        ))}
        </div>}
      {error && <p className="small" role="alert" style={{ color: 'var(--alert)' }}>{error}</p>}
        <button className="btn btn-ghost btn-sm" style={{ justifySelf: 'center' }} onClick={() => setExpanded(false)}>Close</button>
      <p className="small" style={{ textAlign: 'center' }}>Restaurants © OpenStreetMap contributors</p>
    </section>
  )
}
