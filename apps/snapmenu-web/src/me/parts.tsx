// Pieces the "Me" screens share: a few extra icons, a dish row, the sheet for one dish, and the picker
// that adds a dish by tapping one you scanned or saved, or by typing it.
import { Component, useState, type FormEvent, type ReactNode } from 'react'
import * as Lucide from 'lucide-react'
import type { Profile } from '../../../snapmenu-api/src/types'
import type { DishSnap, Nutrition } from '../../../snapmenu-api/src/me/types'
import { Icon, RangeTrack, Sheet } from '../components/ui'
import { ApiError } from '../lib/api'
import { kcalRange, n0 } from '../lib/format'
import { estimateTyped } from './api'
import { me, useMe } from './store'

const GLYPHS: Record<string, Lucide.LucideIcon> = { heart: Lucide.Heart, target: Lucide.Target, layers: Lucide.Layers, sliders: Lucide.SlidersHorizontal }

/**
 * The app has no error boundary of its own, so an error thrown while drawing
 * would blank every screen. The Me pieces sit inside this one: if one of them
 * fails, it shows `fallback` (nothing by default) and the rest of the app goes on.
 */
export class Safe extends Component<{ children: ReactNode; fallback?: ReactNode }, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  override render() { return this.state.failed ? this.props.fallback ?? null : this.props.children }
}

/** Extra icons in the app's own family: 24px grid, 1.75 stroke, round caps. */
export function MeIcon({ name, size = 20, filled = false }: { name: keyof typeof GLYPHS | string; size?: number; filled?: boolean }) {
  const Glyph = GLYPHS[name]
  return Glyph ? <Glyph size={size} strokeWidth={1.75} fill={filled ? 'currentColor' : 'none'} aria-hidden="true" /> : null
}

/** "38–52" for a macro, or one number when the range has no width. */
export const gramRange = (r: { low: number; high: number }) => (r.low === r.high ? n0(r.low) : `${n0(r.low)}–${n0(r.high)}`)

/** Where a dish is from, in a few words. */
export const whereOf = (d: DishSnap): string => d.place ?? (d.from === 'typed' ? 'Typed' : d.from === 'meal' ? 'Meal' : '')

/** One dish in a list: name, where, calorie range, protein. `end` replaces the chevron. */
export function SnapRow({ dish, onClick, end, sub }: { dish: DishSnap; onClick: () => void; end?: ReactNode; sub?: ReactNode }) {
  return (
    <button type="button" className="dish-row" onClick={onClick}>
      <span className="dish-row__text">
        <b>{dish.name}</b>
        <span className="small">{sub ?? dish.translated ?? whereOf(dish)}</span>
      </span>
      <span className="dish-row__nums">
        <span className="dr-k">{kcalRange(dish.kcal)}</span>
        <span className="small">{n0(dish.protein.mid)} g protein</span>
      </span>
      {end ?? <Icon name="chevron" size={18} />}
    </button>
  )
}

/** Calories as a big range with the three macros as ranges under it. */
export function Totals({ n, max = 1500 }: { n: Nutrition; max?: number }) {
  const cell = (cls: string, label: string, r: { low: number; high: number }) => (
    <div className={`macro ${cls}`}>
      <div className="m-label"><span>{label}</span></div>
      <div className="m-val">{gramRange(r)}<small>g</small></div>
    </div>
  )
  return (
    <div className="me-totals">
      <div className="big"><b>{kcalRange(n.kcal)}</b><span>kcal</span></div>
      <RangeTrack range={n.kcal} max={Math.max(max, Math.ceil(n.kcal.high / 500) * 500)} />
      <div className="macros">
        {cell('p', 'Protein', n.protein)}
        {cell('c', 'Carbs', n.carbs)}
        {cell('f', 'Fat', n.fat)}
      </div>
    </div>
  )
}

/** One dish: its numbers, and the three things to do with it. */
export function DishSheet({ dish, onClose, toast, onMap, onRemove, extra }: {
  dish: DishSnap
  onClose: () => void
  toast: (t: string) => void
  /** For a dish at a restaurant nearby. */
  onMap?: (() => void) | undefined
  /** For a saved meal: remove it. */
  onRemove?: (() => void) | undefined
  extra?: ReactNode
}) {
  const s = useMe()
  const saved = s.favorites.some((f) => f.key === dish.key)
  const isMeal = dish.from === 'meal'
  return (
    <Sheet label={dish.name} onClose={onClose} className="me-sheet">
      <h2 className="h2">{dish.name}</h2>
      {(dish.translated || whereOf(dish)) && <p className="small me-sheet__sub">{[dish.translated, dish.place].filter(Boolean).join(' · ') || whereOf(dish)}</p>}
      <Totals n={dish} />
      {dish.why && <p className="best__why">{dish.why}</p>}
      {dish.allergens === null && dish.from === 'nearby' && <p className="small">Allergens are not checked here. Ask at the restaurant.</p>}
      <div className="me-sheet__actions">
        <button className="btn btn-primary" onClick={() => { me.log(dish); toast('Added to today'); onClose() }}>
          <Icon name="check" size={20} strokeWidth={2.4} /> I ate this
        </button>
        <div className="me-sheet__row">
          {!isMeal && (
            <button className="btn btn-secondary btn-sm" onClick={() => { toast(me.addToDraft(dish) ? 'Added to your meal' : 'Your meal is full') }}>
              <MeIcon name="layers" size={18} /> Add to meal
            </button>
          )}
          {!isMeal && (
            <button className="btn btn-secondary btn-sm" aria-pressed={saved} onClick={() => toast(me.toggleFavorite(dish) ? 'Saved' : 'Removed')}>
              <MeIcon name="heart" size={18} filled={saved} /> {saved ? 'Saved' : 'Save'}
            </button>
          )}
          {onMap && <button className="btn btn-secondary btn-sm" onClick={onMap}><Icon name="pin" size={18} /> Map</button>}
          {extra}
          {onRemove && <button className="btn btn-secondary btn-sm" onClick={onRemove}><Icon name="trash" size={18} /> Remove</button>}
        </div>
      </div>
    </Sheet>
  )
}

/**
 * Add a dish: type it, or tap one you scanned or saved. A typed dish goes to the
 * engine for its numbers; nothing typed here is ever shown as a number itself.
 */
export function DishPicker({ profile, onPick, picked, action = 'Add' }: {
  profile: Profile
  onPick: (dish: DishSnap) => void
  /** Keys already added in this visit: their row shows a check. */
  picked: ReadonlySet<string>
  action?: string
}) {
  const s = useMe()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [found, setFound] = useState<DishSnap[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'scanned' | 'saved'>(s.scanned.length > 0 || s.favorites.length === 0 ? 'scanned' : 'saved')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const q = text.trim()
    if (q.length < 2 || busy) return
    setBusy(true)
    setError(null)
    setFound(null)
    try {
      setFound(await estimateTyped(q, profile))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not estimate that. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const both = s.scanned.length > 0 && s.favorites.length > 0
  const rows = tab === 'scanned' ? s.scanned.map((x) => x.dish) : s.favorites
  const end = (d: DishSnap) => (picked.has(d.key)
    ? <span className="me-add is-done" aria-label="Added"><Icon name="check" size={18} strokeWidth={2.4} /></span>
    : <span className="me-add" aria-hidden="true"><Icon name="plus" size={18} strokeWidth={2.2} /></span>)

  return (
    <div className="me-picker">
      <form className="me-type" onSubmit={submit} role="search">
        <input
          className="input" value={text} onChange={(e) => { setText(e.target.value); setError(null) }} maxLength={200}
          placeholder="Type a dish" aria-label="Type a dish" enterKeyHint="search" autoComplete="off" autoCapitalize="sentences"
        />
        <button className="me-type__go" type="submit" disabled={busy || text.trim().length < 2} aria-label="Estimate it">
          {busy ? <span className="attach__spin" /> : <Icon name="arrow" size={20} strokeWidth={2.2} />}
        </button>
      </form>

      {busy && <div className="card-flat list-card" aria-busy="true"><div className="me-skel"><span className="skeleton" /><span className="skeleton" /></div></div>}
      {error && <p className="me-note" role="alert">{error}</p>}
      {found && found.length > 0 && (
        <div className="card-flat list-card me-found">
          {found.map((d) => (
            <SnapRow key={d.key} dish={d} sub={d.translated ?? 'Estimate'} end={end(d)} onClick={() => onPick(d)} />
          ))}
        </div>
      )}

      {s.scanned.length + s.favorites.length > 0 ? (
        <>
          {both ? (
            <div className="seg me-seg" role="radiogroup" aria-label="From">
              <button type="button" className="seg__opt" role="radio" aria-checked={tab === 'scanned'} onClick={() => setTab('scanned')}>Scanned</button>
              <button type="button" className="seg__opt" role="radio" aria-checked={tab === 'saved'} onClick={() => setTab('saved')}>Saved</button>
            </div>
          ) : <p className="eyebrow me-eyebrow">{s.scanned.length > 0 ? 'Scanned' : 'Saved'}</p>}
          <div className="card-flat list-card">
            {rows.slice(0, 16).map((d) => <SnapRow key={d.key} dish={d} sub={[d.translated, d.place].filter(Boolean).join(' · ') || undefined} end={end(d)} onClick={() => onPick(d)} />)}
          </div>
        </>
      ) : (
        !found && !busy && !error && <p className="small me-hint">Dishes you scan or save show up here. {action === 'Add' ? 'Or just type what you had.' : ''}</p>
      )}
    </div>
  )
}
