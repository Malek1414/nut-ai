// Drinks in a scanned menu: one quiet fold under the whole menu, with the engine's numbers like any dish.
// Alcoholic drinks show only after the person said they are 18 or older (asked once, kept on the phone,
// changeable under Me). They are listed last, carry no "Top" tag and no recommendation line.
import { useMemo, useState } from 'react'
import { visibleDrinks } from '../../../snapmenu-api/src/discover/drinks'
import type { DishEstimate, MenuResult } from '../../../snapmenu-api/src/types'
import { Fold, Icon, Sheet } from '../components/ui'
import { kcalRange, n0 } from '../lib/format'
import { setAdult, useAdult } from './adult'
import './drinks.css'

/** One drink: name, translation, the engine's calorie range and carbs. Same row as "Whole menu". */
function DrinkRow({ d, alcoholic, onOpen }: { d: DishEstimate; alcoholic: boolean; onOpen: () => void }) {
  // Without a counted component the engine has no number for this drink: say so instead of showing zeros.
  const counted = d.rows.some((r) => r.counted)
  return (
    <button className="dish-row" onClick={onOpen}>
      <span className="dish-row__text">
        <span className="row" style={{ gap: 6 }}>
          <b>{d.name}</b>
          {d.userAllergenHits.length > 0 && <span className="badge avoid">Allergy</span>}
          {alcoholic && <span className="drinks-age" title="Shown because you said you are 18 or older">18+</span>}
        </span>
        {d.translated && d.translated !== d.name && <span className="small">{d.translated}</span>}
      </span>
      {counted ? (
        <span className="dish-row__nums">
          <span className="dr-k">{d.kcal.low === d.kcal.high ? n0(d.kcal.mid) : kcalRange(d.kcal)}</span>
          <span className="small">{n0(d.carbs.mid)} g carbs</span>
        </span>
      ) : (
        <span className="dish-row__nums"><span className="small">No data</span></span>
      )}
      <Icon name="chevron" size={18} />
    </button>
  )
}

/** "Drinks" under the whole menu. Renders nothing when the menu has no drink to show and nothing to ask. */
export function DrinksFold({ result, onOpenDish }: { result: MenuResult; onOpenDish: (id: string) => void }) {
  const adult = useAdult()
  const { drinks, alcoholic, hiddenAlcohol } = useMemo(() => visibleDrinks(result.dishes, adult === 'yes'), [result.dishes, adult])
  // Asked once, and only on a menu that has something to hide.
  const ask = adult === null && hiddenAlcohol > 0
  if (drinks.length === 0 && !ask) return null
  return (
    <div className="drinks-fold">
      <Fold title="Drinks" {...(drinks.length > 0 ? { count: drinks.length } : {})}>
        {drinks.map((d) => <DrinkRow key={d.id} d={d} alcoholic={alcoholic.has(d)} onOpen={() => onOpenDish(d.id)} />)}
        {ask && (
          <div className="drinks-ask" role="group" aria-label="Alcoholic drinks">
            <span className="drinks-ask__text">Alcoholic drinks are hidden</span>
            <span className="drinks-ask__actions">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAdult('yes')}>I am 18 or older</button>
              <button type="button" className="link-btn" onClick={() => setAdult('no')}>Keep hidden</button>
            </span>
          </div>
        )}
      </Fold>
    </div>
  )
}

/** A glass, in the app's icon family (24px grid, 1.75 stroke, round caps). */
function GlassIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6.5 4.5h11l-1.2 14a1.5 1.5 0 0 1-1.5 1.4H9.2a1.5 1.5 0 0 1-1.5-1.4Z" />
      <path d="M7 10h10" />
    </svg>
  )
}

/** A settings row for the Me screen: "Alcoholic drinks" with Hidden / Shown and the switch. */
export function AdultRow() {
  const adult = useAdult()
  const [asking, setAsking] = useState(false)
  const on = adult === 'yes'
  const answer = (v: 'yes' | 'no') => { setAdult(v); setAsking(false) }
  return (
    <>
      <button type="button" className="set-row" role="switch" aria-checked={on} onClick={() => (on ? setAdult('no') : setAsking(true))}>
        <span className="set-row__ic drinks-row-ic"><GlassIcon /></span>
        <span className="set-row__label">Alcoholic drinks</span>
        <span className="set-row__value">{on ? 'Shown' : 'Hidden'}</span>
        <span className={`switch ${on ? 'is-on' : ''}`} aria-hidden="true" />
      </button>
      {asking && (
        <Sheet label="Are you 18 or older?" onClose={() => setAsking(false)}>
          <h2 className="h2">Are you 18 or older?</h2>
          <p className="body drinks-sheet__note">Alcoholic drinks only show if you are.</p>
          <div className="drinks-sheet__actions">
            <button type="button" className="btn btn-primary" onClick={() => answer('yes')}>Yes, I am 18 or older</button>
            <button type="button" className="btn btn-secondary" onClick={() => answer('no')}>No</button>
          </div>
        </Sheet>
      )}
    </>
  )
}
