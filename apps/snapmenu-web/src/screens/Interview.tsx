import { useState } from 'react'
import type { Goal, PlantStyle, Profile } from '../../../snapmenu-api/src/types'
import { Icon } from '../components/ui'
import { ALLERGY_OPTIONS, LANGUAGES } from '../lib/format'

type Step = 'goal' | 'plant' | 'allergies' | 'language'

const GOALS: Array<{ id: Goal; title: string; sub: string; icon: string; tint: string; color: string }> = [
  { id: 'lose_fat', title: 'Lose fat', sub: 'Fewer calories, protein kept high', icon: 'flame', tint: 'var(--fat-tint)', color: 'var(--fat)' },
  { id: 'build_muscle', title: 'Build muscle', sub: 'The most protein on the menu', icon: 'muscle', tint: 'var(--protein-tint)', color: 'var(--protein)' },
  { id: 'balanced', title: 'Eat balanced', sub: 'A sensible plate, no extremes', icon: 'balance', tint: 'var(--carbs-tint)', color: 'var(--carbs)' },
  { id: 'plant_based', title: 'Vegan or vegetarian', sub: 'Only dishes that fit, best first', icon: 'leaf', tint: 'var(--basil-tint)', color: 'var(--basil)' },
]

export function Interview({ initial, onDone, onExit }: { initial: Profile | null; onDone: (p: Profile) => void; onExit: () => void }) {
  const [step, setStep] = useState<Step>('goal')
  const [goal, setGoal] = useState<Goal | null>(initial?.goal ?? null)
  const [plant, setPlant] = useState<PlantStyle>(initial?.plantStyle ?? 'vegan')
  const [allergies, setAllergies] = useState<string[]>(initial?.allergies ?? [])
  const [language, setLanguage] = useState<string>(initial?.language ?? guessLanguage())

  const steps: Step[] = goal === 'plant_based' ? ['goal', 'plant', 'allergies', 'language'] : ['goal', 'allergies', 'language']
  const idx = Math.max(0, steps.indexOf(step))
  const progress = ((idx + 1) / steps.length) * 100

  const next = () => {
    if (idx < steps.length - 1) setStep(steps[idx + 1]!)
    else if (goal) onDone({ goal, ...(goal === 'plant_based' ? { plantStyle: plant } : {}), allergies, language })
  }
  const back = () => (idx === 0 ? onExit() : setStep(steps[idx - 1]!))
  const toggleAllergy = (id: string) => setAllergies((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]))

  return (
    <main className="screen with-cta">
      <div className="topbar">
        <button className="icon-btn" onClick={back} aria-label="Back"><Icon name="back" /></button>
        <div className="progress" role="progressbar" aria-valuenow={idx + 1} aria-valuemin={1} aria-valuemax={steps.length} aria-label={`Question ${idx + 1} of ${steps.length}`}>
          <i style={{ width: `${progress}%` }} />
        </div>
        <span className="small num" style={{ minWidth: 32, textAlign: 'right' }}>{idx + 1}/{steps.length}</span>
      </div>

      <div key={step} className="stack-16" style={{ animation: 'screen-in 260ms var(--ease) both' }}>
        {step === 'goal' && (
          <>
            <div className="q-head">
              <p className="eyebrow">Your goal</p>
              <h1 className="h1">What should a good order do for you?</h1>
            </div>
            <div className="options" role="radiogroup" aria-label="Goal">
              {GOALS.map((g) => (
                <button key={g.id} className="option" role="radio" aria-checked={goal === g.id} onClick={() => setGoal(g.id)}>
                  <span className="o-icon" style={{ background: g.tint, color: g.color }}><Icon name={g.icon} size={22} /></span>
                  <span className="o-text"><span className="o-title">{g.title}</span><span className="o-sub">{g.sub}</span></span>
                  <span className="o-check"><Icon name="check" size={14} strokeWidth={2.5} /></span>
                </button>
              ))}
            </div>
          </>
        )}

        {step === 'plant' && (
          <>
            <div className="q-head">
              <p className="eyebrow">Plant-based</p>
              <h1 className="h1">Which one fits you?</h1>
            </div>
            <div className="options" role="radiogroup" aria-label="Diet">
              {([
                ['vegan', 'Vegan', 'No meat, fish, dairy, eggs or honey'],
                ['vegetarian', 'Vegetarian', 'No meat or fish. Dairy and eggs are fine'],
              ] as const).map(([id, t, s]) => (
                <button key={id} className="option" role="radio" aria-checked={plant === id} onClick={() => setPlant(id)}>
                  <span className="o-icon" style={{ background: 'var(--basil-tint)', color: 'var(--basil)' }}><Icon name="leaf" size={22} /></span>
                  <span className="o-text"><span className="o-title">{t}</span><span className="o-sub">{s}</span></span>
                  <span className="o-check"><Icon name="check" size={14} strokeWidth={2.5} /></span>
                </button>
              ))}
            </div>
          </>
        )}

        {step === 'allergies' && (
          <>
            <div className="q-head">
              <p className="eyebrow">Allergies</p>
              <h1 className="h1">Anything you need to avoid?</h1>
              <p className="body">Pick all that apply. We flag dishes that likely contain them, and tell you why.</p>
            </div>
            <div className="chips-grid" role="group" aria-label="Allergies">
              {ALLERGY_OPTIONS.map((a) => (
                <button key={a.id} className="chip-opt" role="checkbox" aria-checked={allergies.includes(a.id)} onClick={() => toggleAllergy(a.id)}>
                  <b>{a.label}</b>
                  <span>{a.hint}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {step === 'language' && (
          <>
            <div className="q-head">
              <p className="eyebrow">Language</p>
              <h1 className="h1">Translate menus into…</h1>
              <p className="body">Dish names and explanations come back in this language.</p>
            </div>
            <div className="chips-grid" role="radiogroup" aria-label="Language">
              {LANGUAGES.map((l) => (
                <button key={l.id} className="option" style={{ minHeight: 56, padding: '12px 16px' }} role="radio" aria-checked={language === l.id} onClick={() => setLanguage(l.id)}>
                  <span className="o-text"><span className="o-title">{l.native}</span>{l.native !== l.label && <span className="o-sub">{l.label}</span>}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="cta-bar">
        <button className="btn btn-primary" disabled={step === 'goal' && !goal} onClick={next}>
          {step === 'allergies' && allergies.length === 0 ? 'No allergies' : idx === steps.length - 1 ? 'Done, scan a menu' : 'Continue'}
        </button>
      </div>
    </main>
  )
}

function guessLanguage(): string {
  try {
    const l = (navigator.language || 'en').slice(0, 2)
    const map: Record<string, string> = { de: 'German', es: 'Spanish', fr: 'French', it: 'Italian', pt: 'Portuguese', tr: 'Turkish', pl: 'Polish', nl: 'Dutch', ar: 'Arabic' }
    return map[l] ?? 'English'
  } catch {
    return 'English'
  }
}
