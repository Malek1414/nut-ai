// The small pieces other screens place: two rows for the Me tab, the one-time home screen hint on a
// result, "Share" in a restaurant's sheet, the landing for visitors from Instagram, and the /numbers block.
import { useEffect, useState, useSyncExternalStore } from 'react'
import { BRAND, taglineParts } from '../../../snapmenu-api/src/brand'
import type { SocialNumbers as SocialNumbersData } from '../../../snapmenu-api/src/social/types'
import { PLATFORM_LABEL, type Platform } from '../../../snapmenu-api/src/social/links'
import { PREMIUM_WANTS } from '../../../snapmenu-api/src/social/premium-terms'
import type { Place } from '../../../snapmenu-api/src/types'
import { Footer, Icon, Logo, Sheet, Wordmark } from '../components/ui'
import { track } from '../lib/api'
import { n0 } from '../lib/format'
import { HeroArt, LandingActions } from '../screens/Landing'
import { social } from './bus'
import { currentSource, flags, savedImports } from './client'
import { installWay, onInstallChange, promptInstall } from './install'

const useInstallWay = () => useSyncExternalStore(onInstallChange, installWay, () => null)

// ---------- Me tab ----------

/** "Save from a link", "Get Premium early" and, where the phone can, "Add to Home Screen". One quiet card. */
export function SocialRows() {
  const saved = useSyncExternalStore(savedImports.subscribe, savedImports.list, savedImports.list)
  const way = useInstallWay()
  const [iosHelp, setIosHelp] = useState(false)
  return (
    <div className="card-flat list-card set-list">
      <button className="set-row" onClick={() => social.openImport()}>
        <span className="set-row__ic" style={{ background: 'var(--carbs-tint)', color: 'var(--carbs)' }}><Icon name="bookmark" size={18} /></span>
        <span className="set-row__label">Save from a link</span>
        <span className="set-row__value">{saved.length > 0 ? `${saved.length} saved` : ''}</span>
        <Icon name="chevron" size={18} />
      </button>
      {way && (
        <button className="set-row" onClick={() => (way === 'prompt' ? void promptInstall() : setIosHelp(true))}>
          <span className="set-row__ic" style={{ background: 'var(--basil-tint)', color: 'var(--basil)' }}><Icon name="download" size={18} /></span>
          <span className="set-row__label">Add to Home Screen</span>
          <span className="set-row__value" />
          <Icon name="chevron" size={18} />
        </button>
      )}
      {iosHelp && (
        <Sheet label="Add to Home Screen" onClose={() => setIosHelp(false)} className="so-sheet">
          <div className="so-sheet__head">
            <h2 className="h2">Add to Home Screen</h2>
            <button className="icon-btn" onClick={() => setIosHelp(false)} aria-label="Close"><Icon name="close" size={20} /></button>
          </div>
          <ol className="so-steps">
            <li><span className="so-steps__n">1</span><span>Tap <Icon name="share" size={16} className="so-install__glyph" /> <b>Share</b> at the bottom of Safari.</span></li>
            <li><span className="so-steps__n">2</span><span>Choose <b>Add to Home Screen</b>.</span></li>
          </ol>
          <button className="btn btn-primary" onClick={() => setIosHelp(false)}>Got it</button>
        </Sheet>
      )}
      <button className="set-row" onClick={() => social.openPremium()}>
        <span className="set-row__ic" style={{ background: 'var(--saffron-tint)', color: '#7a5208' }}><Icon name="spark" size={18} /></span>
        <span className="set-row__label">Get Premium early</span>
        <span className="set-row__value">Free beta</span>
        <Icon name="chevron" size={18} />
      </button>
    </div>
  )
}

// ---------- Home screen hint ----------

/**
 * The hint to put the app on the home screen. Shown once per phone, the first
 * time it is placed on screen where the phone can install (never inside
 * Instagram's or another app's browser, never when already installed).
 */
export function InstallHint() {
  const way = useInstallWay()
  // Decided on first render: the hint stays for this visit of the screen and does not come back.
  const [fresh] = useState(() => !flags.installHintSeen())
  const [open, setOpen] = useState(true)
  const show = fresh && open && way !== null
  useEffect(() => {
    if (!show) return
    flags.setInstallHintSeen()
    track('pwa_hint', { way })
  }, [show, way])
  if (!show) return null
  return (
    <div className="so-install" role="note">
      <Logo size={40} />
      <div className="so-install__text">
        <b>Add {BRAND.name} to your home screen</b>
        <span className="small">{way === 'ios' ? <>Tap <Icon name="share" size={14} className="so-install__glyph" /> Share, then “Add to Home Screen”.</> : 'Opens like an app, straight to the camera.'}</span>
      </div>
      {way === 'prompt'
        ? <button className="btn btn-primary btn-sm" onClick={() => { void promptInstall().then((yes) => { if (yes) setOpen(false) }) }}>Add</button>
        : <button className="icon-btn so-install__close" onClick={() => setOpen(false)} aria-label="Dismiss"><Icon name="close" size={18} /></button>}
    </div>
  )
}

// ---------- Restaurant sheet ----------

/** "Share this place" inside a restaurant's sheet on the map. */
export function SharePlace({ place }: { place: Place }) {
  return (
    <button type="button" className="so-share-place" onClick={() => { track('share', { kind: 'place' }); social.share({ kind: 'place', place }) }}>
      <Icon name="share" size={18} /> Share this place
    </button>
  )
}

// ---------- Landing for visitors from Instagram ----------

/** True when this visit came through the Instagram link (`?utm_source=instagram`). */
export const fromInstagram = (): boolean => currentSource() === 'instagram'

/** The start page for someone who tapped the Instagram link. */
export function InstagramLanding({ onStart, onAsk }: { onStart: () => void; onAsk: () => void }) {
  const [first, ...rest] = taglineParts()
  return (
    <main className="screen with-cta landing so-landing">
      <div className="topbar"><Wordmark /><span className="so-beta">Free beta</span></div>
      <div className="landing-hero"><HeroArt /></div>
      <div className="landing-copy">
        <h1 className="display landing-tagline">{first}{rest.length > 0 && <><br /><em>{rest.join(' ')}</em></>}</h1>
        <p className="lead">Free while in beta. No account, no card.</p>
      </div>
      <Footer />
      <div className="cta-bar">
        <LandingActions onAsk={onAsk} onStart={() => { track('landing_start', { source: 'instagram' }); onStart() }} />
      </div>
    </main>
  )
}

// ---------- /numbers ----------

const label = (v: string | null) => (v === 'homescreen' ? 'Home screen' : v && v in PLATFORM_LABEL ? PLATFORM_LABEL[v as Platform] : v ? v[0]!.toUpperCase() + v.slice(1) : 'Other')

/** Sharing, link imports, the Premium list and where visitors came from, for the live numbers page. */
export function SocialNumbers({ data }: { data: SocialNumbersData | undefined }) {
  const stat = (text: string, v: number | undefined) => (
    <div className="card-flat stat"><b>{v == null ? '–' : n0(v)}</b><span className="small">{text}</span></div>
  )
  const list = (title: string, rows: Array<{ key: string; text: string; value: string }>) => (
    <div className="card-flat" style={{ padding: 16 }}>
      <p className="eyebrow" style={{ marginBottom: 8 }}>{title}</p>
      {rows.length === 0 ? <p className="small">None yet</p> : rows.map((r) => (
        <div key={r.key} className="row" style={{ justifyContent: 'space-between', padding: '4px 0' }}><span className="body">{r.text}</span><b className="num">{r.value}</b></div>
      ))}
    </div>
  )
  const want = (id: string | null) => PREMIUM_WANTS.find((w) => w.id === id)?.label ?? id ?? 'Other'
  return (
    <>
      <div className="section-title"><h2 className="h3">Sharing and free beta</h2></div>
      <div className="stat-grid">
        {stat('links shared', data?.shareLinks)}
        {stat('shared links opened', data?.shareOpens)}
        {stat('meals read from links', data?.imports.estimated)}
        {stat('saved from links', data?.imports.saved)}
        {stat('asked for Premium', data?.premium.signups)}
        {stat('home screen installs', data?.installs)}
      </div>
      <div className="stack-12" style={{ marginTop: 16 }}>
        {list('Visitors by link', (data?.sources ?? []).map((s) => ({ key: s.v ?? 'other', text: label(s.v), value: `${n0(s.visitors)} · ${n0(s.scanned)} scanned` })))}
        {list('Links by source', (data?.imports.byPlatform ?? []).map((r) => ({ key: r.v ?? 'other', text: label(r.v), value: n0(r.c) })))}
        {list('Would pay for', (data?.premium.wants ?? []).map((r) => ({ key: r.v ?? 'other', text: want(r.v), value: n0(r.c) })))}
      </div>
    </>
  )
}
