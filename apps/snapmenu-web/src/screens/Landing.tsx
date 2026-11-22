import { Footer, Icon, Wordmark } from '../components/ui'
import { lazy, Suspense } from 'react'
import { track } from '../lib/api'
import { VIcon } from '../voice/icons'

/** Holds the hero's space while its script loads, so the actions below never jump. */
function HeroSpace() {
  return <div className="hero-space" aria-hidden="true" />
}

// The entry actions can paint and respond while the illustration downloads.
const ScanIllustration = lazy(() => import('../components/MenuScanHero')
  .then(({ MenuScanHero }) => ({ default: MenuScanHero }))
  .catch(() => ({ default: HeroSpace })))

export function HeroArt() {
  return <Suspense fallback={<HeroSpace />}><ScanIllustration /></Suspense>
}

export function LandingActions({ onAsk, onStart }: { onAsk: () => void; onStart: () => void }) {
  return <>
    <button className="btn btn-primary" onClick={onAsk}><VIcon name="mic" size={22} /> Ask for a dish</button>
    <div className="landing-actions">
      <button className="btn btn-secondary btn-sm" onClick={onStart}><Icon name="camera" size={19} /> Scan a menu</button>
      <a className="btn btn-secondary btn-sm" href="/g" onClick={() => track('group_entry', { from: 'landing' })}><Icon name="users" size={19} /> With friends</a>
    </div>
  </>
}

export function Landing({ onAsk, onStart, onDelivery }: { onAsk: () => void; onStart: () => void; onDelivery: () => void }) {
  return (
    <main className="screen with-cta landing">
      <div className="topbar"><Wordmark /></div>
      <div className="landing-hero"><HeroArt /></div>
      <div className="landing-copy">
        <h1 className="display landing-tagline">Find a dish<br /><em>that fits you.</em></h1>
        <p className="lead">Say what you want or scan a menu.</p>
      </div>
      <button className="link-btn landing-delivery" onClick={onDelivery}><Icon name="bag" size={18} /> Healthy delivery near me</button>
      <Footer short />
      <div className="cta-bar"><LandingActions onAsk={onAsk} onStart={onStart} /></div>
    </main>
  )
}
