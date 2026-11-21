import { useState } from 'react'
import type { Profile } from '../../../snapmenu-api/src/types'
import { ACTIVITY_LEVELS, defaultTargets, GRAM_STEP, KCAL_MAX, KCAL_MIN, KCAL_STEP, macroKcal, setKcal, setMacro, validBody, type Body } from '../../../snapmenu-api/src/me/targets'
import type { Macro } from '../../../snapmenu-api/src/me/types'
import { Icon, Sheet } from '../components/ui'
import { goalLabel, n0 } from '../lib/format'
import { me, useDay, useMe } from './store'

const MACROS: Array<{ id: Macro; label: string; cls: string }> = [
  { id: 'protein', label: 'Protein', cls: 'p' },
  { id: 'carbs', label: 'Carbs', cls: 'c' },
  { id: 'fat', label: 'Fat', cls: 'f' },
]

/** Calories and macros for a day. They start from the goal and every number can be changed. Saved as you tap. */
export function TargetsEditor({ profile, onBack }: { profile: Profile; onBack: () => void }) {
  const s = useMe()
  const { targets } = useDay(profile.goal)
  const [personal, setPersonal] = useState(false)
  const sum = macroKcal(targets)
  const off = Math.abs(sum - targets.kcal) > targets.kcal * 0.06
  return (
    <main className="screen me-screen">
      <div className="topbar">
        <button className="icon-btn" onClick={onBack} aria-label="Back"><Icon name="back" /></button>
        {targets.custom && <button className="link-btn" onClick={() => me.setTargets(null)}><Icon name="refresh" size={16} /> Reset</button>}
      </div>
      <h1 className="h1 q-head">Your targets</h1>

      <section className="card me-kcal">
        <span className="eyebrow">Calories a day</span>
        <div className="me-kcal__row">
          <button className="me-step" onClick={() => me.setTargets(setKcal(targets, targets.kcal - KCAL_STEP))} disabled={targets.kcal <= KCAL_MIN} aria-label="Fewer calories"><Icon name="minus" size={22} /></button>
          <div className="big" aria-live="polite"><b>{n0(targets.kcal)}</b><span>kcal</span></div>
          <button className="me-step" onClick={() => me.setTargets(setKcal(targets, targets.kcal + KCAL_STEP))} disabled={targets.kcal >= KCAL_MAX} aria-label="More calories"><Icon name="plus" size={22} /></button>
        </div>
      </section>

      <div className="card-flat list-card me-macros">
        {MACROS.map((m) => (
          <div key={m.id} className="me-macro">
            <i className={`me-dot ${m.cls}`} aria-hidden="true" />
            <span className="set-row__label">{m.label}</span>
            <div className="stepper" role="group" aria-label={`${m.label} grams`}>
              <button onClick={() => me.setTargets(setMacro(targets, m.id, targets[m.id] - GRAM_STEP))} aria-label="Less"><Icon name="minus" size={18} /></button>
              <span className="g">{n0(targets[m.id])} g</span>
              <button onClick={() => me.setTargets(setMacro(targets, m.id, targets[m.id] + GRAM_STEP))} aria-label="More"><Icon name="plus" size={18} /></button>
            </div>
          </div>
        ))}
      </div>

      <p className="small me-fine">
        {targets.custom ? 'Your own numbers.' : s.body ? `Worked out for you and “${goalLabel(profile)}”.` : `Suggested for “${goalLabel(profile)}”.`}
        {off && ` The macros add up to ${n0(sum)} kcal.`}
      </p>

      <button className="post-prompt me-personal" onClick={() => setPersonal(true)}>
        <span className="me-ic"><Icon name="user" size={20} /></span>
        <b>{s.body ? 'Your details' : 'Make it personal'}</b>
        <Icon name="chevron" size={18} />
      </button>

      {personal && <BodySheet goal={profile.goal} initial={s.body} onClose={() => setPersonal(false)} />}
    </main>
  )
}

/** Optional: height, weight, age, sex and activity. With them the Nut AI goals engine works out the targets. */
function BodySheet({ goal, initial, onClose }: { goal: Profile['goal']; initial: Body | null; onClose: () => void }) {
  const [weight, setWeight] = useState(initial ? String(initial.weightKg) : '')
  const [height, setHeight] = useState(initial ? String(initial.heightCm) : '')
  const [age, setAge] = useState(initial ? String(initial.ageYears) : '')
  const [sex, setSex] = useState<Body['sex']>(initial?.sex ?? 'unspecified')
  const [activity, setActivity] = useState<Body['activity']>(initial?.activity ?? 'light')
  const body = validBody({ sex, activity, weightKg: Number(weight.replace(',', '.')), heightCm: Number(height.replace(',', '.')), ageYears: Number(age) })
  const preview = body ? defaultTargets(goal, body) : null
  const num = (label: string, unit: string, value: string, set: (v: string) => void) => (
    <label className="me-field">
      <span>{label}</span>
      <span className="me-field__in"><input className="input" inputMode="decimal" value={value} onChange={(e) => set(e.target.value.replace(/[^0-9.,]/g, '').slice(0, 5))} aria-label={`${label} in ${unit}`} /><small>{unit}</small></span>
    </label>
  )
  return (
    <Sheet label="Your details" onClose={onClose} className="me-sheet">
      <h2 className="h2">Make it personal</h2>
      <p className="small me-sheet__sub">Stays on this phone. Only used to work out your targets.</p>
      <div className="me-fields">
        {num('Weight', 'kg', weight, setWeight)}
        {num('Height', 'cm', height, setHeight)}
        {num('Age', 'years', age, setAge)}
      </div>
      <div className="seg me-seg--three" role="radiogroup" aria-label="Sex, used for the formula only">
        {([['female', 'Female'], ['male', 'Male'], ['unspecified', 'Skip']] as const).map(([id, label]) => (
          <button key={id} type="button" className="seg__opt" role="radio" aria-checked={sex === id} onClick={() => setSex(id)}>{label}</button>
        ))}
      </div>
      <div className="me-chips" role="group" aria-label="How active you are">
        {ACTIVITY_LEVELS.map((a) => (
          <button key={a.id} type="button" className="q-chip" aria-pressed={activity === a.id} onClick={() => setActivity(a.id)}>{a.label}</button>
        ))}
      </div>
      <div className="me-sheet__actions">
        <button className="btn btn-primary" disabled={!body} onClick={() => { me.setBody(body); me.setTargets(null); onClose() }}>
          {preview ? `Use ${n0(preview.kcal)} kcal` : 'Fill in the three numbers'}
        </button>
        {initial && <button className="btn btn-secondary" onClick={() => { me.setBody(null); me.setTargets(null); onClose() }}>Forget my details</button>}
      </div>
    </Sheet>
  )
}
