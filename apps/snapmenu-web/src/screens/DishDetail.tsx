import { useMemo, useState, type ReactNode } from 'react'
import { recomputeTotals } from '@nutai/totals'
import type { IngredientRow, LoggedMeal } from '@nutai/core-schema'
import type { ComponentRow, DishEstimate, MenuResult, Range } from '../../../snapmenu-api/src/types'
import { Fold, Icon, Macros, RangeBar, Sheet } from '../components/ui'
import { track } from '../lib/api'
import { n0 } from '../lib/format'
import { social } from '../social'
import { SayThis } from './Results'

type Edit = { grams: number; on: boolean }

const QUICK: Array<{ id: string; label: string; apply: (r: ComponentRow, g: number) => Edit | null }> = [
  { id: 'small', label: 'Smaller', apply: (_r, g) => ({ grams: g * 0.75, on: true }) },
  { id: 'big', label: 'Bigger', apply: (_r, g) => ({ grams: g * 1.3, on: true }) },
  { id: 'sauce', label: 'Sauce on the side', apply: (r, g) => (r.hiddenFat && /sauce|dressing|vinaigrette|mayo|ketchup|soße|aioli/i.test(r.name) ? { grams: g * 0.4, on: true } : null) },
  { id: 'nofries', label: 'No fries', apply: (r) => (/fries|pommes/i.test(r.name) ? { grams: 0, on: false } : null) },
  { id: 'nobread', label: 'No bread', apply: (r) => (/bread|bun|roll|wrap|pita|yufka|tortilla|crouton/i.test(r.name) ? { grams: 0, on: false } : null) },
]

function SourceTag({ r }: { r: ComponentRow }) {
  const s = r.source
  if (s.kind === 'usda') return <a className="src-tag usda" href={s.url} target="_blank" rel="noreferrer">USDA</a>
  if (s.kind === 'off') return <a className="src-tag off" href={s.url} target="_blank" rel="noreferrer">Open Food Facts</a>
  if (s.kind === 'snapmenu_estimate') return <span className="src-tag est">Estimate</span>
  return <span className="src-tag none">No data</span>
}

function sourceLine(r: ComponentRow): string {
  const s = r.source
  if (s.kind === 'usda') return `${s.dataset}: “${s.name}”, ${n0(r.per100.kcal)} kcal / 100 g`
  if (s.kind === 'off') return `Open Food Facts: ${s.brand ? `${s.brand} ` : ''}${s.name}, ${n0(r.per100.kcal)} kcal / 100 g`
  if (s.kind === 'snapmenu_estimate') return `${s.note}, ${n0(r.per100.kcal)} kcal / 100 g`
  return s.note
}

export function DishDetail({ dish, result, onBack, onToast, renderActions }: {
  dish: DishEstimate; result: MenuResult; onBack: () => void; onToast: (t: string) => void
  /** Actions under the numbers (src/me: I ate this, save, add to a meal). Gets the numbers as changed on this screen, null when unchanged. */
  renderActions?: (changed: { kcal: Range; protein: Range; carbs: Range; fat: Range } | null) => ReactNode
}) {
  const [edits, setEdits] = useState<Record<string, Edit>>({})
  const [quick, setQuick] = useState<string[]>([])
  const [sheet, setSheet] = useState(false)
  /** The ingredient whose source is showing. */
  const [open, setOpen] = useState<string | null>(null)
  const tip = result.tips.find((t) => t.dishId === dish.id)
  const skip = result.avoid.find((a) => a.dishId === dish.id)

  const view = useMemo(() => {
    const rows = dish.rows.map((r) => ({ r, e: edits[r.id] ?? { grams: r.grams, on: r.counted } }))
    // Same arithmetic as Nut AI's repair loop: every row carries its per-100 g snapshot,
    // so a correction is a local recompute with @nutai/totals, no model call.
    const ingredients: IngredientRow[] = rows
      .filter(({ r, e }) => e.on && r.counted)
      .map(({ r, e }) => ({
        id: r.id, displayName: r.name, sourceFoodId: null, grams: e.grams,
        nutrientSnapshot: { kcal: r.per100.kcal, protein_g: r.per100.protein_g, fat_g: r.per100.fat_g, carbs_g: r.per100.carbs_g, fiber_g: r.per100.fiber_g, sugar_g: r.per100.sugar_g, sodium_mg: r.per100.sodium_mg },
        origin: 'db_search', gramPathway: edits[r.id] ? 'user_edited' : 'model_guess', bandHalfPct: r.bandHalfPct, isEstimate: r.isEstimate, assumptions: [],
      }))
    const meal: LoggedMeal = { id: dish.id, loggedAt: new Date(0).toISOString(), ingredients, portionEatenFraction: 1, engineId: 'snapmenu-web', promptVersion: null, schemaVersion: null, clampFlags: [] }
    const t = recomputeTotals(meal)
    // Rows the user set by hand stop contributing uncertainty from their grams.
    const kcalOf = (i: IngredientRow) => (i.nutrientSnapshot.kcal * i.grams) / 100
    const total = Math.max(1, ingredients.reduce((s, i) => s + kcalOf(i), 0))
    const uneditedShare = ingredients.filter((i) => !edits[i.id]).reduce((s, i) => s + kcalOf(i), 0) / total
    const half = Object.keys(edits).length ? Math.max(0.08, dish.bandHalfPct * uneditedShare) : dish.bandHalfPct
    const rng = (v: number, round: number): Range => ({ low: Math.round((v * (1 - half)) / round) * round, high: Math.round((v * (1 + half)) / round) * round, mid: Math.round(v / round) * round })
    return { rows, kcal: rng(t.kcal, 10), protein: rng(t.protein_g, 1), carbs: rng(t.carbs_g, 1), fat: rng(t.fat_g, 1) }
  }, [dish, edits])

  const setGrams = (r: ComponentRow, grams: number) => setEdits((e) => ({ ...e, [r.id]: { grams: Math.max(0, Math.round(grams)), on: grams > 0 } }))
  const toggleQuick = (id: string) => {
    const on = !quick.includes(id)
    const nextQuick = on ? [...quick.filter((q) => !(id === 'small' && q === 'big') && !(id === 'big' && q === 'small')), id] : quick.filter((q) => q !== id)
    setQuick(nextQuick)
    const next: Record<string, Edit> = {}
    for (const r of dish.rows) {
      let e: Edit = { grams: r.grams, on: r.counted }
      for (const q of QUICK.filter((x) => nextQuick.includes(x.id))) e = q.apply(r, e.grams) ?? e
      if (e.grams !== r.grams || e.on !== r.counted) next[r.id] = { grams: Math.round(e.grams), on: e.on }
    }
    setEdits(next)
    track('adjust', { scanId: result.scanId, dish: dish.recipe?.key ?? 'model', chip: id, on })
  }
  const edited = Object.keys(edits).length > 0

  const quickChips = QUICK.filter((q) => dish.rows.some((r) => q.apply(r, r.grams) !== null))

  return (
    <main className="screen dish">
      <div className="topbar">
        <button className="icon-btn" onClick={onBack} aria-label="Back to results"><Icon name="back" /></button>
        <span className="row">
          <button className="icon-btn" onClick={() => social.share({ kind: 'dish', dish, why: tip?.why ?? null, restaurant: result.restaurant, place: null, goal: null })} aria-label="Share this dish"><Icon name="share" size={19} /></button>
          <button className="icon-btn" onClick={() => setSheet(true)} aria-label="This looks wrong"><Icon name="flag" size={19} /></button>
        </span>
      </div>

      <header className="detail-hero">
        <h1 className="h1">{dish.name}</h1>
        {dish.translated !== dish.name && <p className="lead">{dish.translated}</p>}
        {dish.description && <p className="body">{dish.description}</p>}
        {skip
          ? <ul className="plain-list skip-why">{skip.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          : (tip?.why ?? dish.why) && <p className="best__why">{tip?.why ?? dish.why}</p>}
      </header>

      <section className="card" style={{ padding: 20, display: 'grid', gap: 16 }}>
        <RangeBar range={view.kcal} tier={edited ? 'tight' : dish.bandTier} />
        <Macros d={view} />
        {quickChips.length > 0 && (
          <div className="quick quick--in-card" role="group" aria-label="Adjust the dish">
            {quickChips.map((q) => (
              <button key={q.id} className="q-chip" aria-pressed={quick.includes(q.id)} onClick={() => toggleQuick(q.id)}>{q.label}</button>
            ))}
            {edited && <button className="q-chip q-chip--reset" onClick={() => { setEdits({}); setQuick([]) }}><Icon name="refresh" size={15} /> Reset</button>}
          </div>
        )}
      </section>

      {renderActions?.(edited ? view : null)}

      {tip && <div style={{ marginTop: 12 }}><SayThis tip={tip} onToast={onToast} /></div>}

      {dish.allergens.length > 0 && (
        <section className="card-flat allergy-card">
          <div className="allergen-row" aria-label="Likely allergens">
            <span className="small">May contain</span>
            {dish.allergens.map((a) => {
              const hit = dish.userAllergenHits.some((h) => h.allergen === a.allergen)
              return <span key={a.allergen} className={`a-chip ${hit ? 'hit' : ''}`} title={a.reason}>{hit && <Icon name="alert" size={13} />}{a.label.split(' (')[0]}</span>
            })}
          </div>
          <p className="small">Hints, not a guarantee. Confirm with the restaurant.</p>
        </section>
      )}

      <Fold title="Ingredients" count={view.rows.length} defaultOpen>
        {view.rows.map(({ r, e }) => {
          const kcal = e.on && r.counted ? (r.per100.kcal * e.grams) / 100 : 0
          const shown = open === r.id
          return (
            <div key={r.id} className={`comp ${!e.on || !r.counted ? 'off-row' : ''}`}>
              <div className="comp-top">
                <button className="comp-name" aria-expanded={shown} onClick={() => setOpen(shown ? null : r.id)}>
                  <span>{r.name}</span>
                  <span className="small num">{r.counted ? `${n0(kcal)} kcal` : 'not counted'}</span>
                </button>
                <div className="stepper" role="group" aria-label={`${r.name} grams`}>
                  <button onClick={() => setGrams(r, e.grams - stepFor(e.grams))} aria-label="Less"><Icon name="minus" size={18} /></button>
                  <span className="g">{n0(e.grams)} g</span>
                  <button onClick={() => setGrams(r, (e.on ? e.grams : 0) + stepFor(e.grams))} aria-label="More"><Icon name="plus" size={18} /></button>
                </div>
              </div>
              {shown && (
                <div className="comp-more">
                  <SourceTag r={r} />
                  <p className="small">{sourceLine(r)}</p>
                  <p className="small">Grams: {r.gramSource}. Range ±{Math.round(r.bandHalfPct * 100)}%.</p>
                </div>
              )}
            </div>
          )
        })}
      </Fold>

      <Fold title="How sure" count={`±${Math.round(dish.bandHalfPct * 100)}%`}>
        <ul className="plain-list">
          {dish.bandReasons.map((r) => <li key={r}>{r}</li>)}
          {dish.allergens.map((a) => <li key={a.allergen}>{a.label.split(' (')[0]}: {a.reason}</li>)}
        </ul>
      </Fold>

      {sheet && <WrongSheet onClose={() => setSheet(false)} onSend={(reason, note) => {
        track('correction', { scanId: result.scanId, dish: dish.name, recipe: dish.recipe?.key ?? null, reason, note: note.slice(0, 300), edits: Object.keys(edits).length, kcalShown: dish.kcal.mid, kcalAfter: view.kcal.mid })
        setSheet(false)
        onToast('Thanks, sent')
      }} />}
    </main>
  )
}

const stepFor = (g: number) => (g >= 200 ? 25 : g >= 60 ? 10 : 5)

function WrongSheet({ onClose, onSend }: { onClose: () => void; onSend: (reason: string, note: string) => void }) {
  const [reason, setReason] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const reasons = ['Wrong dish or translation', 'Portion looks off', 'Wrong ingredient', 'Wrong allergen', 'Something else']
  return (
    <Sheet label="Report a wrong result" onClose={onClose}>
      <h2 className="h2">What looks wrong?</h2>
      <div className="stack-8" role="radiogroup" aria-label="Reason" style={{ marginTop: 16 }}>
        {reasons.map((r) => (
          <button key={r} className="option option--sm" role="radio" aria-checked={reason === r} onClick={() => setReason(r)}>
            <span className="o-title">{r}</span>
            <span className="o-check"><Icon name="check" size={14} strokeWidth={2.5} /></span>
          </button>
        ))}
      </div>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Details (optional)" aria-label="Details (optional)" style={{ marginTop: 12 }} />
      <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={!reason} onClick={() => reason && onSend(reason, note)}>Send</button>
    </Sheet>
  )
}
