import { useEffect, useRef, useState } from 'react'
import type { NearbyAnswer } from '../../../snapmenu-api/src/group/types'
import { dietOf, type Profile } from '../../../snapmenu-api/src/types'
import { AudioLines } from 'lucide-react'
import { Icon } from '../components/ui'
import { needsLine } from '../group/NeedsForm'
import { track } from '../lib/api'
import { kcalRange, n0 } from '../lib/format'
import { formatDistance, getPosition, requestPosition } from '../lib/position'
import { store } from '../lib/storage'
import { PickMap } from '../map/PickMap'
import { VoiceRecorder } from '../voice/VoiceRecorder'
import { VIcon } from '../voice/icons'
import './nearby-ask.css'

interface Message { text: string; spoken: boolean }

export function NearbyAsk({ profile, onBack, onScan }: { profile: Profile | null; onBack: () => void; onScan: () => void }) {
  const [draft, setDraft] = useState('')
  const [message, setMessage] = useState<Message | null>(null)
  const [answer, setAnswer] = useState<NearbyAnswer | null>(null)
  const [needLocation, setNeedLocation] = useState(false)
  const [busy, setBusy] = useState(false)
  const [recording, setRecording] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const request = useRef<AbortController | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const [retry, setRetry] = useState<{ msg: Message; example: boolean } | null>(null)
  const footer = useRef<HTMLDivElement>(null)
  useEffect(() => () => request.current?.abort(), [])
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const fit = () => footer.current?.style.setProperty('--keyboard', `${Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)}px`)
    fit()
    viewport.addEventListener('resize', fit)
    viewport.addEventListener('scroll', fit)
    return () => { viewport.removeEventListener('resize', fit); viewport.removeEventListener('scroll', fit) }
  }, [])

  async function ask(msg: Message, example = false, locate = false) {
    if (request.current) return
    const ctrl = new AbortController()
    request.current = ctrl
    setDraft(''); setHint(null); setRetry(null); input.current?.blur(); setMessage(msg); setAnswer(null); setNeedLocation(false); setBusy(true)
    try {
      let pos = getPosition()
      if (!example && pos.status !== 'granted' && (locate || !pos.asked)) pos = await requestPosition()
      if (ctrl.signal.aborted) return
      if (!example && pos.status !== 'granted') { setNeedLocation(true); return }
      const res = await fetch('/api/nearby-pick', {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: ctrl.signal,
        body: JSON.stringify({ message: msg.text, ...(example ? { example } : pos.position), language: store.language(),
          profile: profile && { diet: dietOf(profile), allergies: profile.allergies, goal: profile.goal } }),
      })
      if (!res.ok) throw new Error('Lookup failed')
      const data: NearbyAnswer = await res.json()
      if (!ctrl.signal.aborted) setAnswer(data)
    } catch {
      if (!ctrl.signal.aborted) { setRetry({ msg, example }); setHint('Couldn’t find a dish right now.') }
    } finally {
      request.current = null
      if (!ctrl.signal.aborted) setBusy(false)
    }
  }

  const match = answer?.match
  const pick = match?.results[0]?.pick
  const dish = pick?.dish
  const constraints = answer && needsLine(answer.needs)
  const typed = draft.trim()
  return (
    <main className="screen with-cta nearby-ask">
      <div className="topbar"><button type="button" className="icon-btn" onClick={onBack} aria-label="Back"><Icon name="back" /></button><span className="eyebrow">Nearby picks</span><AudioLines size={23} className="nearby-ask__glyph" /></div>
      <header className="nearby-ask__head">
        <h1 className="h1">Ask for a dish</h1>
        {!message && <p className="lead">Say or type your goal, diet or budget.</p>}
      </header>
        {!message && <section className="nearby-suggestions" aria-label="Request ideas">
          <h2 className="eyebrow">Try asking</h2>
          {[{ icon: 'muscle', text: 'Something high in protein under 15 euros' }, { icon: 'leaf', text: 'A vegetarian lunch nearby' }, { icon: 'euro', text: 'Dinner for less than 10 euros' }].map(({ icon, text }) => <button key={text} onClick={() => { setDraft(text); input.current?.focus() }}><Icon name={icon} size={20} /><span>{text}</span><Icon name="chevron" size={16} /></button>)}
        </section>}
      {message && <div className="nearby-ask__message">{message.spoken && <span className="vc-voice"><VIcon name="mic" size={16} /> Voice message</span>}<span dir="auto">{message.text}</span></div>}
      {busy && <div className="nearby-ask__loading" role="status" aria-label="Finding a dish"><i className="skeleton" /><i className="skeleton" /><i className="skeleton" /></div>}
      {needLocation && message && (
        <div className="card nearby-ask__answer">
          <h2 className="h3">Where should we look?</h2>
          <button className="btn btn-primary" onClick={() => void ask(message, false, true)}><Icon name="locate" /> Use my location</button>
          <button className="link-btn" onClick={() => void ask(message, true)}>Try Berlin Mitte</button>
        </div>
      )}
      {answer && match && pick && dish && (
        <article className="card nearby-ask__answer">
          <p className="eyebrow">{answer.area === 'berlin' ? 'Berlin Mitte' : 'Best nearby pick'}{dish.example && <span className="example-badge">Example menu</span>}</p>
          <h2 className="h2">{dish.name}</h2>
          <p className="small">{match.place.name} · {formatDistance(match.distanceM)}{dish.price ? ` · ${dish.price}` : ''}</p>
          <p className="nearby-ask__stats num">{kcalRange(dish.kcal)} kcal · {n0(dish.protein)} g protein <span>Estimates</span></p>
          <p className="small">{n0(dish.carbs)} g carbs · {n0(dish.fat)} g fat</p>
          <p className="body">{pick.why}</p>
          {constraints && <p className="small">Matched on: {constraints}</p>}
          {answer.needs.allergies.length > 0 && <p className="small">Always confirm ingredients and cross-contact with staff.</p>}
          <PickMap place={match.place} label="Your pick" example={dish.example} />
        </article>
      )}
      {answer?.reason === 'not_understood' && (
        <div className="card nearby-ask__answer" role="status">
          <h2 className="h3">What should the dish fit?</h2>
          <p className="body">Try a goal, diet or budget, like “vegetarian under 15 euros”.</p>
        </div>
      )}
      {answer && !match && answer.reason !== 'not_understood' && (
        <div className="card nearby-ask__answer">
          <h2 className="h3">{answer.reason === 'no_fit' ? 'No matching dish found' : 'No scanned menus here yet'}</h2>
          {constraints && <p className="small">Looking for: {constraints}</p>}
          <button className="btn btn-primary" onClick={onScan}><Icon name="camera" /> Scan a menu</button>
          {answer.area === 'local' && message && <button className="link-btn" onClick={() => void ask(message, true)}>Try Berlin Mitte</button>}
        </div>
      )}
      <div className="cta-bar nearby-ask__footer" ref={footer}>
        {hint && <div className="nearby-ask__hint" role="status"><span>{hint}</span>{retry && <button className="link-btn" onClick={() => void ask(retry.msg, retry.example)}>Retry</button>}</div>}
        <form className="vc-composer" onSubmit={(e) => { e.preventDefault(); if (typed && !busy) void ask({ text: typed, spoken: false }) }}>
          <input ref={input} className="vc-input" value={draft} maxLength={600} onChange={(e) => setDraft(e.target.value)} readOnly={recording} placeholder="Say or type a request" aria-label="Your request" enterKeyHint="send" autoComplete="off" />
          {typed && !recording
            ? <button type="submit" className="vc-send" disabled={busy} aria-label="Send request"><Icon name="send" size={22} /></button>
            : <VoiceRecorder disabled={busy} onActive={(active) => { setRecording(active); if (active) setHint(null) }} onTranscript={(text, clip) => {
              track('voice_message', { context: 'nearby', seconds: Math.round(clip.durationMs / 1000) })
              void ask({ text: text.slice(0, 600), spoken: true })
            }} onFail={(_why, note) => { setHint(note); input.current?.focus() }} />}
        </form>
      </div>
    </main>
  )
}
