import { useState, type FormEvent } from 'react'
import { cleanWord, CUISINES, foodLabel, FOODS } from '../../../snapmenu-api/src/me/taste'
import type { Taste } from '../../../snapmenu-api/src/me/types'
import { Icon } from '../components/ui'
import { track } from '../lib/api'
import { me } from './store'

type Step = 'cuisines' | 'likes' | 'dislikes'
const STEPS: Step[] = ['cuisines', 'likes', 'dislikes']
const HEAD: Record<Step, string> = { cuisines: 'Which food do you love?', likes: 'What do you like?', dislikes: 'Anything you skip?' }

/**
 * Three quick questions, asked only after a first result and each one skippable:
 * cuisines, likes, dislikes. Taps are saved as they happen.
 */
export function TasteEditor({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>('cuisines')
  const [taste, setTaste] = useState<Taste>(() => me.get().taste)
  const [word, setWord] = useState('')
  const at = STEPS.indexOf(step)

  const save = (next: Taste) => { setTaste(next); me.setTaste(next) }
  const toggle = (id: string) => {
    const has = taste[step].includes(id)
    const next: Taste = { ...taste, [step]: has ? taste[step].filter((x) => x !== id) : [...taste[step], id] }
    // A food is liked or skipped, never both.
    if (!has && step === 'likes') next.dislikes = next.dislikes.filter((x) => x !== id)
    if (!has && step === 'dislikes') next.likes = next.likes.filter((x) => x !== id)
    save(next)
  }
  const addWord = (e: FormEvent) => {
    e.preventDefault()
    const w = cleanWord(word)
    if (!w || step === 'cuisines') return
    if (!taste[step].some((x) => foodLabel(x).toLowerCase() === w.toLowerCase())) save({ ...taste, [step]: [...taste[step], w] })
    setWord('')
  }
  const finish = () => {
    me.tasteDone()
    track('me_taste', { cuisines: taste.cuisines.length, likes: taste.likes.length, dislikes: taste.dislikes.length })
    onDone()
  }
  const next = () => (at < STEPS.length - 1 ? setStep(STEPS[at + 1]!) : finish())
  const back = () => (at === 0 ? onDone() : setStep(STEPS[at - 1]!))

  const options = step === 'cuisines' ? CUISINES : FOODS
  const own = step === 'cuisines' ? [] : taste[step].filter((x) => !FOODS.some((f) => f.id === x))
  return (
    <main className="screen with-cta me-screen">
      <div className="topbar">
        <button className="icon-btn" onClick={back} aria-label="Back"><Icon name="back" /></button>
        <div className="steps" role="progressbar" aria-valuenow={at + 1} aria-valuemin={1} aria-valuemax={3} aria-label={`Step ${at + 1} of 3`}>
          {STEPS.map((x, i) => <i key={x} className={i <= at ? 'is-on' : ''} />)}
        </div>
        <button className="link-btn" onClick={next}>Skip</button>
      </div>

      <div key={step} className="rise">
        <h1 className="h1 q-head">{HEAD[step]}</h1>
        <div className="me-chips" role="group" aria-label={HEAD[step]}>
          {options.map((o) => (
            <button key={o.id} type="button" className={`me-chip ${step === 'dislikes' ? 'me-chip--no' : ''}`} role="checkbox" aria-checked={taste[step].includes(o.id)} onClick={() => toggle(o.id)}>{o.label}</button>
          ))}
          {own.map((w) => (
            <button key={w} type="button" className={`me-chip ${step === 'dislikes' ? 'me-chip--no' : ''}`} role="checkbox" aria-checked="true" onClick={() => toggle(w)}>{w}</button>
          ))}
        </div>
        {step !== 'cuisines' && (
          <form className="me-type me-type--add" onSubmit={addWord}>
            <input className="input" value={word} onChange={(e) => setWord(e.target.value)} maxLength={24} placeholder="Add your own" aria-label="Add your own" enterKeyHint="done" autoComplete="off" />
            <button className="me-type__go" type="submit" disabled={!cleanWord(word)} aria-label="Add"><Icon name="plus" size={20} strokeWidth={2.2} /></button>
          </form>
        )}
      </div>

      <div className="cta-bar">
        <button className="btn btn-primary" onClick={next}>{at < STEPS.length - 1 ? 'Continue' : 'Done'}</button>
      </div>
    </main>
  )
}
