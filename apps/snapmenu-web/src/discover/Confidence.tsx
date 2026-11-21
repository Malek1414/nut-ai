// The one data-confidence indicator: three bars and a word (High, Medium, Low). A tap says why.
// The same pill sits on scanned dishes, community dishes, opening hours, delivery and the seed-oil status;
// the levels come from apps/snapmenu-api/src/discover/confidence.ts.
import { useEffect, useId, useRef, useState } from 'react'
import { CONFIDENCE_WORD, confidenceLabel, type Confidence } from '../../../snapmenu-api/src/discover/confidence'
import './confidence.css'

export type { Confidence }

function Bars({ level }: { level: Confidence['level'] }) {
  const on = level === 'high' ? 3 : level === 'medium' ? 2 : 1
  return (
    <svg className="cf__bars" width="14" height="12" viewBox="0 0 14 12" aria-hidden="true">
      {[0, 1, 2].map((i) => <rect key={i} x={i * 5} y={8 - i * 4} width="4" height={4 + i * 4} rx="1.2" opacity={i < on ? 1 : 0.28} />)}
    </svg>
  )
}

/**
 * `size="sm"` shows the word alone ("Low") for tight rows; the default spells it out ("Low confidence").
 * Renders nothing without a value: no data is not low confidence.
 */
export function ConfidencePill({ value, size = 'md', align = 'right' }: { value: Confidence | null | undefined; size?: 'sm' | 'md'; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  const id = useId()

  useEffect(() => {
    if (!open) return
    const away = (e: Event) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', away)
    window.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', away); window.removeEventListener('keydown', onKey) }
  }, [open])

  if (!value) return null
  const label = confidenceLabel(value)
  return (
    <span className="cf-wrap" ref={ref}>
      <button
        type="button"
        className={`cf cf--${value.level} cf--${size}`}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={`${label}. Why?`}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}
      >
        <Bars level={value.level} />
        <span>{size === 'sm' ? CONFIDENCE_WORD[value.level] : label}</span>
      </button>
      {open && (
        <span id={id} className={`cf-pop cf-pop--${align}`} role="status">
          <b>{label}</b>
          {value.why.map((w) => <span key={w}>{w}</span>)}
        </span>
      )}
    </span>
  )
}
