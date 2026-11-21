import { useState } from 'react'
import { mealTotals } from '../../../snapmenu-api/src/me/meal'
import { mealSnap } from '../../../snapmenu-api/src/me/snap'
import type { DishSnap, Meal } from '../../../snapmenu-api/src/me/types'
import { Icon } from '../components/ui'
import { DishSheet, MeIcon, SnapRow } from './parts'
import { me, useMe } from './store'

const snapOfMeal = (m: Meal): DishSnap => mealSnap(m.name, m.items, mealTotals(m.items))

/** Saved dishes and saved meals. Tap one to log it, build with it or remove it. */
export function Favorites({ onBack, toast, onBuild }: { onBack: () => void; toast: (t: string) => void; onBuild: () => void }) {
  const s = useMe()
  const [tab, setTab] = useState<'dishes' | 'meals'>(s.favorites.length === 0 && s.meals.length > 0 ? 'meals' : 'dishes')
  const [dish, setDish] = useState<DishSnap | null>(null)
  const [meal, setMeal] = useState<Meal | null>(null)
  const empty = tab === 'dishes' ? s.favorites.length === 0 : s.meals.length === 0
  return (
    <main className="screen me-screen">
      <div className="topbar">
        <button className="icon-btn" onClick={onBack} aria-label="Back"><Icon name="back" /></button>
      </div>
      <h1 className="h1 q-head">Favorites</h1>
      <div className="seg me-seg me-seg--two" role="radiogroup" aria-label="Show">
        <button type="button" className="seg__opt" role="radio" aria-checked={tab === 'dishes'} onClick={() => setTab('dishes')}>Dishes{s.favorites.length > 0 ? ` · ${s.favorites.length}` : ''}</button>
        <button type="button" className="seg__opt" role="radio" aria-checked={tab === 'meals'} onClick={() => setTab('meals')}>Meals{s.meals.length > 0 ? ` · ${s.meals.length}` : ''}</button>
      </div>

      {empty ? (
        <div className="state me-empty">
          <span className="s-ic"><MeIcon name={tab === 'dishes' ? 'heart' : 'layers'} size={30} /></span>
          <h2 className="h3">{tab === 'dishes' ? 'No saved dishes yet' : 'No saved meals yet'}</h2>
          <p className="body">{tab === 'dishes' ? 'Tap the heart on any dish.' : 'Combine dishes and save the meal.'}</p>
          {tab === 'meals' && <button className="btn btn-secondary btn-sm" onClick={onBuild}><MeIcon name="layers" size={18} /> Build a meal</button>}
        </div>
      ) : tab === 'dishes' ? (
        <div className="card-flat list-card">
          {s.favorites.map((d) => <SnapRow key={d.key} dish={d} sub={[d.translated, d.place].filter(Boolean).join(' · ') || undefined} onClick={() => setDish(d)} />)}
        </div>
      ) : (
        <div className="card-flat list-card">
          {s.meals.map((m) => <SnapRow key={m.id} dish={snapOfMeal(m)} sub={`${m.items.length} ${m.items.length === 1 ? 'dish' : 'dishes'}`} onClick={() => setMeal(m)} />)}
        </div>
      )}

      {dish && <DishSheet dish={dish} toast={toast} onClose={() => setDish(null)} />}
      {meal && (
        <DishSheet
          dish={snapOfMeal(meal)} toast={toast} onClose={() => setMeal(null)}
          onRemove={() => { me.removeMeal(meal.id); setMeal(null); toast('Removed') }}
          extra={<button className="btn btn-secondary btn-sm" onClick={() => { me.setDraft(meal.items); setMeal(null); onBuild() }}><Icon name="edit" size={18} /> Change</button>}
        />
      )}
    </main>
  )
}
