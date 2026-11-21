import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { BRAND } from '../../../snapmenu-api/src/brand'
import type { DishEstimate, Range } from '../../../snapmenu-api/src/types'
import { n0 } from '../lib/format'

/** One icon family: 24px grid, 1.75 stroke, round caps and joins. */
const PATHS: Record<string, ReactNode> = {
  camera: <><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.4l1.3-1.8A1.5 1.5 0 0 1 10.4 3.5h3.2a1.5 1.5 0 0 1 1.2.7L16.1 6h1.4A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z" /><circle cx="12" cy="12.5" r="3.5" /></>,
  image: <><rect x="3.5" y="4.5" width="17" height="15" rx="3" /><circle cx="9" cy="10" r="1.75" /><path d="m20.5 16-4.6-4.6a1.5 1.5 0 0 0-2.1 0L5 19.5" /></>,
  back: <path d="M15 5l-7 7 7 7" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
  flame: <path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.3 2.4-5.2 3.6-7.6.5 1.6 1.4 2.6 2.4 3 .3-2.9 1.6-5.4 3.7-7.2.2 3.4 3.3 5.6 3.3 10.3C18.5 18.1 15.9 21 12 21Z" />,
  muscle: <><path d="M5 18c0-6 2-11 6-13l2 2-2 2.5 1.5 1.5C15 9 18 10.5 19 14c-3 4-9 5-14 4Z" /><path d="M11 13c1.2-.4 2.4-.3 3.5.4" /></>,
  balance: <><path d="M12 4v16M7 20h10M5 8h14" /><path d="m5 8-2.5 6a3 3 0 0 0 5 0Zm14 0-2.5 6a3 3 0 0 0 5 0Z" /></>,
  leaf: <><path d="M5 19c0-8.5 5.5-14 15-14 0 9.5-5.5 15-14 15" /><path d="M5 19 13 11" /></>,
  shield: <><path d="M12 3.5 19 6v5.5c0 4.4-3 7.7-7 9-4-1.3-7-4.6-7-9V6Z" /><path d="M12 8.5v4m0 3v.01" /></>,
  globe: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.2 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.2-3.5-8.5S9.6 5.9 12 3.5Z" /></>,
  share: <><path d="M12 15V4m0 0L8 8m4-4 4 4" /><path d="M7 11H6a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5a2 2 0 0 0-2-2h-1" /></>,
  copy: <><rect x="8.5" y="8.5" width="11" height="11" rx="2.5" /><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" /></>,
  speaker: <><path d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3Z" /><path d="M15.5 9a4 4 0 0 1 0 6m2.5-8.5a7.5 7.5 0 0 1 0 11" /></>,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5m0-8v.01" /></>,
  alert: <><path d="M10.3 4.3 3 17a2 2 0 0 0 1.7 3h14.6a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z" /><path d="M12 9.5v4m0 3v.01" /></>,
  minus: <path d="M6 12h12" />,
  plus: <path d="M12 6v12M6 12h12" />,
  spark: <path d="M12 3.5 13.8 9a2 2 0 0 0 1.2 1.2l5.5 1.8-5.5 1.8a2 2 0 0 0-1.2 1.2L12 20.5 10.2 15A2 2 0 0 0 9 13.8L3.5 12 9 10.2A2 2 0 0 0 10.2 9Z" />,
  thumbDown: <><path d="M7.5 13.5V4.5" /><path d="M7.5 13.5 11 20a2 2 0 0 0 2.5-2l-.5-3.5h4.6a2 2 0 0 0 2-2.3l-1.2-6.5a2 2 0 0 0-2-1.7H7.5" /><path d="M4.5 4.5h3v9h-3z" /></>,
  sun: <><circle cx="12" cy="12" r="3.5" /><path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6l1.4 1.4m10 10 1.4 1.4m0-12.8L17 7m-10 10-1.4 1.4" /></>,
  focus: <><path d="M4 8V6.5A2.5 2.5 0 0 1 6.5 4H8m8 0h1.5A2.5 2.5 0 0 1 20 6.5V8m0 8v1.5a2.5 2.5 0 0 1-2.5 2.5H16m-8 0H6.5A2.5 2.5 0 0 1 4 17.5V16" /><path d="M8 10h8M8 14h5" /></>,
  wifiOff: <><path d="M3 3l18 18" /><path d="M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5-2.7m4 0A10 10 0 0 1 19 13M2 9.5a15 15 0 0 1 4.2-2.6m4-.9A15 15 0 0 1 22 9.5" /><path d="M12 20v.01" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="m11 12 8-8m-3 3 2 2m-4 0 1.5 1.5" /></>,
  receipt: <><path d="M6 3.5h12v17l-3-2-3 2-3-2-3 2Z" /><path d="M9 8h6m-6 4h6" /></>,
  database: <><ellipse cx="12" cy="6" rx="7" ry="2.5" /><path d="M5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" /></>,
  chart: <path d="M4 20V10m6 10V4m6 16v-7m4 7H3" />,
  edit: <><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16Z" /><path d="m13.5 6.5 4 4" /></>,
  chevron: <path d="m9 6 6 6-6 6" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  download: <><path d="M12 4v11m0 0-4-4m4 4 4-4" /><path d="M5 19h14" /></>,
  map: <><path d="M9 4.5 3.5 6.5v13L9 17.5l6 2 5.5-2v-13L15 6.5Z" /><path d="M9 4.5v13m6-11v13" /></>,
  pin: <><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" /><circle cx="12" cy="10" r="2.5" /></>,
  locate: <><circle cx="12" cy="12" r="6.5" /><circle cx="12" cy="12" r="2" /><path d="M12 2.5v3m0 13v3M2.5 12h3m13 0h3" /></>,
  city: <><path d="M4 20.5V9.5l5-3v14m0 0V4.5l6 2.5v13.5m0 0v-9l5 2v7" /><path d="M3 20.5h18" /></>,
  euro: <><path d="M17 6.5A6.5 6.5 0 1 0 17 17.5" /><path d="M5 10.5h8m-8 3h8" /></>,
  bolt: <path d="M13 3 5.5 13.5H12L11 21l7.5-10.5H12Z" />,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.4-4.4" /></>,
  users: <><circle cx="9" cy="8.5" r="3.5" /><path d="M2.5 19.5c.6-3.3 3.2-5.5 6.5-5.5s5.9 2.2 6.5 5.5" /><path d="M15.5 5.2a3.5 3.5 0 0 1 0 6.6M17.8 14.4c2 .8 3.3 2.6 3.7 5.1" /></>,
  user: <><circle cx="12" cy="8.5" r="4" /><path d="M4.5 20.5c.8-3.9 3.7-6.5 7.5-6.5s6.7 2.6 7.5 6.5" /></>,
  navigate: <path d="m4 11 16-7-7 16-2-7Z" />,
  refresh: <><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" /><path d="M19.5 4.5v4h-4" /></>,
  up: <path d="M12 4.5 5 12.5h4.2v7h5.6v-7H19Z" />,
  down: <path d="M12 19.5 19 11.5h-4.2v-7H9.2v7H5Z" />,
  comment: <path d="M20 11.5c0 4.1-3.6 7.5-8 7.5-1.2 0-2.3-.2-3.3-.6L4 20l1.3-3.7A7.2 7.2 0 0 1 4 11.5C4 7.4 7.6 4 12 4s8 3.4 8 7.5Z" />,
  bookmark: <path d="M6.5 4.5h11v16L12 16.5l-5.5 4Z" />,
  more: <><circle cx="5.5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="18.5" cy="12" r="1.2" /></>,
  flag: <><path d="M5.5 21V4.5" /><path d="M5.5 5h11l-2 4 2 4h-11" /></>,
  trash: <><path d="M4.5 7h15M9.5 7V4.5h5V7m-8 0 .8 12.5h9.4L17.5 7" /></>,
  reply: <><path d="M10 6 4.5 11 10 16" /><path d="M4.5 11H14a5.5 5.5 0 0 1 5.5 5.5V19" /></>,
  send: <><path d="m4 12 16-7.5L13.5 20l-2.5-6.5Z" /><path d="m11 13.5 9-9" /></>,
  pencil: <><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16Z" /></>,
  bag: <><path d="M5.5 8.5h13l-1 11a1.5 1.5 0 0 1-1.5 1.4H8a1.5 1.5 0 0 1-1.5-1.4Z" /><path d="M9 8.5V7a3 3 0 0 1 6 0v1.5" /><path d="M9.5 13.5c.6 1 1.5 1.5 2.5 1.5s1.9-.5 2.5-1.5" /></>,
  external: <><path d="M13.5 4.5h6v6" /><path d="m19.5 4.5-8 8" /><path d="M17.5 13.5v4a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h4" /></>,
}

export function Icon({ name, size = 20, strokeWidth = 1.75, className }: { name: keyof typeof PATHS | string; size?: number; strokeWidth?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name] ?? null}
    </svg>
  )
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true">
      <rect width="512" height="512" rx="116" fill="#1E6B4E" />
      <rect x="146" y="112" width="220" height="288" rx="26" fill="#F3F5EF" />
      <rect x="178" y="158" width="120" height="16" rx="8" fill="#1E6B4E" opacity=".35" />
      <rect x="178" y="196" width="156" height="16" rx="8" fill="#1E6B4E" opacity=".35" />
      <rect x="178" y="310" width="140" height="16" rx="8" fill="#1E6B4E" opacity=".35" />
      <rect x="118" y="252" width="276" height="22" rx="11" fill="#F2B33D" />
      <path d="M118 150v-38a26 26 0 0 1 26-26h38M394 150v-38a26 26 0 0 0-26-26h-38M118 362v38a26 26 0 0 0 26 26h38M394 362v38a26 26 0 0 1-26 26h-38" fill="none" stroke="#F2B33D" strokeWidth="22" strokeLinecap="round" />
    </svg>
  )
}

export function Wordmark({ onClick }: { onClick?: () => void }) {
  return (
    <a className="wordmark" href="/" onClick={(e) => { if (onClick) { e.preventDefault(); onClick() } }} aria-label={`${BRAND.name} home`}>
      <Logo />
      <span>{BRAND.wordmark[0]}<span style={{ color: 'var(--basil)' }}>{BRAND.wordmark[1]}</span></span>
    </a>
  )
}

/** The signature element: calories as a band on a 0-1500 kcal track, never one point. */
export function RangeBar({ range, label = 'kcal', max = 1500, tier }: { range: Range; label?: string; max?: number; tier?: string }) {
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`
  return (
    <div className="range">
      <div className="range-top">
        <div className="range-value">
          {n0(range.low)}–{n0(range.high)}
          <small>{label}</small>
        </div>
        {tier && <span className="conf" title="How wide the range is">{tierLabel(tier)}</span>}
      </div>
      <div className="range-track" role="img" aria-label={`${n0(range.low)} to ${n0(range.high)} ${label}, most likely about ${n0(range.mid)}`}>
        <div className="range-band" style={{ left: pct(range.low), width: `calc(${pct(range.high)} - ${pct(range.low)})` }} />
        <div className="range-mid" style={{ left: pct(range.mid) }} />
      </div>
      <div className="range-scale" aria-hidden="true">
        <span>0</span><span>{n0(max / 2)}</span><span>{n0(max)} kcal</span>
      </div>
    </div>
  )
}

/** The band alone: no numbers, no scale. For cards where the range is already printed large. */
export function RangeTrack({ range, max = 1500 }: { range: Range; max?: number }) {
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`
  return (
    <div className="range-track range-track--slim" role="img" aria-label={`${n0(range.low)} to ${n0(range.high)} kcal, most likely about ${n0(range.mid)}`}>
      <div className="range-band" style={{ left: pct(range.low), width: `calc(${pct(range.high)} - ${pct(range.low)})` }} />
      <div className="range-mid" style={{ left: pct(range.mid) }} />
    </div>
  )
}

export function tierLabel(tier: string): string {
  switch (tier) {
    case 'none':
    case 'tight': return '± tight'
    case 'moderate': return '± moderate'
    case 'wide': return '± wide'
    default: return '± rough'
  }
}

export function Macros({ d }: { d: Pick<DishEstimate, 'protein' | 'carbs' | 'fat'> }) {
  // Bars show each macro's share of the dish's energy.
  const pk = d.protein.mid * 4, ck = d.carbs.mid * 4, fk = d.fat.mid * 9
  const tot = Math.max(1, pk + ck + fk)
  const cell = (cls: string, label: string, v: number, share: number) => (
    <div className={`macro ${cls}`}>
      <div className="m-label"><span>{label}</span><span>{Math.round(share * 100)}%</span></div>
      <div className="m-val">{n0(v)}<small>g</small></div>
      <div className="m-bar"><i style={{ width: `${Math.round(share * 100)}%` }} /></div>
    </div>
  )
  return (
    <div className="macros">
      {cell('p', 'Protein', d.protein.mid, pk / tot)}
      {cell('c', 'Carbs', d.carbs.mid, ck / tot)}
      {cell('f', 'Fat', d.fat.mid, fk / tot)}
    </div>
  )
}

export function Footer() {
  return (
    <footer className="footer">
      <span>
        Built on <a href="https://github.com/Blueturboguy07/nut-ai" target="_blank" rel="noreferrer">Nut AI</a> by Mann Bellani · AGPL-3.0 · <a href="https://github.com/Malek1414/nut-ai/tree/snapmenu" target="_blank" rel="noreferrer">Source</a>
      </span>
      <span>Estimates, not medical advice. Confirm allergens with the restaurant.</span>
    </footer>
  )
}

/** Bottom sheet over the page. Closes on backdrop tap and Escape. */
export function Sheet({ label, onClose, children, className }: { label: string; onClose: () => void; children: ReactNode; className?: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className={`sheet ${className ?? ''}`} role="dialog" aria-modal="true" aria-label={label}>
        <div className="grab" />
        {children}
      </div>
    </>,
    document.body,
  )
}

/** A collapsed section: one row that opens its content. Details stay behind a tap. */
export function Fold({ title, count, badge, defaultOpen = false, children }: { title: string; count?: number | string; badge?: ReactNode; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="card-flat fold" data-open={open}>
      <button type="button" className="fold__head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span>{title}</span>
        {count != null && <span className="fold__count num">{count}</span>}
        {badge}
        <span className="spacer" />
        <Icon name="chevronDown" size={20} className="fold__chev" />
      </button>
      {open && <div className="fold__body">{children}</div>}
    </section>
  )
}

export function Toast({ text }: { text: string | null }) {
  if (!text) return null
  return <div className="toast" role="status">{text}</div>
}
