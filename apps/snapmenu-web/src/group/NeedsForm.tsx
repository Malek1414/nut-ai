// One person's needs in a few taps: diet, allergies, goal, budget. Or said in one sentence
// (typed, dictated, or the transcript of a voice message), which fills the same chips.
import { useEffect, useRef, useState } from 'react'
import { parseNeedsText, worthAsking } from '../../../snapmenu-api/src/group/needs'
import type { Diet, GroupGoal, Needs } from '../../../snapmenu-api/src/group/types'
import { Icon, Wordmark } from '../components/ui'
import { VoiceRecorder } from '../voice/VoiceRecorder'
import { track } from '../lib/api'
import { ALLERGY_OPTIONS, allergyName } from '../lib/format'
import { readNeedsText, type ParsedNeeds } from './api'

const DIETS: Array<{ id: Diet; label: string }> = [{ id: 'any', label: 'Anything' }, { id: 'vegetarian', label: 'Vegetarian' }, { id: 'vegan', label: 'Vegan' }]
const GOALS: Array<{ id: GroupGoal; label: string }> = [{ id: 'balanced', label: 'Balanced' }, { id: 'lose_fat', label: 'Lose fat' }, { id: 'build_muscle', label: 'High protein' }]
const BUDGETS = [10, 15, 20, 30]
/** The allergies most people have come first; the rest wait behind "More". */
const COMMON = 8

/** "Vegan · no tree nuts · max 10 €": a person's limits on one line. */
export function needsLine(n: Needs): string {
  return [
    n.diet === 'vegan' ? 'Vegan' : n.diet === 'vegetarian' ? 'Vegetarian' : '',
    ...n.allergies.map((a) => `no ${allergyName(a)}`),
    n.budget !== null ? `max ${n.budget} €` : '',
    n.goal !== 'balanced' ? GOALS.find((g) => g.id === n.goal)!.label : '',
  ].filter(Boolean).join(' · ')
}

/** What a sentence was understood as, for the line under the box. */
function heardLine(found: Partial<Needs>, all: Needs): string {
  if (Object.keys(found).length === 0) return ''
  return [found.diet === 'any' ? 'Eats anything' : '', needsLine(all) || 'Balanced'].filter(Boolean).join(' · ')
}

export function NeedsForm({ title, lead, initial, submitLabel, busy, error, onSubmit, onBack, onRemove }: {
  title: string
  lead?: string | undefined
  initial: { name: string; needs: Needs }
  submitLabel: string
  busy: boolean
  error: string | null
  onSubmit: (name: string, needs: Needs) => void
  onBack?: (() => void) | undefined
  onRemove?: (() => void) | undefined
}) {
  const [name, setName] = useState(initial.name)
  const [needs, setNeedsState] = useState<Needs>(initial.needs)
  // The latest needs, for a reading that comes back after a tap changed them.
  const needsRef = useRef(needs)
  const setNeeds = (n: Needs) => { needsRef.current = n; setNeedsState(n) }
  const [said, setSaid] = useState('')
  const [reading, setReading] = useState(false)
  const [recording, setRecording] = useState(false)
  const [spoken, setSpoken] = useState(false)
  const [voiceHint, setVoiceHint] = useState<string | null>(null)
  const [heard, setHeard] = useState<{ ok: boolean; text: string } | null>(null)
  const [more, setMore] = useState(() => initial.needs.allergies.some((a) => ALLERGY_OPTIONS.findIndex((o) => o.id === a) >= COMMON))
  const nameRef = useRef<HTMLInputElement>(null)
  const live = useRef(true)
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])

  const set = (patch: Partial<Needs>) => setNeeds({ ...needsRef.current, ...patch })
  const toggleAllergy = (id: string) => {
    const n = needsRef.current
    setNeeds({ ...n, allergies: n.allergies.includes(id) ? n.allergies.filter((a) => a !== id) : [...n.allergies, id] })
  }

  /** What was understood goes into the chips, where the person sees it and can change it. */
  const apply = (p: ParsedNeeds) => {
    const n = needsRef.current
    const next: Needs = { ...n, ...p.needs, allergies: [...new Set([...n.allergies, ...(p.needs.allergies ?? [])])] }
    setNeeds(next)
    if (next.allergies.some((a) => ALLERGY_OPTIONS.findIndex((o) => o.id === a) >= COMMON)) setMore(true)
    const line = heardLine(p.needs, next)
    setHeard((cur) => (line ? { ok: true, text: line } : cur?.ok ? cur : { ok: false, text: 'Nothing about food in that. Tap below instead.' }))
    if (p.name) setName((cur) => cur || p.name!)
  }

  const understand = (raw: string) => {
    const text = raw.trim()
    if (text.length < 2 || reading) return
    // The word rules answer at once; the model reads the same sentence on top when it is worth it.
    const quick = parseNeedsText(text)
    setVoiceHint(null)
    setHeard(null)
    apply(quick)
    if (Object.keys(quick.needs).length > 0 || !worthAsking(text, quick)) return
    setReading(true)
    readNeedsText(text).then((p) => { if (live.current) apply(p) }).catch(() => { /* the quick reading stands */ }).finally(() => { if (live.current) setReading(false) })
  }

  const submit = () => {
    const n = name.trim()
    if (!n) { nameRef.current?.focus(); return }
    onSubmit(n, needs)
  }
  const budgets = needs.budget !== null && !BUDGETS.includes(needs.budget) ? [...BUDGETS, needs.budget].sort((a, b) => a - b) : BUDGETS
  const allergies = more ? ALLERGY_OPTIONS : ALLERGY_OPTIONS.slice(0, COMMON)

  return (
    <main className="screen with-cta g-form">
      <div className="topbar">
        {onBack ? <button className="icon-btn" onClick={onBack} aria-label="Back"><Icon name="back" /></button> : <Wordmark onClick={() => window.location.assign('/')} />}
        {onRemove && <button className="link-btn" onClick={onRemove} disabled={busy}>Remove</button>}
      </div>

      <header className="g-form__head">
        <h1 className="h1">{title}</h1>
        {lead && <p className="body">{lead}</p>}
      </header>

      <input ref={nameRef} className="input g-name" value={name} onChange={(e) => setName(e.target.value.slice(0, 24))} placeholder="First name" aria-label="First name" autoComplete="given-name" autoCapitalize="words" enterKeyHint="done" />

      <div className="g-say">
        <input
          className="g-say__input" value={said} readOnly={recording} onChange={(e) => { setSaid(e.target.value.slice(0, 600)); setSpoken(false) }} enterKeyHint="go"
          onKeyDown={(e) => { if (e.key === 'Enter' && !recording) understand(said) }}
          placeholder="Say or type what you eat" aria-label="Say what you eat in one sentence"
        />
        {said.trim().length > 1 && !spoken && !recording
          ? <button className="g-say__go" onClick={() => understand(said)} disabled={reading} aria-label="Fill in from this sentence">{reading ? <span className="attach__spin" /> : <Icon name="arrow" size={18} />}</button>
          : <VoiceRecorder disabled={busy || reading} onActive={(active) => { setRecording(active); if (active) setVoiceHint(null) }}
            onTranscript={(text, clip) => {
              setSpoken(true); setSaid(text.slice(0, 600)); understand(text)
              track('voice_message', { context: 'group', seconds: Math.round(clip.durationMs / 1000) })
            }} onFail={(_why, message) => setVoiceHint(message)} />}
      </div>
      {voiceHint && <p className="small g-error" role="status">{voiceHint}</p>}
      {heard && <p className={`g-heard ${heard.ok ? '' : 'g-heard--none'}`} role="status">{heard.ok && <Icon name="check" size={14} strokeWidth={2.5} />} {spoken && 'Voice message · '}{heard.text}</p>}

      <section className="g-field" aria-labelledby="g-diet">
        <h2 id="g-diet" className="eyebrow">I eat</h2>
        <div className="g-seg" role="radiogroup" aria-labelledby="g-diet">
          {DIETS.map((d) => <button key={d.id} role="radio" aria-checked={needs.diet === d.id} className="g-seg__opt" onClick={() => set({ diet: d.id })}>{d.label}</button>)}
        </div>
      </section>

      <section className="g-field" aria-labelledby="g-allergy">
        <h2 id="g-allergy" className="eyebrow">Allergies</h2>
        <div className="g-chips" role="group" aria-labelledby="g-allergy">
          {allergies.map((a) => (
            <button key={a.id} className="g-chip g-chip--alert" aria-pressed={needs.allergies.includes(a.id)} title={a.hint} onClick={() => toggleAllergy(a.id)}>{a.label.split(' /')[0]}</button>
          ))}
          {!more && <button className="g-chip g-chip--more" onClick={() => setMore(true)}>More</button>}
        </div>
      </section>

      <section className="g-field" aria-labelledby="g-goal">
        <h2 id="g-goal" className="eyebrow">Goal</h2>
        <div className="g-seg" role="radiogroup" aria-labelledby="g-goal">
          {GOALS.map((g) => <button key={g.id} role="radio" aria-checked={needs.goal === g.id} className="g-seg__opt" onClick={() => set({ goal: g.id })}>{g.label}</button>)}
        </div>
      </section>

      <section className="g-field" aria-labelledby="g-budget">
        <h2 id="g-budget" className="eyebrow">Budget for my dish</h2>
        <div className="g-seg" role="radiogroup" aria-labelledby="g-budget" style={{ gridTemplateColumns: `repeat(${budgets.length + 1}, 1fr)` }}>
          <button className="g-seg__opt" role="radio" aria-checked={needs.budget === null} onClick={() => set({ budget: null })}>Any</button>
          {budgets.map((b) => <button key={b} className="g-seg__opt num" role="radio" aria-checked={needs.budget === b} onClick={() => set({ budget: b })}>{b} €</button>)}
        </div>
      </section>

      {error && <p className="small g-error" role="alert">{error}</p>}

      <div className="cta-bar">
        <button className="btn btn-primary" onClick={submit} disabled={busy || recording || reading || !name.trim()}>{busy ? 'Saving…' : submitLabel}</button>
      </div>
    </main>
  )
}
