// Restaurant search. Type a name: matches from the restaurants the map already knows, instantly. Pick or
// submit an area ("Kreuzberg", a street, a town): the restaurants around it, with "Open now" and
// "Reported seed-oil free" as filters. A tap on a restaurant opens its details.
import { useEffect, useMemo, useRef, useState } from 'react'
import { BERLIN_AREAS } from '../../../snapmenu-api/src/discover/areas'
import { reportedSeedOilFree } from '../../../snapmenu-api/src/discover/confidence'
import type { Place, PlacesResponse, Profile } from '../../../snapmenu-api/src/types'
import { Icon } from '../components/ui'
import { track } from '../lib/api'
import { fetchPlaces } from '../lib/places'
import { distance, formatDistance, usePosition, type LatLng } from '../lib/position'
import { fetchSeedOilAround, searchDiscover, type AreaHit, type PlaceDetails, type SearchResponse, type SeedOilView } from './api'
import { hoursNow } from './hours'
import { discoverBack, openPlace } from './nav'
import { SeedOilBadge } from './SeedOil'

const KIND: Record<Place['kind'], string> = { restaurant: 'Restaurant', fast_food: 'Fast food', cafe: 'Café' }
const SHOWN = 60

function PlaceRow({ place, user, seedOil, scanned }: { place: PlaceDetails; user: LatLng | null; seedOil: SeedOilView | null | undefined; scanned: number }) {
  const { label } = hoursNow(place, user)
  // Distance only when we really know where the person is; otherwise the street says more.
  const where = user ? formatDistance(distance(user, place)) : place.address
  const meta = [place.cuisine ?? KIND[place.kind], where, scanned > 0 ? `${scanned} ${scanned === 1 ? 'dish' : 'dishes'}` : null].filter(Boolean).join(' · ')
  return (
    <button type="button" className="dsc-row" onClick={() => openPlace(place)}>
      <span className="dsc-row__body">
        <b>{place.name}</b>
        <span className="dsc-row__meta">{meta}</span>
        {reportedSeedOilFree(seedOil) && <span className="dsc-row__tags"><SeedOilBadge view={seedOil} size="sm" /></span>}
      </span>
      {label && <span className={`dsc-open dsc-open--${label.tone}`}>{label.short}</span>}
      <Icon name="chevron" size={18} />
    </button>
  )
}

function Skeleton() {
  return (
    <div className="card-flat list-card" aria-busy="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="dsc-row">
          <span className="dsc-row__body"><span className="skeleton" style={{ height: 15, width: `${68 - i * 9}%` }} /><span className="skeleton" style={{ height: 12, width: '44%' }} /></span>
        </div>
      ))}
    </div>
  )
}

export default function SearchScreen({ profile }: { profile: Profile | null }) {
  const position = usePosition()
  const user = position.status === 'granted' ? position.position : null
  const near = position.position
  const [q, setQ] = useState('')
  const [res, setRes] = useState<SearchResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [area, setArea] = useState<AreaHit | null>(null)
  const [list, setList] = useState<PlacesResponse | null>(null)
  const [listFailed, setListFailed] = useState(false)
  const [oil, setOil] = useState<Record<string, SeedOilView>>({})
  const [onlyOpen, setOnlyOpen] = useState(false)
  const [onlyOil, setOnlyOil] = useState(false)
  const [retry, setRetry] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // While typing: our own data only (cached restaurants, known areas). Nominatim is asked on submit, never per key.
  useEffect(() => {
    const text = q.trim()
    if (text.length < 2) { setRes(null); setBusy(false); setNote(null); return }
    const ctrl = new AbortController()
    const t = window.setTimeout(() => {
      setBusy(true)
      searchDiscover(text, near, false, ctrl.signal)
        .then((r) => { setRes(r); setBusy(false) })
        .catch((e) => { if ((e as Error).name !== 'AbortError') setBusy(false) })
    }, 220)
    return () => { window.clearTimeout(t); ctrl.abort() }
  }, [q, near.lat, near.lng])

  const submit = async () => {
    const text = q.trim()
    if (text.length < 2) return
    inputRef.current?.blur()
    setBusy(true)
    setNote(null)
    try {
      const r = await searchDiscover(text, near, true)
      setRes(r)
      if (r.geo === 'busy') setNote('Place search is busy. Try again in a moment.')
      else if (r.geo === 'unavailable') setNote('Place search is not reachable right now.')
      track('discover_search', { places: r.places.length, areas: r.areas.length })
    } catch (e) {
      setNote((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const pickArea = (a: AreaHit) => {
    inputRef.current?.blur()
    setArea(a)
    setList(null)
    setListFailed(false)
    setOnlyOpen(false)
    setOnlyOil(false)
    track('discover_area', { kind: a.kind })
  }

  // The restaurants around the picked area come from the same list the map uses (and fill its cache).
  useEffect(() => {
    if (!area) return
    let live = true
    setListFailed(false)
    fetchPlaces(area.lat, area.lng, profile)
      .then((d) => { if (live) { setList(d); setListFailed(d.source === 'unavailable') } })
      .catch(() => { if (live) setListFailed(true) })
    fetchSeedOilAround(area).then((m) => { if (live) setOil(m) }).catch(() => {})
    return () => { live = false }
  }, [area, profile, retry])

  const around = useMemo(() => {
    if (!area || !list) return []
    // Around the picked area's centre ("Near you" is the person's own position); the rows show how far each is from the person.
    return (list.places as PlaceDetails[])
      .map((p) => ({ p, d: distance(area, p) }))
      .sort((a, b) => a.d - b.d)
      .map((x) => x.p)
  }, [area, list])
  const shown = useMemo(() => around.filter((p) => {
    if (onlyOil && !reportedSeedOilFree(oil[p.id])) return false
    if (onlyOpen) { const s = hoursNow(p, user).label; if (!s || s.tone === 'closed') return false }
    return true
  }), [around, onlyOil, onlyOpen, oil, user])

  const typed = q.trim().length >= 2
  const nothing = typed && res !== null && res.places.length === 0 && res.areas.length === 0

  return (
    <main className="screen dsc dsc-find">
      <form className="dsc-search" role="search" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <button type="button" className="icon-btn" onClick={discoverBack} aria-label="Back"><Icon name="back" size={20} /></button>
        <label className="dsc-field">
          <Icon name="search" size={18} strokeWidth={2} />
          <input
            ref={inputRef}
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Restaurant or area"
            aria-label="Search restaurants or areas"
            value={q}
            onChange={(e) => { setQ(e.target.value); setArea(null) }}
            autoFocus
          />
          {busy && <span className="attach__spin" role="status" aria-label="Searching" />}
          {q && !busy && <button type="button" className="dsc-clear" aria-label="Clear" onClick={() => { setQ(''); setArea(null); inputRef.current?.focus() }}><Icon name="close" size={16} strokeWidth={2.2} /></button>}
        </label>
      </form>

      {area ? (
        <>
          <div className="dsc-area">
            <div style={{ minWidth: 0, flex: 1 }}>
              <h1 className="h2">{area.name}</h1>
              <p className="small">{list ? `${shown.length} ${shown.length === 1 ? 'place' : 'places'}` : 'Loading places'}{area.label ? ` · ${area.label}` : ''}</p>
            </div>
            <button type="button" className="icon-btn" aria-label="Close area" onClick={() => setArea(null)}><Icon name="close" size={18} /></button>
          </div>
          <div className="quick" role="group" aria-label="Filters">
            <button type="button" className="q-chip" aria-pressed={onlyOpen} onClick={() => setOnlyOpen((v) => !v)}>Open now</button>
            <button type="button" className="q-chip" aria-pressed={onlyOil} onClick={() => setOnlyOil((v) => !v)}>Reported seed-oil free</button>
          </div>
          {listFailed ? (
            <div className="state dsc-state" role="status">
              <p className="body">Map data is busy right now.</p>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRetry((n) => n + 1)}><Icon name="refresh" size={16} /> Retry</button>
            </div>
          ) : !list ? <Skeleton /> : shown.length === 0 ? (
            <div className="state dsc-state" role="status">
              <p className="body">{onlyOil ? 'No reports here yet. Open a restaurant to add the first.' : onlyOpen ? 'Nothing open here right now.' : 'No restaurants found here.'}</p>
              {(onlyOil || onlyOpen) && <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setOnlyOil(false); setOnlyOpen(false) }}>Show all</button>}
            </div>
          ) : (
            <div className="card-flat list-card dsc-list">
              {shown.slice(0, SHOWN).map((p) => <PlaceRow key={p.id} place={p} user={user} seedOil={oil[p.id]} scanned={list.scored[p.id]?.dishes ?? 0} />)}
            </div>
          )}
        </>
      ) : typed ? (
        <>
          {note && <p className="banner dsc-note" role="status">{note}</p>}
          {res && res.areas.length > 0 && (
            <section className="dsc-sec">
              <p className="eyebrow">Areas</p>
              <div className="card-flat list-card dsc-list">
                {res.areas.map((a) => (
                  <button key={`${a.name}|${a.lat}|${a.lng}`} type="button" className="dsc-row" onClick={() => pickArea(a)}>
                    <span className="avoid-ic"><Icon name="pin" size={18} /></span>
                    <span className="dsc-row__body"><b>{a.name}</b>{a.label && <span className="dsc-row__meta">{a.label}</span>}</span>
                    <Icon name="chevron" size={18} />
                  </button>
                ))}
              </div>
            </section>
          )}
          {res && res.places.length > 0 && (
            <section className="dsc-sec">
              <p className="eyebrow">Restaurants</p>
              <div className="card-flat list-card dsc-list">
                {res.places.map((p) => <PlaceRow key={p.id} place={p} user={user} seedOil={p.seedOil} scanned={p.scanned} />)}
              </div>
            </section>
          )}
          {!res && <Skeleton />}
          {nothing && !busy && (
            <div className="state dsc-state" role="status">
              <p className="body">{res?.geo === 'local' ? 'No match nearby yet.' : 'Nothing found. Check the spelling.'}</p>
              {res?.geo === 'local' && <button type="button" className="btn btn-secondary btn-sm" onClick={() => void submit()}><Icon name="search" size={16} /> Search everywhere</button>}
            </div>
          )}
          {res && res.geo === 'local' && !busy && !nothing && (
            <button type="button" className="link-btn dsc-more-btn" onClick={() => void submit()}><Icon name="search" size={16} /> Search everywhere</button>
          )}
        </>
      ) : (
        <section className="dsc-sec">
          <p className="eyebrow">Areas</p>
          <div className="dsc-areas">
            <button type="button" className="q-chip dsc-near" onClick={() => pickArea({ name: user ? 'Near you' : 'Berlin Mitte', label: '', lat: near.lat, lng: near.lng, kind: 'near' })}>
              <Icon name="locate" size={15} strokeWidth={2} /> {user ? 'Near you' : 'Berlin Mitte'}
            </button>
            {BERLIN_AREAS.filter((a) => user || a.name !== 'Mitte').map((a) => <button key={a.name} type="button" className="q-chip" onClick={() => pickArea(a)}>{a.name}</button>)}
          </div>
        </section>
      )}

      <p className="dsc-credit dsc-credit--list">Places and names © OpenStreetMap contributors</p>
    </main>
  )
}
