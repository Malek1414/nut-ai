// Delivery UI: the honest badge, "Order it" links to Wolt, Lieferando and Uber Eats, the provider sheet
// for dish cards, and the one-tap "Delivers? yes / no" community vote.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Place } from '../../../snapmenu-api/src/types'
import { orderUrl, PROVIDERS, trackOrder, voteDelivery, type DeliveryConfidence, type PlaceVotes, type Provider } from '../lib/delivery'
import { Icon } from './ui'

type Level = DeliveryConfidence['level']

/** "Delivers (OSM)", "Delivers · 3 confirmed" (basil) or "Likely delivers" (violet: uncertain, like our ranges). */
export function DeliveryBadge({ level, label, size = 'md' }: { level: Level; label: string; size?: 'sm' | 'md' }) {
  if (level === 'none' || !label) return null
  return (
    <span className={`dl-badge dl-badge--${level} dl-badge--${size}`} title={level === 'likely' ? 'A guess from OpenStreetMap hints and distance, not confirmed' : undefined}>
      <Icon name="bag" size={size === 'sm' ? 12 : 14} strokeWidth={2.1} />
      {label}
    </span>
  )
}

function ProviderDot({ id }: { id: Provider }) {
  const p = PROVIDERS.find((x) => x.id === id)!
  return <i className="dl-dot" style={{ background: p.color }} aria-hidden="true" />
}

/** Three links that search the restaurant on each platform in a new tab. */
export function OrderLinks({ place, from, onOrdered }: { place: Place; from: 'card' | 'sheet' | 'post'; onOrdered?: () => void }) {
  return (
    <div className="dl-links" role="group" aria-label={`Order from ${place.name}`}>
      {PROVIDERS.map((p) => (
        <a
          key={p.id}
          className="dl-link"
          href={orderUrl(p.id, place)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => { trackOrder(p.id, place, from); onOrdered?.() }}
        >
          <ProviderDot id={p.id} />
          <b>{p.label}</b>
          <span className="dl-link__go" aria-label="opens in a new tab"><Icon name="external" size={16} strokeWidth={2} /></span>
        </a>
      ))}
    </div>
  )
}

/** Small "Order" button on a dish card; opens the provider sheet. */
export function OrderChip({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" className="dl-chip" onClick={(e) => { e.stopPropagation(); onClick() }} aria-label={label}>
      <Icon name="bag" size={14} strokeWidth={2.1} /> Order
    </button>
  )
}

export function OrderSheet({ place, dish, conf, onClose }: { place: Place; dish?: string | null; conf: DeliveryConfidence; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet dl-sheet" role="dialog" aria-modal="true" aria-labelledby="dl-sheet-title">
        <div className="grab" />
        <div className="dl-sheet__head">
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 id="dl-sheet-title" className="h2">{dish ?? place.name}</h2>
            {dish && <p className="small">{place.name}</p>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={20} /></button>
        </div>
        <OrderLinks place={place} from="card" onOrdered={onClose} />
        <div className="dl-fine">
          {conf.level !== 'none' && <DeliveryBadge level={conf.level} label={conf.label} size="sm" />}
          <p className="small">{conf.level !== 'none' && conf.reason ? `${conf.reason.replace(/\.$/, '')}. ` : ''}Opens a search in that app. Delivery is not guaranteed.</p>
        </div>
      </div>
    </>,
    document.body,
  )
}

/** "Delivers?" with one-tap Yes / No. Optimistic; tapping your answer again takes it back. */
export function DeliveryVote({ place, votes, onVotes }: { place: Place; votes: PlaceVotes | null; onVotes: (v: PlaceVotes) => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const cast = async (want: -1 | 1) => {
    if (!votes || busy) return
    const value: -1 | 0 | 1 = votes.myVote === want ? 0 : want
    const prev = votes
    const next = {
      yes: votes.yes - (votes.myVote === 1 ? 1 : 0) + (value === 1 ? 1 : 0),
      no: votes.no - (votes.myVote === -1 ? 1 : 0) + (value === -1 ? 1 : 0),
      myVote: value,
    }
    onVotes(next)
    setBusy(true)
    setErr(null)
    try { onVotes(await voteDelivery(place, value)) } catch (e) { onVotes(prev); setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className="dl-vote">
      <span className="dl-vote__q">Delivers?</span>
      <span className="dl-vote__opts">
        <button type="button" className="dl-vote__btn" aria-pressed={votes?.myVote === 1} disabled={!votes} onClick={() => void cast(1)}>
          <Icon name="check" size={15} strokeWidth={2.4} /> Yes{votes && votes.yes > 0 ? <b className="num">{votes.yes}</b> : null}
        </button>
        <button type="button" className="dl-vote__btn dl-vote__btn--no" aria-pressed={votes?.myVote === -1} disabled={!votes} onClick={() => void cast(-1)}>
          <Icon name="close" size={15} strokeWidth={2.4} /> No{votes && votes.no > 0 ? <b className="num">{votes.no}</b> : null}
        </button>
      </span>
      {err && <span className="small" role="alert" style={{ color: 'var(--alert)', gridColumn: '1 / -1' }}>{err}</span>}
    </div>
  )
}
