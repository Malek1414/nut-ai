import { useId, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import './menu-scan-hero.css'

const dishes = [
  ['Hähnchen Bowl', '14,50', 'Zitronenhuhn, Dinkel & Kräuter'],
  ['Linsensalat', '12,80', 'Berglinsen, Rote Bete & Feta'],
  ['Pilzrisotto', '15,20', 'Waldpilze, Parmesan & Thymian'],
]

/** The camera and the paper share one typeset menu, including the prices. */
export function MenuScanHero() {
  const id = useId()
  const [paused, setPaused] = useState(false)
  const ref = (name: string) => `url(#${id}-${name})`
  return <figure className="scan-demo" data-paused={paused}>
    <svg viewBox="0 0 400 244" role="img" aria-label="A phone scans a German lunch menu and lifts out two example dishes with calorie ranges and protein." preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id={id + '-table'} x2="1" y2="1" gradientUnits="objectBoundingBox">
          <stop stopColor="#c3b39b" /><stop offset=".48" stopColor="#e5d9c6" /><stop offset="1" stopColor="#bdaa90" />
        </linearGradient>
        <linearGradient id={id + '-paper'} x2=".86" y2=".9">
          <stop stopColor="#fff9e8" /><stop offset=".58" stopColor="#f7efda" /><stop offset="1" stopColor="#e6d8b9" />
        </linearGradient>
        <linearGradient id={id + '-steel'} x2="1" y2=".8">
          <stop stopColor="#ede8dc" /><stop offset=".16" stopColor="#514f48" /><stop offset=".5" stopColor="#252622" /><stop offset=".77" stopColor="#abaea2" /><stop offset="1" stopColor="#4d4c45" />
        </linearGradient>
        <pattern id={id + '-cloth'} width="5" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(12)">
          <path d="M0 0h5 M0 2h5" stroke="#5c5749" strokeOpacity=".19" strokeWidth=".55" />
          <path d="M1 0v4 M4 0v4" stroke="#fff" strokeOpacity=".38" strokeWidth=".6" />
        </pattern>
        <pattern id={id + '-grain'} width="17" height="13" patternUnits="userSpaceOnUse">
          <path d="M2 4h1.1m7 5h1.6m3-7h.8M4 11h.7" stroke="#856d48" strokeOpacity=".23" strokeWidth=".65" />
        </pattern>
        <filter id={id + '-shadow'} x="-35%" y="-35%" width="190%" height="190%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
        <clipPath id={id + '-glass'}><rect x="5" y="5" width="105" height="195" rx="15" /></clipPath>
        <g id={id + '-menu'}>
          <rect width="218" height="283" fill={ref('paper')} />
          <rect width="218" height="283" fill={ref('grain')} />
          <rect x="9" y="9" width="200" height="265" fill="none" stroke="#767450" strokeWidth=".65" />
          <g fill="#374b34" textAnchor="middle" fontFamily="Georgia, serif">
            <path d="M96 25q11-10 25-10q-10 3-23 12m5-6q-3-10 5-10q2 5-5 10m6-4q3-10 11-8q-2 6-11 8m-2 3q9-4 15 1q-8 5-15-1" />
            <text x="109" y="43" fontSize="10" letterSpacing="2.1">GASTHAUS LINDEN</text>
            <text x="109" y="78" fontSize="32" fontStyle="italic">Mittagstisch</text>
          </g>
          <path d="M21 91h176m-176 3h176" stroke="#78785f" strokeWidth=".65" />
          {dishes.map(([name, price, note], i) => <g key={name} transform={`translate(21 ${118 + i * 43})`} fill="#302e22" fontFamily="Georgia, serif">
            <text fontSize="16">{name}</text><text x="176" textAnchor="end" fontSize="13">{price} €</text>
            <text y="15" fontSize="9.4" fontStyle="italic">{note}</text>
          </g>)}
          <path d="M21 231h176" stroke="#99927c" strokeWidth=".7" />
          <text x="109" y="251" fill="#5b5947" fontFamily="Georgia, serif" fontSize="10" textAnchor="middle">Montag bis Freitag · 12–15 Uhr</text>
        </g>
      </defs>
      <rect width="400" height="244" fill={ref('table')} />
      <rect width="400" height="244" fill={ref('cloth')} />
      <g transform="translate(42 -15) rotate(-9 109 140)">
        <rect x="4" y="7" width="218" height="283" fill="#4d402e" opacity=".37" filter={ref('shadow')} />
        <use href={'#' + id + '-menu'} />
      </g>
      <g className="demo-phone"><g transform="translate(229 16) rotate(10 57 103)">
        <rect x="7" y="10" width="115" height="205" rx="21" fill="#302a20" opacity=".49" filter={ref('shadow')} />
        <rect x="-1" y="40" width="3" height="22" rx="1" fill="#56544b" />
        <rect width="115" height="205" rx="20" fill={ref('steel')} stroke="#54564e" strokeWidth=".7" />
        <rect x="2.3" y="2.3" width="110.4" height="200.4" rx="18" fill="#111411" />
        <g clipPath={ref('glass')}>
          <rect x="5" y="5" width="105" height="195" fill="#242923" />
          <svg x="5" y="33" width="105" height="130" viewBox="9 42 147 180" preserveAspectRatio="xMidYMid slice">
            <use href={'#' + id + '-menu'} />
          </svg>
          <path d="M13 69v-9h9m70 0h10v9m0 69v9h-10m-70 0h-9v-9" stroke="#527449" strokeWidth="2" fill="none" />
          <g className="demo-beam"><path d="M13 64h89" stroke="#486c39" strokeWidth="2" /><path d="M13 62h89" stroke="white" strokeOpacity=".85" /></g>
          <circle cx="57" cy="180" r="11.5" fill="none" stroke="#dddcd6" /><circle cx="57" cy="180" r="9" fill="#f9f8ed" />
        </g>
        <rect x="40" y="10" width="36" height="9" rx="5" fill="#0b0d0b" /><circle cx="70" cy="14.5" r="2" fill="#2b3c3d" />
      </g></g>
      {[['Hähnchen Bowl', '520–610 kcal · 42 g protein'], ['Linsensalat', '390–470 kcal · 21 g protein']].map(([name, detail], i) =>
        <g key={name} transform={`translate(${i ? 45 : 25} ${i ? 184 : 127})`}>
          <g className={i ? 'demo-pick demo-pick--second' : 'demo-pick'}>
            <rect x="1" y="3" width="178" height="48" rx="11" fill="#463e30" opacity=".26" filter={ref('shadow')} />
            <rect width="178" height="48" rx="11" fill="#fffff8" stroke="#babca7" strokeWidth=".7" />
            <circle cx="17" cy="17" r="7.8" fill="#476036" /><path d="m13.6 17 2.4 2.3 4.2-4.8" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <text x="31" y="21" fontSize="14" fontWeight="650" fill="#263322">{name}</text>
            <text x="12" y="38" fontSize="11.7" fill="#475140">{detail}</text>
          </g>
        </g>)}
    </svg>
    <button type="button" className="demo-toggle" aria-label={paused ? 'Play menu animation' : 'Pause menu animation'} onClick={() => setPaused(!paused)}>
      {paused ? <Play size={14} /> : <Pause size={14} />}
    </button>
  </figure>
}
