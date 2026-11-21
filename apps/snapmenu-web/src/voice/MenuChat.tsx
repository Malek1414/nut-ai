import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { DishEstimate, MenuResult, Profile } from '../../../snapmenu-api/src/types'
import { sayChat } from '../../../snapmenu-api/src/voice/chat-copy'
import type { ChatTurn } from '../../../snapmenu-api/src/voice/chat-types'
import { clock, speechLocale } from '../../../snapmenu-api/src/voice/speech'
import { Icon } from '../components/ui'
import { ApiError } from '../lib/api'
import { goalLabel, kcalRange, n0, phoneLocale } from '../lib/format'
import { askMenu } from './api'
import { VIcon } from './icons'
import { canSpeak, primeVoices, speak } from './speak'
import { VoiceRecorder, type HeardClip, type VoiceClip } from './VoiceRecorder'
import './voice.css'

type Msg =
  | { id: string; role: 'user'; kind: 'text'; text: string }
  | { id: string; role: 'user'; kind: 'voice'; text: string | null; clip: VoiceClip }
  | { id: string; role: 'assistant'; text: string; dishIds: string[]; language: string }
  | { id: string; role: 'error'; text: string; retry: { message: string; via: 'voice' | 'text'; clip?: HeardClip } }

/** One conversation per scan, kept while the page lives: opening a dish and coming back does not lose it. */
const THREADS = new Map<string, Msg[]>()

const uid = () => `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

/** The static waveform of a sent voice message; bars up to `played` (0..1) are filled in while it plays. */
function Wave({ peaks, played = 0 }: { peaks: number[]; played?: number }) {
  return (
    <span className="vc-wave" aria-hidden="true">
      {peaks.map((p, i) => <i key={i} className={i / peaks.length < played ? 'is-played' : ''} style={{ height: `${Math.round(Math.max(0.14, p) * 100)}%` }} />)}
    </span>
  )
}

/** A sent voice message: play button, waveform, length, and what was said. */
function VoiceBubble({ msg }: { msg: Extract<Msg, { kind: 'voice' }> }) {
  const [played, setPlayed] = useState(0)
  const [playing, setPlaying] = useState(false)
  const audio = useRef<HTMLAudioElement | null>(null)
  const url = useRef<string | null>(null)
  const seconds = msg.clip.durationMs / 1000

  useEffect(() => () => {
    audio.current?.pause()
    if (url.current) URL.revokeObjectURL(url.current)
  }, [])

  const toggle = () => {
    if (!msg.clip.audio) return
    if (playing) { audio.current?.pause(); setPlaying(false); return }
    try {
      url.current ??= URL.createObjectURL(msg.clip.audio)
      const a = (audio.current ??= new Audio(url.current))
      a.currentTime = 0
      // A recording has no length written into it; the clip knows how long it was.
      a.ontimeupdate = () => setPlayed(Math.min(1, a.currentTime / seconds))
      a.onended = () => { setPlaying(false); setPlayed(0) }
      a.onerror = () => { setPlaying(false); setPlayed(0) }
      void a.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
    } catch {
      setPlaying(false)
    }
  }

  return (
    <div className="vc-msg vc-msg--me">
      <div className="vc-bubble vc-bubble--voice">
        <div className="vc-voice">
          <button type="button" className="vc-play" onClick={toggle} disabled={!msg.clip.audio} aria-label={playing ? 'Stop' : 'Play your voice message'}>
            <VIcon name={playing ? 'stop' : 'play'} size={18} />
          </button>
          <Wave peaks={msg.clip.peaks} played={played} />
          <span className="vc-len num">{clock(msg.clip.durationMs)}</span>
        </div>
        {msg.text === null
          ? <span className="vc-heard vc-heard--wait" role="status" aria-label="Writing down what you said"><i /><i /><i /></span>
          : <span className="vc-heard" dir="auto">{msg.text}</span>}
      </div>
    </div>
  )
}

/** The engine's numbers for a dish an answer names. These are the only numbers in the chat. */
function DishChip({ d, onOpen }: { d: DishEstimate; onOpen: () => void }) {
  const hit = d.userAllergenHits.length > 0
  return (
    <button type="button" className="vc-dish" onClick={onOpen}>
      <span className="vc-dish__text">
        <span className="vc-dish__name"><b>{d.name}</b>{hit && <span className="badge avoid"><Icon name="alert" size={12} strokeWidth={2.2} /> Allergy</span>}</span>
        <span className="vc-dish__nums num">{kcalRange(d.kcal)} kcal · {n0(d.protein.mid)} g protein</span>
      </span>
      <Icon name="chevron" size={18} />
    </button>
  )
}

export interface MenuChatProps {
  result: MenuResult
  /** The person's profile now (the goal or language may have changed since the scan). Default: the scan's own. */
  profile?: Profile | null
  onOpenDish?: (dishId: string) => void
}

/**
 * "Ask about this menu": a row under the scan results that opens a chat about
 * the scanned menu. Talk (hold the microphone) or type; the answer comes in the
 * user's language, with the engine's numbers for the dishes it names and a
 * button that reads it aloud.
 */
export function MenuChat({ result, profile: given, onOpenDish }: MenuChatProps) {
  const profile = given ?? result.profile
  const lang = profile.language
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>(() => THREADS.get(result.scanId) ?? [])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [speaking, setSpeaking] = useState<string | null>(null)
  const stopSpeaking = useRef<() => void>(() => {})
  const pane = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const pendingDish = useRef<string | null>(null)
  const msgsRef = useRef(msgs)
  msgsRef.current = msgs
  const byId = new Map(result.dishes.map((d) => [d.id, d]))

  const update = useCallback((fn: (m: Msg[]) => Msg[]) => {
    setMsgs((m) => {
      const next = fn(m)
      THREADS.set(result.scanId, next)
      return next
    })
  }, [result.scanId])

  // ---------- Open and close: the phone's back button closes the chat ----------
  const show = () => {
    try { history.pushState({ s: 'results', chat: true }, '') } catch { /* history unavailable: the close button still works */ }
    primeVoices()
    setOpen(true)
  }
  const close = () => {
    try { history.back() } catch { setOpen(false) }
  }
  useEffect(() => {
    if (!open) return
    const onPop = () => {
      setOpen(false)
      const dish = pendingDish.current
      pendingDish.current = null
      if (dish) window.setTimeout(() => onOpenDish?.(dish), 0)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !recording) close() }
    window.addEventListener('popstate', onPop)
    window.addEventListener('keydown', onKey)
    const scroll = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = scroll
      stopSpeaking.current()
    }
  }, [open, onOpenDish, recording])

  // The chat fills what is visible: when the keyboard opens, the input stays above it.
  useEffect(() => {
    const vv = window.visualViewport
    const el = pane.current
    if (!open || !vv || !el) return
    const fit = () => {
      el.style.setProperty('--vv-h', `${vv.height}px`)
      el.style.setProperty('--vv-top', `${vv.offsetTop}px`)
      scroller.current?.scrollTo({ top: scroller.current.scrollHeight })
    }
    fit()
    vv.addEventListener('resize', fit)
    vv.addEventListener('scroll', fit)
    return () => { vv.removeEventListener('resize', fit); vv.removeEventListener('scroll', fit) }
  }, [open])

  useEffect(() => {
    const el = scroller.current
    if (open && el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [open, msgs, busy])

  // ---------- Asking ----------
  const ask = useCallback(async (message: string, via: 'voice' | 'text', clip?: HeardClip) => {
    setHint(null)
    setBusy(true)
    // The turns before this one, as words: a voice message counts as what was said.
    const history: ChatTurn[] = []
    for (const m of msgsRef.current) {
      if (m.role === 'assistant') history.push({ role: 'assistant', text: m.text })
      else if (m.role === 'user' && m.text && !(clip && m.id === clip.id)) history.push({ role: 'user', text: m.text })
    }
    if (history.at(-1)?.role === 'user' && history.at(-1)?.text === message) history.pop()
    try {
      const r = await askMenu({ message, via, history: history.slice(-6), result, profile, ...(clip ? { voice: { seconds: Math.round(clip.durationMs / 1000), stt: clip.stt } } : {}) })
      update((m) => [...m.filter((x) => x.role !== 'error'), { id: uid(), role: 'assistant', text: r.reply, dishIds: r.dishIds, language: r.language }])
    } catch (e) {
      const text = e instanceof ApiError ? e.message : sayChat(lang, 'chat.failed')
      update((m) => [...m.filter((x) => x.role !== 'error'), { id: uid(), role: 'error', text, retry: { message, via, ...(clip ? { clip } : {}) } }])
    } finally {
      setBusy(false)
    }
  }, [lang, profile, result, update])

  const sendText = (text: string) => {
    const message = text.replace(/\s+/g, ' ').trim().slice(0, 500)
    if (!message || busy) return
    setDraft('')
    update((m) => [...m.filter((x) => x.role !== 'error'), { id: uid(), role: 'user', kind: 'text', text: message }])
    void ask(message, 'text')
  }

  const onClip = (clip: VoiceClip) => {
    setHint(null)
    update((m) => [...m.filter((x) => x.role !== 'error'), { id: clip.id, role: 'user', kind: 'voice', text: null, clip }])
  }
  const onTranscript = (text: string, clip: HeardClip) => {
    update((m) => m.map((x) => (x.id === clip.id && x.role === 'user' && x.kind === 'voice' ? { ...x, text, clip } : x)))
    void ask(text, 'voice', clip)
  }
  const onFail = (_why: string, message: string, clip: VoiceClip | null) => {
    if (clip) update((m) => m.filter((x) => x.id !== clip.id))
    setHint(message)
  }

  const read = (m: Extract<Msg, { role: 'assistant' }>) => {
    stopSpeaking.current()
    if (speaking === m.id) { setSpeaking(null); return }
    // The answer, then the engine's numbers for the dishes it names, in the same language.
    const numbers = m.dishIds.map((id) => byId.get(id)).filter((d): d is DishEstimate => Boolean(d))
      .map((d) => sayChat(m.language, 'chat.numbers', { dish: d.name, low: d.kcal.low, high: d.kcal.high, protein: d.protein.mid }))
    setSpeaking(m.id)
    stopSpeaking.current = speak([m.text, ...numbers].join(' '), speechLocale(m.language, phoneLocale()), () => setSpeaking((cur) => (cur === m.id ? null : cur)))
  }

  const openDish = (id: string) => {
    if (!onOpenDish) return
    pendingDish.current = id
    close()
  }

  const asked = msgs.some((m) => m.role === 'user')
  const typed = draft.trim().length > 0

  return (
    <>
      <button type="button" className="vc-entry" onClick={show}>
        <span className="vc-entry__ic"><VIcon name="mic" size={20} /></span>
        <b>Ask about this menu</b>
        <Icon name="chevron" size={18} />
      </button>

      {open && createPortal(
        <div ref={pane} className="vc" role="dialog" aria-modal="true" aria-label="Ask about this menu">
          <header className="vc-head">
            <button type="button" className="icon-btn" onClick={close} aria-label="Close"><Icon name="chevronDown" /></button>
            <div className="vc-head__text">
              <b>Ask about this menu</b>
              <span className="small">{[result.restaurant, goalLabel(profile)].filter(Boolean).join(' · ')}</span>
            </div>
            <span style={{ width: 44 }} />
          </header>

          <div ref={scroller} className="vc-scroll">
            <div className="vc-msg">
              <div className="vc-bubble" dir="auto">{sayChat(lang, 'chat.hello')}</div>
            </div>

            {msgs.map((m) => {
              if (m.role === 'user' && m.kind === 'voice') return <VoiceBubble key={m.id} msg={m} />
              if (m.role === 'user') return <div key={m.id} className="vc-msg vc-msg--me"><div className="vc-bubble" dir="auto">{m.text}</div></div>
              if (m.role === 'error') {
                return (
                  <div key={m.id} className="vc-msg">
                    <div className="vc-bubble vc-bubble--error" role="alert">
                      <span>{m.text}</span>
                      <button type="button" className="vc-retry" disabled={busy} onClick={() => { update((x) => x.filter((y) => y.id !== m.id)); void ask(m.retry.message, m.retry.via, m.retry.clip) }}>
                        <VIcon name="retry" size={16} /> Try again
                      </button>
                    </div>
                  </div>
                )
              }
              const dishes = m.dishIds.map((id) => byId.get(id)).filter((d): d is DishEstimate => Boolean(d))
              return (
                <div key={m.id} className="vc-msg">
                  <div className="vc-bubble" dir="auto" lang={speechLocale(m.language)}>{m.text}</div>
                  {dishes.length > 0 && (
                    <div className="vc-dishes">
                      {dishes.map((d) => <DishChip key={d.id} d={d} onOpen={() => openDish(d.id)} />)}
                    </div>
                  )}
                  {canSpeak() && (
                    <button type="button" className="vc-listen" onClick={() => read(m)} aria-pressed={speaking === m.id} aria-label={speaking === m.id ? 'Stop reading' : 'Read the answer aloud'}>
                      <VIcon name={speaking === m.id ? 'stop' : 'play'} size={16} /> {speaking === m.id ? 'Stop' : 'Listen'}
                    </button>
                  )}
                </div>
              )
            })}

            {busy && <div className="vc-msg"><div className="vc-bubble vc-typing" role="status" aria-label="Writing an answer"><i /><i /><i /></div></div>}

            {!asked && !busy && (
              <div className="vc-asks">
                {(['chat.ask.light', 'chat.ask.protein', 'chat.ask.change'] as const).map((k) => (
                  <button key={k} type="button" className="vc-ask" onClick={() => sendText(sayChat(lang, k))}>{sayChat(lang, k)}</button>
                ))}
              </div>
            )}
          </div>

          <footer className="vc-foot">
            {hint
              ? <p className="vc-hint" role="status">{hint}</p>
              : !asked && <p className="vc-hint vc-hint--quiet" data-off={recording}>Hold the mic to talk. Estimates, not a guarantee.</p>}
            <form className="vc-composer" onSubmit={(e) => { e.preventDefault(); sendText(draft) }}>
              <input
                className="vc-input"
                dir="auto"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Ask anything"
                aria-label="Your question"
                maxLength={500}
                enterKeyHint="send"
                autoComplete="off"
                tabIndex={recording ? -1 : 0}
              />
              {typed
                ? <button type="submit" className="vc-send" disabled={busy} aria-label="Send"><Icon name="send" size={22} /></button>
                : <VoiceRecorder language={lang} disabled={busy} onClip={onClip} onTranscript={onTranscript} onFail={onFail} onActive={setRecording} />}
            </form>
          </footer>
        </div>,
        document.body,
      )}
    </>
  )
}
