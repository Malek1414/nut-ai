import { Footer, Icon, Wordmark } from '../components/ui'
import { track } from '../lib/api'
import { VIcon } from '../voice/icons'

/** The hero shows the product itself: a menu being read, one dish lifted out with its range. */
export function HeroArt() {
  return (
    <svg viewBox="0 0 360 300" width="100%" role="img" aria-label="A menu with one dish highlighted and its calorie range">
      <defs>
        <linearGradient id="hg-scan" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#F2B33D" stopOpacity="0" />
          <stop offset="1" stopColor="#F2B33D" stopOpacity=".35" />
        </linearGradient>
        <clipPath id="hg-clip"><rect x="40" y="18" width="220" height="270" rx="22" /></clipPath>
        <filter id="hg-sh" x="-40%" y="-40%" width="180%" height="200%">
          <feDropShadow dx="0" dy="14" stdDeviation="16" floodColor="#14221B" floodOpacity=".16" />
        </filter>
      </defs>
      {/* menu card */}
      <g transform="rotate(-4 150 150)" filter="url(#hg-sh)">
        <rect x="40" y="18" width="220" height="270" rx="22" fill="#1A2B23" />
        <text x="64" y="58" fill="#F2B33D" fontFamily="var(--display)" fontWeight="800" fontSize="19" letterSpacing="-.5">SPEISEKARTE</text>
        {[
          ['Currywurst', '7,90'], ['Döner Teller', '11,50'], ['Hähnchenbrust Salat', '10,50'], ['Falafel Teller', '9,00'], ['Lahmacun', '4,50'], ['Käsespätzle', '12,00'],
        ].map(([n, p], i) => (
          <g key={n} opacity={i === 2 ? 0 : 0.92}>
            <text x="64" y={94 + i * 30} fill="#EDEFE8" fontFamily="var(--text)" fontWeight="600" fontSize="13">{n}</text>
            <text x="236" y={94 + i * 30} textAnchor="end" fill="#F2B33D" fontFamily="var(--text)" fontWeight="700" fontSize="12">{p}</text>
          </g>
        ))}
        <g clipPath="url(#hg-clip)"><g className="hero-scan">
          <rect x="40" y="0" width="220" height="44" fill="url(#hg-scan)" />
          <rect x="40" y="43" width="220" height="2" fill="#FFD27A" />
        </g></g>
      </g>
      {/* lifted dish card */}
      <g filter="url(#hg-sh)">
        <rect x="132" y="126" width="216" height="120" rx="22" fill="#fff" />
        <rect x="148" y="142" width="24" height="24" rx="8" fill="#F2B33D" />
        <text x="160" y="159" textAnchor="middle" fill="#3A2604" fontFamily="var(--display)" fontWeight="800" fontSize="13">1</text>
        <text x="182" y="153" fill="#14221B" fontFamily="var(--display)" fontWeight="700" fontSize="14" letterSpacing="-.3">Hähnchenbrust Salat</text>
        <text x="182" y="168" fill="#6B776F" fontFamily="var(--text)" fontSize="10.5">Grilled chicken salad</text>
        <text x="148" y="200" fill="#14221B" fontFamily="var(--display)" fontWeight="800" fontSize="22" letterSpacing="-.6">290–520</text>
        <text x="246" y="200" fill="#6B776F" fontFamily="var(--text)" fontWeight="600" fontSize="11">kcal</text>
        <rect x="148" y="212" width="184" height="8" rx="4" fill="#E7EBE1" />
        <rect x="183" y="212" width="56" height="8" rx="4" fill="#6553CF" />
        <rect x="208" y="208" width="3" height="16" rx="1.5" fill="#14221B" />
        <rect x="270" y="186" width="62" height="20" rx="10" fill="#E5EBFB" />
        <text x="301" y="200" textAnchor="middle" fill="#22408F" fontFamily="var(--text)" fontWeight="700" fontSize="10.5">43 g protein</text>
      </g>
      {/* corner brackets */}
      <path d="M18 70V46a14 14 0 0 1 14-14h24M300 30h18a14 14 0 0 1 14 14v18" fill="none" stroke="#F2B33D" strokeWidth="5" strokeLinecap="round" />
    </svg>
  )
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
      <Footer />
      <div className="cta-bar"><LandingActions onAsk={onAsk} onStart={onStart} /></div>
    </main>
  )
}
