import { Footer, Icon, Wordmark } from '../components/ui'
import { lazy, Suspense } from 'react'
import { track } from '../lib/api'
import { VIcon } from '../voice/icons'

function MenuPreview() {
  return <div className="menu-preview" aria-hidden="true"><span>Mittagstisch</span></div>
}

// The entry actions can paint and respond while the illustration downloads.
const ScanIllustration = lazy(() => import('../components/MenuScanHero')
  .then(({ MenuScanHero }) => ({ default: MenuScanHero }))
  .catch(() => ({ default: MenuPreview })))

export function HeroArt() {
  return <Suspense fallback={<MenuPreview />}><ScanIllustration /></Suspense>
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
  return <main className="screen landing">
    <div className="topbar"><Wordmark /></div>
    <header className="landing-copy">
      <h1 className="display landing-tagline">What’s on the menu?</h1>
      <p className="lead">A meal that fits you, wherever you eat.</p>
    </header>
    <HeroArt />
    <div className="landing-entries">
      <button onClick={onStart}><span className="landing-entry-icon"><Icon name="camera" size={23} /></span><span><b>Scan a menu</b><small>Translate it. Find your best order.</small></span><Icon name="chevron" size={20} /></button>
      <button onClick={onAsk}><span className="landing-entry-icon"><Icon name="pin" size={23} /></span><span><b>Find a dish nearby</b><small>Tell us what you’re in the mood for.</small></span><Icon name="chevron" size={20} /></button>
      <a href="/g" onClick={() => track('group_entry', { from: 'landing' })}><span className="landing-entry-icon"><Icon name="users" size={23} /></span><span><b>Eat with friends</b><small>Find something for everyone.</small></span><Icon name="chevron" size={20} /></a>
    </div>
    <button className="link-btn landing-delivery" onClick={onDelivery}><Icon name="bag" size={18} /> Healthy delivery near me <Icon name="arrow" size={16} /></button>
    <Footer short />
  </main>
}
