import { useState } from 'react'
import type { Profile } from '../../../snapmenu-api/src/types'
import { bandTier, mealTotals } from '../../../snapmenu-api/src/me/meal'
import { mealSnap } from '../../../snapmenu-api/src/me/snap'
import type { DishSnap } from '../../../snapmenu-api/src/me/types'
import { Icon, Sheet, tierLabel } from '../components/ui'
import { track } from '../lib/api'
import { kcalRange, n0 } from '../lib/format'
import { DishPicker, MeIcon, Totals, whereOf } from './parts'
import { me, useMe } from './store'

/**
 * Combine dishes into one meal. The totals are ranges: the engine's numbers added
 * up, as wide as the engine says a whole meal is.
 */
export function MealBuilder({ profile, onBack, toast }: { profile: Profile; onBack: () => void; toast: (t: string) => void }) {
  const s = useMe()
  const items = s.draft
  const [picking, setPicking] = useState(false)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  /** The name this meal was just saved under: logging it then uses that name. */
  const [savedAs, setSavedAs] = useState<string | null>(null)
  const totals = mealTotals(items)
  const auto = items.map((d) => d.name).join(' + ')

  const pick = (dish: DishSnap) => {
    if (!me.addToDraft(dish)) { toast('Your meal is full'); return }
    setSavedAs(null)
    setPicking(false)
  }
  const eat = () => {
    me.log(mealSnap(savedAs ?? auto, items, totals))
    track('me_meal_log', { dishes: items.length })
    me.setDraft([])
    toast('Added to today')
    onBack()
  }
  const save = () => {
    setSavedAs(me.saveMeal(name || auto, items).name)
    track('me_meal_save', { dishes: items.length })
    setNaming(false)
    setName('')
    toast('Meal saved')
  }

  return (
    <main className={`screen me-screen ${items.length > 0 ? 'with-cta me-screen--two' : ''}`}>
      <div className="topbar">
        <button className="icon-btn" onClick={onBack} aria-label="Back"><Icon name="back" /></button>
        {items.length > 0 && <button className="link-btn" onClick={() => me.setDraft([])}>Clear</button>}
      </div>
      <h1 className="h1 q-head">Build a meal</h1>

      {items.length === 0 ? (
        <div className="state me-empty">
          <span className="s-ic"><MeIcon name="layers" size={30} /></span>
          <h2 className="h3">Start with one dish</h2>
          <p className="body">Add a main, a side, a drink. See what it adds up to.</p>
          <button className="btn btn-primary" onClick={() => setPicking(true)}><Icon name="plus" size={20} strokeWidth={2.2} /> Add a dish</button>
        </div>
      ) : (
        <>
          <section className="card me-total">
            <div className="day-card__head">
              <span className="eyebrow">{items.length === 1 ? '1 dish' : `${items.length} dishes`}</span>
              <span className="conf" title="How wide the range is">{tierLabel(bandTier(totals.half))}</span>
            </div>
            <Totals n={totals} max={2000} />
          </section>

          <div className="card-flat list-card me-items">
            {items.map((d, i) => (
              <div key={`${d.key}-${i}`} className="me-item">
                <span className="dish-row__text">
                  <b>{d.name}</b>
                  <span className="small">{[kcalRange(d.kcal) + ' kcal', `${n0(d.protein.mid)} g protein`, whereOf(d)].filter(Boolean).join(' · ')}</span>
                </span>
                <button className="me-x" onClick={() => { me.removeFromDraft(i); setSavedAs(null) }} aria-label={`Remove ${d.name}`}><Icon name="close" size={16} /></button>
              </div>
            ))}
            <button className="me-item me-item--add" onClick={() => setPicking(true)}>
              <span className="me-add" aria-hidden="true"><Icon name="plus" size={18} strokeWidth={2.2} /></span>
              <b>Add a dish</b>
            </button>
          </div>

          <div className="cta-bar">
            <button className="btn btn-primary" onClick={eat}><Icon name="check" size={20} strokeWidth={2.4} /> I ate this</button>
            <button className="btn btn-secondary" onClick={() => setNaming(true)}><MeIcon name="heart" size={20} /> Save meal</button>
          </div>
        </>
      )}

      {picking && (
        <Sheet label="Add a dish" onClose={() => setPicking(false)} className="me-sheet me-sheet--tall">
          <h2 className="h2">Add a dish</h2>
          <DishPicker profile={profile} onPick={pick} picked={new Set()} action="Pick" />
        </Sheet>
      )}
      {naming && (
        <Sheet label="Save meal" onClose={() => setNaming(false)} className="me-sheet">
          <h2 className="h2">Name your meal</h2>
          <form onSubmit={(e) => { e.preventDefault(); save() }} className="me-sheet__actions">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder={auto.slice(0, 40)} aria-label="Meal name" autoComplete="off" enterKeyHint="done" />
            <button className="btn btn-primary" type="submit">Save</button>
          </form>
        </Sheet>
      )}
    </main>
  )
}
