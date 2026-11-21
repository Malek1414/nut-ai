// Seed oils: the badge ("Reported seed-oil free", never "is"), who says so, and the one-tap report with an
// optional source link. Status is always one of verified (its own website), reported (the community), unknown.
import { useState } from 'react'
import { seedOilConfidence } from '../../../snapmenu-api/src/discover/confidence'
import { hostOf } from '../../../snapmenu-api/src/discover/osm-tags'
import { Icon } from '../components/ui'
import { sendSeedOilReport, type SeedOilView } from './api'
import { ConfidencePill } from './Confidence'

export const NO_SEED_OIL_INFO: SeedOilView = { status: 'unknown', label: '', source: 'No reports yet.', yes: 0, no: 0, myReport: 0, links: [], web: null }

const STATUS: Record<SeedOilView['status'], string> = { verified: 'Verified source', reported: 'Community report', unknown: 'Unknown' }

/** Shown only when someone other than us says so. Basil for the restaurant's own website, violet for community reports. */
export function SeedOilBadge({ view, size = 'md' }: { view: Pick<SeedOilView, 'status' | 'label'> | null | undefined; size?: 'sm' | 'md' }) {
  if (!view || view.status === 'unknown' || !view.label) return null
  return (
    <span className={`oil-badge oil-badge--${view.status} oil-badge--${size}`} title={view.status === 'verified' ? "Stated on the restaurant's own website" : 'Reported by the community, not verified'}>
      <Icon name="leaf" size={size === 'sm' ? 12 : 14} strokeWidth={2.1} />
      {view.label}
    </span>
  )
}

export function SeedOilCard({ place, view, onView, onToast }: {
  place: { id: string; lat: number; lng: number }
  view: SeedOilView
  onView: (v: SeedOilView) => void
  onToast: (t: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [linking, setLinking] = useState(false)
  const [link, setLink] = useState('')
  const [err, setErr] = useState<string | null>(null)
  // One link per website: two reports citing the same site read as one source.
  const sources = view.links.filter((l, i, all) => all.findIndex((x) => hostOf(x) === hostOf(l)) === i)

  const send = async (value: -1 | 0 | 1, sourceUrl?: string) => {
    if (busy) return false
    setBusy(true)
    setErr(null)
    try {
      onView(await sendSeedOilReport(place, value, sourceUrl))
      return true
    } catch (e) {
      setErr((e as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }
  const cast = async (want: -1 | 1) => {
    const value: -1 | 0 | 1 = view.myReport === want ? 0 : want
    if (value !== 1) setLinking(false)
    if ((await send(value)) && value !== 0) onToast('Thanks, reported')
  }
  const saveLink = async () => {
    const url = link.trim()
    if (!url) { setLinking(false); return }
    if (await send(1, url)) { setLinking(false); setLink(''); onToast('Source added') }
  }

  return (
    <section className="card-flat dsc-card" aria-labelledby="oil-title">
      <div className="dsc-card__head">
        <h2 id="oil-title" className="h3">Seed oils</h2>
        <ConfidencePill value={seedOilConfidence(view)} />
      </div>
      <div className="oil-state">
        <SeedOilBadge view={view} />
        <span className="oil-status">{STATUS[view.status]}</span>
      </div>
      <p className="small">{view.source}</p>
      {view.web?.quote && (
        <blockquote className="oil-quote">
          “{view.web.quote}”
          <a href={view.web.url} target="_blank" rel="noopener noreferrer">{hostOf(view.web.url)} <Icon name="external" size={13} strokeWidth={2} /></a>
        </blockquote>
      )}
      {sources.length > 0 && (
        <p className="small oil-links">
          Sources:{' '}
          {sources.map((l) => <a key={l} href={l} target="_blank" rel="noopener noreferrer nofollow ugc">{hostOf(l)}</a>)}
        </p>
      )}
      <div className="dl-vote">
        <span className="dl-vote__q">Seed-oil free?</span>
        <span className="dl-vote__opts">
          <button type="button" className="dl-vote__btn" aria-pressed={view.myReport === 1} disabled={busy} onClick={() => void cast(1)}>
            <Icon name="check" size={15} strokeWidth={2.4} /> Yes{view.yes > 0 ? <b className="num">{view.yes}</b> : null}
          </button>
          <button type="button" className="dl-vote__btn dl-vote__btn--no" aria-pressed={view.myReport === -1} disabled={busy} onClick={() => void cast(-1)}>
            <Icon name="close" size={15} strokeWidth={2.4} /> No{view.no > 0 ? <b className="num">{view.no}</b> : null}
          </button>
        </span>
        {err && <span className="small" role="alert" style={{ color: 'var(--alert)', gridColumn: '1 / -1' }}>{err}</span>}
      </div>
      {view.myReport === 1 && (linking ? (
        <form className="oil-link" onSubmit={(e) => { e.preventDefault(); void saveLink() }}>
          <input className="input" type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" placeholder="https://" aria-label="Link to the source" value={link} onChange={(e) => setLink(e.target.value)} autoFocus />
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>Save</button>
        </form>
      ) : (
        <button type="button" className="link-btn oil-add" onClick={() => setLinking(true)}><Icon name="plus" size={16} /> Add a source link</button>
      ))}
      <p className="small">Reports and website text, never a guarantee. Ask the restaurant.</p>
    </section>
  )
}
