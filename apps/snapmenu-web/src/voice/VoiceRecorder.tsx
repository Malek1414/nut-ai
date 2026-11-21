import { useCallback, useEffect, useRef, useState } from 'react'
import { sayChat } from '../../../snapmenu-api/src/voice/chat-copy'
import { clock, compressPeaks, isPhone, speechLocale, sttPlan } from '../../../snapmenu-api/src/voice/speech'
import { Icon } from '../components/ui'
import { ApiError } from '../lib/api'
import { phoneLocale } from '../lib/format'
import { store } from '../lib/storage'
import { loadVoiceConfig, maxClipSeconds, serverStt, transcribeClip } from './api'
import { canCapture, canRecord, startCapture, wakeAudio, type Capture } from './capture'
import { VIcon } from './icons'
import { canRecognise, listen, type Listening } from './recognition'
import './voice.css'

/** One voice message: how long it was, its waveform as bar heights (0..1), and the recording when the browser made one. */
export interface VoiceClip {
  id: string
  durationMs: number
  peaks: number[]
  audio: Blob | null
}

/** A clip with its words, and who wrote them down: the browser's recognition or the Worker. */
export type HeardClip = VoiceClip & { stt: 'browser' | 'server' }

export type VoiceFailure = 'denied' | 'unsupported' | 'unheard' | 'off' | 'limit' | 'offline'

export interface VoiceRecorderProps {
  /** The words of a voice message, once they are known. */
  onTranscript: (text: string, clip: HeardClip) => void
  /** The message as a clip, the moment the finger lifts: a chat shows its bubble before the words arrive. */
  onClip?: (clip: VoiceClip) => void
  /** No words came out of it. `message` is in the user's language and says to type instead. */
  onFail?: (why: VoiceFailure, message: string, clip: VoiceClip | null) => void
  /** Recording started or ended. */
  onActive?: (active: boolean) => void
  /** The language the person talks in ("German"). Default: the one saved in the interview, else the phone's. */
  language?: string
  disabled?: boolean
}

type Phase = 'idle' | 'asking' | 'hold' | 'locked'

/** Slide this far left to cancel, this far up to lock. */
const CANCEL_AT = 96
const LOCK_AT = 56
/** A press shorter than this is a tap: the recording stays on, hands-free. */
const TAP_MS = 400
const BARS = 56

const reducedMotion = (): boolean => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}
const buzz = (ms: number) => { try { navigator.vibrate?.(ms) } catch { /* no haptics here */ } }

/**
 * The microphone button of a chat: hold to record, slide left to cancel,
 * release to send. A tap (or a slide up) locks the recording so it runs
 * hands-free, with its own send and delete buttons. While it records, a bar
 * with a running timer and a waveform of the real microphone level covers the
 * row the button sits in, so put it inside a `position: relative` row.
 *
 *   <VoiceRecorder onTranscript={(text) => setText(text)} />
 *
 * The words come from the browser's own speech recognition where it can listen
 * alongside the recording, else from the Worker (free Whisper allocation). When
 * neither works, `onFail` says so and the typed input is all the person needs.
 */
export function VoiceRecorder({ onTranscript, onClip, onFail, onActive, language, disabled }: VoiceRecorderProps) {
  const [phase, setPhaseState] = useState<Phase>('idle')
  const [armed, setArmed] = useState(false)
  const phaseRef = useRef<Phase>('idle')
  const press = useRef({ down: false, x: 0, y: 0, at: 0 })
  const capture = useRef<Capture | null>(null)
  const listening = useRef<Listening | null>(null)
  const plan = useRef<ReturnType<typeof sttPlan>>({ mode: 'none', backup: false })
  const armedRef = useRef(false)
  const alive = useRef(true)
  const frame = useRef(0)
  const root = useRef<HTMLDivElement>(null)
  const timeEl = useRef<HTMLSpanElement>(null)
  const barsEl = useRef<HTMLDivElement>(null)
  const cb = useRef({ onTranscript, onClip, onFail, onActive })
  cb.current = { onTranscript, onClip, onFail, onActive }
  /** The newest `finish` and release handler, for the drawing loop and the window's own pointer events. */
  const finishRef = useRef<() => void>(() => {})
  const releaseRef = useRef<() => void>(() => {})

  const lang = language ?? store.language()

  const setPhase = useCallback((p: Phase) => {
    const was = phaseRef.current
    phaseRef.current = p
    setPhaseState(p)
    const active = p === 'hold' || p === 'locked'
    if (active !== (was === 'hold' || was === 'locked')) cb.current.onActive?.(active)
  }, [])

  const fail = useCallback((why: VoiceFailure, clip: VoiceClip | null, message?: string) => {
    const key = why === 'denied' ? 'voice.denied' : why === 'limit' ? 'voice.slow' : why === 'offline' ? 'chat.offline' : why === 'unheard' ? 'voice.unheard' : 'voice.off'
    cb.current.onFail?.(why, message ?? sayChat(lang, key), clip)
  }, [lang])

  // ---------- The live waveform, timer and level ring: drawn straight to the DOM, 60 times a second ----------
  const draw = useCallback(() => {
    const c = capture.current
    const el = root.current
    if (!c || !el) return
    const calm = reducedMotion()
    let last = 0
    const loop = (t: number) => {
      if (capture.current !== c) return
      frame.current = requestAnimationFrame(loop)
      // With reduced motion the picture changes four times a second instead of gliding.
      if (calm && t - last < 250) return
      last = t
      const elapsed = Date.now() - c.startedAt
      if (timeEl.current) timeEl.current.textContent = clock(elapsed)
      const bars = barsEl.current?.children
      if (bars) {
        const n = bars.length
        const from = c.levels.length - n
        for (let i = 0; i < n; i++) {
          const v = from + i >= 0 ? c.levels[from + i] ?? 0 : 0
          ;(bars[i] as HTMLElement).style.transform = `scaleY(${Math.max(0.08, v).toFixed(3)})`
        }
      }
      el.style.setProperty('--lvl', calm ? '0' : c.level().toFixed(3))
      if (elapsed >= maxClipSeconds() * 1000) finishRef.current()
    }
    frame.current = requestAnimationFrame(loop)
  }, [])

  const reset = () => {
    cancelAnimationFrame(frame.current)
    armedRef.current = false
    setArmed(false)
    root.current?.style.setProperty('--dx', '0px')
    root.current?.style.setProperty('--drag', '0')
    root.current?.style.setProperty('--lvl', '0')
  }

  const cancel = useCallback(() => {
    capture.current?.cancel()
    capture.current = null
    listening.current?.abort()
    listening.current = null
    reset()
    setPhase('idle')
    buzz(14)
  }, [setPhase])

  const finish = useCallback(async () => {
    const c = capture.current
    if (!c) return
    capture.current = null
    const live = listening.current
    listening.current = null
    const durationMs = Date.now() - c.startedAt
    const levels = [...c.levels]
    reset()
    setPhase('idle')
    // Too short to hold a word: nothing is sent, nothing is said about it.
    if (durationMs < 350) { c.cancel(); live?.abort(); return }
    buzz(8)
    const clip: VoiceClip = { id: `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, durationMs, peaks: compressPeaks(levels, 36), audio: null }
    cb.current.onClip?.(clip)

    const [audio, heard] = await Promise.all([c.stop(), live ? live.finish() : Promise.resolve('')])
    clip.audio = audio
    if (heard) { cb.current.onTranscript(heard, { ...clip, stt: 'browser' }); return }
    // Nothing above the noise floor reached the microphone: no upload for silence.
    if (c.metered && levels.length > 6 && Math.max(...levels) < 0.12) { fail('unheard', clip); return }
    const p = plan.current
    if (audio && (p.mode === 'server' || p.backup) && serverStt() !== 'no') {
      try {
        const text = await transcribeClip(audio, durationMs / 1000, lang)
        cb.current.onTranscript(text, { ...clip, stt: 'server' })
      } catch (e) {
        const code = e instanceof ApiError ? e.code : 'unheard'
        fail(code === 'stt_off' ? 'off' : code === 'rate_limited' ? 'limit' : code === 'offline' ? 'offline' : 'unheard', clip, e instanceof ApiError ? e.message : undefined)
      }
      return
    }
    fail(p.mode === 'live' ? 'unheard' : 'off', clip)
  }, [fail, lang, setPhase])
  finishRef.current = () => void finish()

  const begin = useCallback(async (handsFree: boolean) => {
    if (phaseRef.current !== 'idle' || disabled) return
    if (!canCapture()) { fail('unsupported', null); return }
    // Inside the tap: iOS starts audio only from a gesture, and the permission prompt below is an await.
    const ctx = wakeAudio()
    setPhase('asking')
    // Usually answered already (asked when the button appeared); never wait long for it.
    await Promise.race([loadVoiceConfig(), new Promise((r) => window.setTimeout(r, 500))])
    const p = sttPlan({ recognition: canRecognise(), recorder: canRecord(), phone: isPhone(navigator.userAgent, navigator.maxTouchPoints), server: serverStt() })
    if (p.mode === 'none') { setPhase('idle'); fail('off', null); return }
    let c: Capture
    try {
      c = await startCapture(ctx)
    } catch (e) {
      setPhase('idle')
      const name = (e as { name?: string } | null)?.name
      fail(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unsupported', null)
      return
    }
    if (!alive.current) { c.cancel(); return }
    capture.current = c
    plan.current = p
    if (p.mode === 'live') listening.current = listen(speechLocale(lang, phoneLocale()))
    buzz(10)
    // The finger may have lifted while the browser asked for the microphone: then the recording runs hands-free.
    setPhase(!handsFree && press.current.down ? 'hold' : 'locked')
    draw()
  }, [disabled, draw, fail, lang, setPhase])

  // ---------- The gesture ----------
  const onDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button > 0 || phaseRef.current !== 'idle' || disabled) return
    e.preventDefault()
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* older browsers */ }
    press.current = { down: true, x: e.clientX, y: e.clientY, at: Date.now() }
    void begin(false)
  }
  const onMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!press.current.down || phaseRef.current !== 'hold') return
    const dx = Math.min(0, e.clientX - press.current.x)
    const dy = e.clientY - press.current.y
    root.current?.style.setProperty('--dx', `${Math.max(-CANCEL_AT - 24, dx)}px`)
    root.current?.style.setProperty('--drag', Math.min(1, -dx / CANCEL_AT).toFixed(2))
    const nowArmed = dx <= -CANCEL_AT
    if (nowArmed !== armedRef.current) { armedRef.current = nowArmed; setArmed(nowArmed); buzz(6) }
    if (!nowArmed && dy <= -LOCK_AT) lock()
  }
  const lock = () => {
    press.current.down = false
    reset()
    setPhase('locked')
    buzz(10)
    draw()
  }
  const onUp = () => {
    if (!press.current.down) return
    press.current.down = false
    if (phaseRef.current !== 'hold') return
    if (armedRef.current) cancel()
    else if (Date.now() - press.current.at < TAP_MS || Date.now() - (capture.current?.startedAt ?? 0) < 350) lock()
    else void finish()
  }
  releaseRef.current = onUp
  /** The system took the touch away (a call, a gesture): keep the recording, never send it by accident. */
  const onLost = () => {
    if (!press.current.down) return
    if (phaseRef.current === 'hold') lock()
    else press.current.down = false
  }
  /** Keyboard and screen readers arrive as a click without a pointer: record hands-free. */
  const onClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (e.detail === 0 && phaseRef.current === 'idle') void begin(true)
  }

  useEffect(() => {
    alive.current = true
    void loadVoiceConfig()
    const hidden = () => { if (document.hidden && capture.current) cancel() }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && capture.current) cancel() }
    // A lifted finger must always be noticed, also when the button itself missed the event.
    const up = () => releaseRef.current()
    document.addEventListener('visibilitychange', hidden)
    window.addEventListener('keydown', esc)
    window.addEventListener('pointerup', up)
    return () => {
      alive.current = false
      document.removeEventListener('visibilitychange', hidden)
      window.removeEventListener('keydown', esc)
      window.removeEventListener('pointerup', up)
      cancelAnimationFrame(frame.current)
      capture.current?.cancel()
      capture.current = null
      listening.current?.abort()
      listening.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const recording = phase === 'hold' || phase === 'locked'
  return (
    <div ref={root} className="vr" data-phase={phase} data-armed={armed}>
      {recording && (
        <div className="vr-bar" role="status" aria-label="Recording a voice message">
          {phase === 'locked' && (
            <button type="button" className="vr-del" onClick={cancel} aria-label="Delete the recording"><Icon name="trash" size={20} /></button>
          )}
          <span className="vr-clock"><i className="vr-dot" aria-hidden="true" /><span ref={timeEl} className="num">0:00</span></span>
          <div ref={barsEl} className="vr-wave" aria-hidden="true">
            {Array.from({ length: BARS }, (_, i) => <i key={i} />)}
          </div>
          {phase === 'hold' && (
            <span className="vr-slide" aria-hidden="true">
              {armed ? 'Release to cancel' : <><VIcon name="chevLeft" size={16} /> Slide to cancel</>}
            </span>
          )}
          {phase === 'locked' && (
            <button type="button" className="vr-send" onClick={() => void finish()} aria-label="Send the voice message"><Icon name="send" size={20} /></button>
          )}
        </div>
      )}
      {phase === 'hold' && !armed && <span className="vr-lock" aria-hidden="true"><VIcon name="lock" size={16} /><VIcon name="chevUp" size={14} /></span>}
      {phase !== 'locked' && (
        <button
          type="button"
          className="vr-mic"
          disabled={disabled}
          aria-busy={phase === 'asking'}
          aria-label="Hold to record a voice message, or tap to record hands-free"
          aria-pressed={recording}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onLost}
          onClick={onClick}
          onContextMenu={(e) => e.preventDefault()}
        >
          {phase === 'asking' ? <i className="vr-spin" aria-hidden="true" /> : armed ? <Icon name="trash" size={22} /> : <VIcon name="mic" size={22} />}
        </button>
      )}
    </div>
  )
}
