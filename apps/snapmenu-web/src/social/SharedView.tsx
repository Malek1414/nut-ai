// What a share link opens to: the dish, pick or restaurant a friend sent, and one next step.
import { useEffect, useState } from 'react'
import { BRAND } from '../../../snapmenu-api/src/brand'
import type { Place } from '../../../snapmenu-api/src/types'
import { Icon, Macros, RangeBar, Wordmark } from '../components/ui'
import { track } from '../lib/api'
import { fetchShare, type ShareView } from './client'

type Loaded = ShareView & { title: string; summary: string }

export function SharedView({ id, onClose, onScan, onViewPlace }: {
  id: string
  /** Leave to the app's start. */
  onClose: () => void
  onScan: () => void
  onViewPlace: (place: Place) => void
}) {
  const [share, setShare] = useState<Loaded | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    const ctrl = new AbortController()
    setShare(null)
    setMissing(false)
    fetchShare(id, ctrl.signal).then(
      (s) => { setShare(s); track('share_open', { kind: s.kind }) },
      (e) => { if ((e as { code?: string }).code !== 'aborted') setMissing(true) },
    )
    return () => ctrl.abort()
  }, [id])

  if (missing) {
    return (
      <main className="screen with-cta">
        <div className="topbar"><Wordmark onClick={onClose} /></div>
        <div className="state" role="alert">
          <span className="s-ic"><Icon name="share" size={30} /></span>
          <h1 className="h2">This link is no longer here</h1>
          <p className="body" style={{ maxWidth: 280 }}>Ask your friend to share it again.</p>
        </div>
        <div className="cta-bar">
          <button className="btn btn-primary" onClick={onClose}>Open {BRAND.name}</button>
        </div>
      </main>
    )
  }

  if (!share) {
    return (
      <main className="screen with-cta" aria-busy="true">
        <div className="topbar"><Wordmark onClick={onClose} /></div>
        <div className="so-shared__head">
          <span className="skeleton" style={{ height: 14, width: '38%' }} />
          <span className="skeleton" style={{ height: 34, width: '86%' }} />
          <span className="skeleton" style={{ height: 18, width: '54%' }} />
        </div>
        <div className="card skeleton" style={{ height: 212, borderRadius: 'var(--r-lg)' }} />
      </main>
    )
  }

  const place: Place | null = share.place
    ? { id: share.place.id, name: share.place.name, lat: share.place.lat, lng: share.place.lng, kind: 'restaurant', cuisine: share.place.cuisine, address: share.place.address, vegan: null, vegetarian: null }
    : null
  const where = share.place?.name ?? share.restaurant
  const d = share.dish

  if (!d) {
    const meta = [share.place?.cuisine?.replace(/[_;]/g, ' '), share.place?.address].filter(Boolean).join(' · ')
    return (
      <main className="screen with-cta">
        <div className="topbar"><Wordmark onClick={onClose} /></div>
        <div className="so-shared__head">
          <p className="eyebrow">A friend wants to eat here</p>
          <h1 className="h1">{where ?? BRAND.name}</h1>
          {meta && <p className="lead">{meta}</p>}
        </div>
        <div className="cta-bar">
          {place && <button className="btn btn-primary" onClick={() => onViewPlace(place)}><Icon name="map" size={20} /> See it on the map</button>}
          <button className={`btn ${place ? 'btn-secondary' : 'btn-primary'}`} onClick={onScan}><Icon name="camera" size={20} /> Scan a menu</button>
        </div>
      </main>
    )
  }

  return (
    <main className="screen with-cta so-shared">
      <div className="topbar"><Wordmark onClick={onClose} /></div>
      <div className="so-shared__head">
        <p className="eyebrow">{share.kind === 'pick' ? (share.goal ? `A friend's pick · ${share.goal}` : "A friend's pick") : 'A friend sent you this'}</p>
        <h1 className="h1">{d.name}</h1>
        {d.translated && <p className="lead">{d.translated}</p>}
        {where && (
          place
            ? <button className="so-where" onClick={() => onViewPlace(place)}><Icon name="pin" size={16} />{where}<Icon name="chevron" size={14} /></button>
            : <p className="so-where"><Icon name="pin" size={16} />{where}</p>
        )}
      </div>

      <section className="card" style={{ padding: 20, display: 'grid', gap: 16 }}>
        <RangeBar range={d.kcal} tier={d.bandTier} />
        <Macros d={d} />
        {d.why && <p className="best__why">{d.why}</p>}
      </section>

      {d.allergens.length > 0 && (
        <section className="card-flat allergy-card">
          <div className="allergen-row" aria-label="Likely allergens">
            <span className="small">May contain</span>
            {d.allergens.map((a) => <span key={a} className="a-chip">{a}</span>)}
          </div>
          <p className="small">Hints, not a guarantee. Confirm with the restaurant.</p>
        </section>
      )}
      <p className="small so-note">Estimates as ranges, from the open Nut AI engine.</p>

      <div className="cta-bar">
        <button className="btn btn-primary" onClick={onScan}><Icon name="camera" size={20} /> Scan your own menu</button>
      </div>
    </main>
  )
}
