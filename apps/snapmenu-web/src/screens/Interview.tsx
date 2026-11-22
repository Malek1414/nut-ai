import { useState } from 'react'
import { dietOf, type Goal, type Profile } from '../../../snapmenu-api/src/types'
import { Icon } from '../components/ui'
import { ALLERGY_OPTIONS, guessLanguage, LANGUAGES } from '../lib/format'
import { TasteEditor } from '../me/TasteEditor'
import { VoiceRecorder } from '../voice/VoiceRecorder'
import { understandInterview } from '../../../snapmenu-api/src/voice/speech'
import { parseNeedsText } from '../../../snapmenu-api/src/group/needs'
import { track } from '../lib/api'

type Step = 'goal' | 'food' | 'taste'
type Diet = NonNullable<Profile['diet']>
type Choice = Exclude<Goal, 'plant_based'>

const GOALS: Array<{ id: Choice; title: string; icon: string; tint: string; color: string }> = [
  { id: 'lose_fat', title: 'Lose fat', icon: 'flame', tint: 'var(--fat-tint)', color: 'var(--fat)' },
  { id: 'build_muscle', title: 'Build muscle', icon: 'muscle', tint: 'var(--protein-tint)', color: 'var(--protein)' },
  { id: 'balanced', title: 'Eat balanced', icon: 'balance', tint: 'var(--carbs-tint)', color: 'var(--carbs)' },
]
const DIETS: { id: Diet; title: string }[] = [{ id: 'any', title: 'Anything' }, { id: 'vegetarian', title: 'Vegetarian' }, { id: 'vegan', title: 'Vegan' }]

export function Interview({ initial, onDone, onExit }: { initial: Profile | null; onDone: (p: Profile) => void; onExit: () => void }) {
  const [step, setStep] = useState<Step>('goal')
  const [goal, setGoal] = useState<Choice>(initial?.goal === 'lose_fat' || initial?.goal === 'build_muscle' ? initial.goal : 'balanced')
  const [diet, setDiet] = useState<Diet>(initial ? dietOf(initial) : 'any')
  const [allergies, setAllergies] = useState<string[]>(initial?.allergies ?? [])
  const [language, setLanguage] = useState<string>(initial?.language ?? guessLanguage())
  const [voiceNote, setVoiceNote] = useState('')
  const [recording, setRecording] = useState(false)
  const finish = () => onDone({ goal, diet, allergies, language })
  const toggle = (id: string) => setAllergies((a) => a.includes(id) ? a.filter((x) => x !== id) : [...a, id])

  if (step === 'taste') return <TasteEditor onDone={finish} onBack={() => setStep('food')} />
  return (
    <main className="screen with-cta interview interview-profile">
      <div className="topbar">
        <button className="icon-btn" onClick={step === 'goal' ? onExit : () => setStep('goal')} aria-label="Back"><Icon name="back" /></button>
        <div className="steps" role="progressbar" aria-valuenow={step === 'goal' ? 1 : 2} aria-valuemin={1} aria-valuemax={2} aria-label="Profile setup">
          <i className="is-on" /><i className={step === 'food' ? 'is-on' : ''} />
        </div>
        {!initial ? <button className="link-btn" onClick={finish} disabled={recording}>{step === 'goal' ? 'Skip setup' : 'Start scanning'}</button> : <span style={{ width: 44 }} />}
      </div>

      <div key={step} className="rise">
        {step === 'goal' ? (
          <>
            <h1 className="h1 q-head">What’s your goal?</h1>
            <div className="options" role="radiogroup" aria-label="Goal">
              {GOALS.map((g) => (
                <button key={g.id} className="option" role="radio" aria-checked={goal === g.id} onClick={() => setGoal(g.id)}>
                  <span className="o-icon" style={{ background: g.tint, color: g.color }}><Icon name={g.icon} size={22} /></span>
                  <span className="o-title">{g.title}</span>
                  <span className="o-check"><Icon name="check" size={14} strokeWidth={2.5} /></span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <h1 className="h1 q-head">What do you eat?</h1>
            <h2 className="eyebrow interview-profile__label" id="profile-diet">Diet</h2>
            <div className="g-seg" role="radiogroup" aria-labelledby="profile-diet">
              {DIETS.map((item) => <button key={item.id} className="g-seg__opt" role="radio" aria-checked={item.id === diet} onClick={() => setDiet(item.id)}>{item.title}</button>)}
            </div>
            <h2 className="eyebrow interview-profile__label" id="profile-restrictions">Allergies &amp; ingredient restrictions</h2>
            <div className="chips-grid" role="group" aria-labelledby="profile-restrictions">
              {ALLERGY_OPTIONS.map((a) => (
                <button key={a.id} className="chip-opt" role="checkbox" aria-checked={allergies.includes(a.id)} title={a.hint} onClick={() => toggle(a.id)}>{a.label}</button>
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

      {step === 'goal' && <div className="iv">
        <div className="iv__row">
          <span className="iv__text">{voiceNote || 'Or say it in a voice message'}</span>
          <VoiceRecorder language={language} onActive={setRecording} onFail={(_reason, note) => setVoiceNote(note)} onTranscript={(text) => {
            const spoken = parseNeedsText(text).needs
            const heard = understandInterview(text)
            const choice = heard.choice
            if (spoken.goal) setGoal(spoken.goal)
            else if (choice && choice !== 'vegan' && choice !== 'vegetarian') setGoal(choice)
            if (spoken.diet) setDiet(spoken.diet)
            else if (choice === 'vegan' || choice === 'vegetarian') setDiet(choice)
            const avoids = spoken.allergies ?? heard.allergies
            if (avoids.length) setAllergies((a) => [...new Set([...a, ...avoids])])
            if (choice || avoids.length || spoken.diet || spoken.goal) setStep('food')
            else setVoiceNote('No preferences heard. Choose above or try again.')
            track('voice_message', { context: 'interview' })
          }} />
        </div>
      </div>}

      <div className="cta-bar">
        <button className="btn btn-primary" disabled={recording} onClick={() => step === 'goal' ? setStep('food') : initial ? finish() : setStep('taste')}>
          {step === 'food' && initial ? 'Save preferences' : 'Continue'}
        </button>
      </div>
    </main>
  )
}
