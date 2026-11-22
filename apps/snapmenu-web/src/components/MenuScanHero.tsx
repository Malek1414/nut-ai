import { useId, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import './menu-scan-hero.css'

const ITEMS: Array<[string, string]> = [
  ['Currywurst', '7,90'], ['Döner Teller', '11,50'], ['Hähnchenbrust Salat', '10,50'], ['Falafel Teller', '9,00'], ['Lahmacun', '4,50'], ['Käsespätzle', '12,00'],
]

/** A phone scans the menu card, then one dish lifts out with its range. Static (card only) with reduced motion. */
export function MenuScanHero() {
  const id = useId().replace(/:/g, '')
  const [paused, setPaused] = useState(false)
  const url = (name: string) => `url(#${id}-${name})`
  const menu = (lifted: boolean) => <>
    <rect width="220" height="270" rx="22" fill="#1A2B23" />
    <text x="24" y="40" fill="#F2B33D" fontFamily="var(--display)" fontWeight="800" fontSize="19" letterSpacing="-.5">SPEISEKARTE</text>
    {ITEMS.map(([n, p], i) => (
      <g key={n} className={lifted && i === 2 ? 'hero-row' : undefined} opacity={0.92}>
        <text x="24" y={76 + i * 30} fill="#EDEFE8" fontFamily="var(--text)" fontWeight="600" fontSize="13">{n}</text>
        <text x="196" y={76 + i * 30} textAnchor="end" fill="#F2B33D" fontFamily="var(--text)" fontWeight="700" fontSize="12">{p}</text>
      </g>
    ))}
  </>
  return (
    <figure className="hero-demo" data-paused={paused}>
      <svg viewBox="0 0 360 300" width="100%" role="img" aria-label="A phone scans a menu and lifts out one dish with its calorie range and protein">
        <defs>
          <filter id={`${id}-sh`} x="-40%" y="-40%" width="180%" height="200%">
            <feDropShadow dx="0" dy="14" stdDeviation="16" floodColor="#14221B" floodOpacity=".16" />
          </filter>
          <linearGradient id={`${id}-beam`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#F2B33D" stopOpacity="0" />
            <stop offset="1" stopColor="#F2B33D" stopOpacity=".4" />
          </linearGradient>
          <clipPath id={`${id}-glass`}><rect x="7" y="7" width="106" height="206" rx="16" /></clipPath>
        </defs>

        {/* menu card */}
        <g transform="translate(40 18) rotate(-4 110 135)" filter={url('sh')}>{menu(true)}</g>

        {/* phone over the card: its screen shows the same menu, closer */}
        <g className="hero-phone">
          <g transform="translate(196 30) rotate(6 60 110)" filter={url('sh')}>
            <rect width="120" height="220" rx="22" fill="#14221B" />
            <g clipPath={url('glass')}>
              <rect x="7" y="7" width="106" height="206" fill="#10201A" />
              <g transform="translate(9.5 48) scale(.46)">{menu(false)}</g>
              <path d="M12 58v-8a6 6 0 0 1 6-6h10M108 58v-8a6 6 0 0 0-6-6H92M12 162v8a6 6 0 0 0 6 6h10M108 162v8a6 6 0 0 1-6 6H92" fill="none" stroke="#F2B33D" strokeWidth="3" strokeLinecap="round" />
              <g className="hero-beam">
                <rect x="9" y="14" width="102" height="34" fill={url('beam')} />
                <rect x="9" y="47" width="102" height="2" fill="#FFD27A" />
              </g>
              <circle cx="60" cy="194" r="9" fill="none" stroke="#EDEFE8" strokeWidth="2" />
            </g>
            <rect x="44" y="12" width="32" height="7" rx="3.5" fill="#0B1410" />
          </g>
        </g>

        {/* lifted dish card */}
        <g className="hero-card">
          <g filter={url('sh')}>
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
        </g>

        {/* corner brackets */}
        <path d="M18 70V46a14 14 0 0 1 14-14h24M300 30h18a14 14 0 0 1 14 14v18" fill="none" stroke="#F2B33D" strokeWidth="5" strokeLinecap="round" />
      </svg>
      <button type="button" className="hero-toggle" aria-label={paused ? 'Play menu animation' : 'Pause menu animation'} onClick={() => setPaused(!paused)}>
        {paused ? <Play size={14} /> : <Pause size={14} />}
      </button>
    </figure>
  )
}
