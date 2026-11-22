import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import * as Lucide from 'lucide-react'
import { BRAND } from '../../../snapmenu-api/src/brand'
import type { DishEstimate, Range } from '../../../snapmenu-api/src/types'
import { dishConfidence } from '../../../snapmenu-api/src/discover/confidence'
import { ConfidencePill } from '../discover/Confidence'
import { n0 } from '../lib/format'

/** One icon family: 24px grid, 1.75 stroke, round caps and joins. */
const PATHS: Record<string, Lucide.LucideIcon> = {
  camera: Lucide.Camera, image: Lucide.Image, back: Lucide.ArrowLeft, close: Lucide.X,
  check: Lucide.Check, arrow: Lucide.ArrowRight, flame: Lucide.Flame, muscle: Lucide.Dumbbell,
  balance: Lucide.Scale, leaf: Lucide.Leaf, shield: Lucide.ShieldAlert, globe: Lucide.Globe,
  share: Lucide.Share2, copy: Lucide.Copy, speaker: Lucide.Volume2, info: Lucide.Info,
  alert: Lucide.TriangleAlert, minus: Lucide.Minus, plus: Lucide.Plus, spark: Lucide.Utensils,
  thumbDown: Lucide.ThumbsDown, sun: Lucide.Sun, focus: Lucide.ScanLine, wifiOff: Lucide.WifiOff,
  key: Lucide.KeyRound, receipt: Lucide.ReceiptText, database: Lucide.Database, chart: Lucide.ChartNoAxesColumn,
  edit: Lucide.Pencil, chevron: Lucide.ChevronRight, chevronDown: Lucide.ChevronDown,
  download: Lucide.Download, map: Lucide.Map, pin: Lucide.MapPin, locate: Lucide.LocateFixed,
  city: Lucide.Building2, euro: Lucide.Euro, bolt: Lucide.Zap, search: Lucide.Search,
  users: Lucide.UsersRound, user: Lucide.UserRound, navigate: Lucide.Navigation,
  refresh: Lucide.RefreshCw, up: Lucide.ArrowUp, down: Lucide.ArrowDown,
  comment: Lucide.MessageCircle, bookmark: Lucide.Bookmark, more: Lucide.Ellipsis,
  flag: Lucide.Flag, trash: Lucide.Trash2, reply: Lucide.Reply, send: Lucide.Send,
  pencil: Lucide.Pencil, bag: Lucide.ShoppingBag, external: Lucide.ExternalLink,
}

export function Icon({ name, size = 20, strokeWidth = 1.75, className }: { name: keyof typeof PATHS | string; size?: number; strokeWidth?: number; className?: string }) {
  const Glyph = PATHS[name]
  return Glyph ? <Glyph className={className} size={size} strokeWidth={strokeWidth} aria-hidden="true" /> : null
}

export function Logo({ size = 28 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
    <rect width="48" height="48" rx="12" fill="var(--basil)" />
    <path d="M15 12h18v24H15V12Z" fill="var(--on-fill)" />
    <path d="M20 19h8m-8 5h8m-8 5h5" stroke="var(--basil)" strokeWidth="2" strokeLinecap="round" />
    <path d="M10 17v-5a2 2 0 0 1 2-2h5m14 0h5a2 2 0 0 1 2 2v5M10 31v5a2 2 0 0 0 2 2h5m14 0h5a2 2 0 0 0 2-2v-5" stroke="var(--on-fill)" strokeWidth="2" strokeLinecap="round" />
  </svg>
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
        {tier && <ConfidencePill value={dishConfidence({ bandTier: tier })} />}
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

export function Footer({ short = false }: { short?: boolean } = {}) {
  return (
    <footer className="footer">
      <span>
        Built on <a href="https://github.com/Blueturboguy07/nut-ai" target="_blank" rel="noreferrer">Nut AI</a> by Mann Bellani · AGPL-3.0 · <a href="https://github.com/Malek1414/nut-ai/tree/snapmenu" target="_blank" rel="noreferrer">Source</a>
      </span>
      {!short && <span>Estimates, not medical advice. Confirm allergens with the restaurant.</span>}
    </footer>
  )
}

/** Bottom sheet over the page. Closes on backdrop tap and Escape. */
export function Sheet({ label, onClose, children, className }: { label: string; onClose: () => void; children: ReactNode; className?: string }) {
  const panel = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const node = panel.current
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (node && !node.contains(previous)) node.focus({ preventScroll: true })
    function onKey(e: KeyboardEvent) {
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]')
      if (!node || dialogs[dialogs.length - 1] !== node) return
      if (e.key === 'Escape') { e.preventDefault(); close.current(); return }
      if (e.key !== 'Tab') return
      const stops = [...node.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]')].filter((el) => el.tabIndex >= 0 && el.getClientRects().length > 0 && !el.closest('[inert]'))
      const next = e.shiftKey ? stops.at(-1) : stops[0]
      if (!stops.length || document.activeElement === (e.shiftKey ? stops[0] : stops.at(-1)) || (e.shiftKey && document.activeElement === node) || !node.contains(document.activeElement)) { e.preventDefault(); (next ?? node).focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); if (previous?.isConnected && !node?.contains(previous)) previous.focus({ preventScroll: true }) }
  }, [])
  return createPortal(
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div ref={panel} tabIndex={-1} className={`sheet ${className ?? ''}`} role="dialog" aria-modal="true" aria-label={label}>
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
