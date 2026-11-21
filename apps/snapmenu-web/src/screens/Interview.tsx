import { useRef, useState } from 'react'
import type { Goal, PlantStyle, Profile } from '../../../snapmenu-api/src/types'
import { Icon } from '../components/ui'
import { ALLERGY_OPTIONS, guessLanguage, LANGUAGES } from '../lib/format'

type Step = 'goal' | 'allergies'
type Choice = 'lose_fat' | 'build_muscle' | 'balanced' | 'vegan' | 'vegetarian'

const CHOICES: Array<{ id: Choice; title: string; icon: string; tint: string; color: string }> = [
  { id: 'lose_fat', title: 'Lose fat', icon: 'flame', tint: 'var(--fat-tint)', color: 'var(--fat)' },
  { id: 'build_muscle', title: 'Build muscle', icon: 'muscle', tint: 'var(--protein-tint)', color: 'var(--protein)' },
  { id: 'balanced', title: 'Eat balanced', icon: 'balance', tint: 'var(--carbs-tint)', color: 'var(--carbs)' },
  { id: 'vegan', title: 'Vegan', icon: 'leaf', tint: 'var(--basil-tint)', color: 'var(--basil)' },
  { id: 'vegetarian', title: 'Vegetarian', icon: 'leaf', tint: 'var(--basil-tint)', color: 'var(--basil)' },
]

const choiceOf = (p: Profile | null): Choice | null => (!p ? null : p.goal === 'plant_based' ? (p.plantStyle === 'vegetarian' ? 'vegetarian' : 'vegan') : p.goal)
const goalOf = (c: Choice): { goal: Goal; plantStyle?: PlantStyle } => (c === 'vegan' || c === 'vegetarian' ? { goal: 'plant_based', plantStyle: c } : { goal: c })

/** Two taps to the camera: pick a goal (moves on by itself), then allergies. Language comes from the phone. */
export function Interview({ initial, onDone, onExit }: { initial: Profile | null; onDone: (p: Profile) => void; onExit: () => void }) {
  const [step, setStep] = useState<Step>('goal')
  const [choice, setChoice] = useState<Choice | null>(choiceOf(initial))
  const [allergies, setAllergies] = useState<string[]>(initial?.allergies ?? [])
  const [language, setLanguage] = useState<string>(initial?.language ?? guessLanguage())
  const timer = useRef<number | undefined>(undefined)

  const pick = (c: Choice) => {
    setChoice(c)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setStep('allergies'), 180)
  }
  const finish = (c: Choice, a: string[]) => onDone({ ...goalOf(c), allergies: a, language })
  const back = () => (step === 'goal' ? onExit() : setStep('goal'))
  const toggle = (id: string) => setAllergies((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]))

  return (
    <main className="screen with-cta interview">
      <div className="topbar">
        <button className="icon-btn" onClick={back} aria-label="Back"><Icon name="back" /></button>
        <div className="steps" role="progressbar" aria-valuenow={step === 'goal' ? 1 : 2} aria-valuemin={1} aria-valuemax={2} aria-label={`Step ${step === 'goal' ? 1 : 2} of 2`}>
          <i className="is-on" /><i className={step === 'allergies' ? 'is-on' : ''} />
        </div>
        {step === 'goal' && !initial
          ? <button className="link-btn" onClick={() => finish(choice ?? 'balanced', [])}>Skip</button>
          : <span style={{ width: 44 }} />}
      </div>

      <div key={step} className="rise">
        {step === 'goal' && (
          <>
            <h1 className="h1 q-head">What's your goal?</h1>
            <div className="options" role="radiogroup" aria-label="Goal">
              {CHOICES.map((g) => (
                <button key={g.id} className="option" role="radio" aria-checked={choice === g.id} onClick={() => pick(g.id)}>
                  <span className="o-icon" style={{ background: g.tint, color: g.color }}><Icon name={g.icon} size={22} /></span>
                  <span className="o-title">{g.title}</span>
                  <span className="o-check"><Icon name="check" size={14} strokeWidth={2.5} /></span>
                </button>
              ))}
            </div>
          </>
        )}

        {step === 'allergies' && (
          <>
            <h1 className="h1 q-head">Any allergies?</h1>
            <div className="chips-grid" role="group" aria-label="Allergies">
              {ALLERGY_OPTIONS.map((a) => (
                <button key={a.id} className="chip-opt" role="checkbox" aria-checked={allergies.includes(a.id)} title={a.hint} onClick={() => toggle(a.id)}>
                  {a.label}
                </button>
              ))}
            </div>
            <label className="lang-row">
              <Icon name="globe" size={18} />
              <span>Translate to</span>
              <select value={language} onChange={(e) => setLanguage(e.target.value)} aria-label="Language for translations">
                {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.native}</option>)}
              </select>
            </label>
          </>
        )}
      </div>

      {(step === 'allergies' || choice) && (
        <div className="cta-bar">
          {step === 'goal'
            ? <button className="btn btn-primary" onClick={() => setStep('allergies')}>Continue</button>
            : <button className="btn btn-primary" onClick={() => choice && finish(choice, allergies)}>{allergies.length === 0 ? 'No allergies' : 'Continue'}</button>}
        </div>
      )}
    </main>
  )
}
