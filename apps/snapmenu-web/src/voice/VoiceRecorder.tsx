import { useEffect, useRef, useState } from 'react'
import { sayChat } from '../../../snapmenu-api/src/voice/chat-copy'
import { clock, speechLocale, VOICE_MESSAGE_SECONDS } from '../../../snapmenu-api/src/voice/speech'
import { Icon } from '../components/ui'
import { phoneLocale } from '../lib/format'
import { store } from '../lib/storage'
import { VIcon } from './icons'
import { listen, type Listening } from './recognition'
import { NOTE_SECONDS, recordNote, type RecordedNote } from './audio-note'
import './voice.css'

/** Metadata for a dictated message. */
export interface VoiceClip { id: string; durationMs: number }
export type HeardClip = VoiceClip

interface VoiceRecorderProps {
  onAudio?: (note: RecordedNote) => void
  onTranscript?: (text: string, clip: HeardClip) => void
  onClip?: (clip: VoiceClip) => void
  onFail?: (why: string, message: string, clip: VoiceClip | null) => void
  onActive?: (active: boolean) => void
  language?: string
  disabled?: boolean
  livePreview?: boolean
}

type Phase = 'idle' | 'hold' | 'locked' | 'sending'

/** One utterance at a time: tap and send, or hold and release. Never a live call. */
export function VoiceRecorder(props: VoiceRecorderProps) {
  const [phase, renderPhase] = useState<Phase>('idle')
  const [ready, setReady] = useState(true)
  const [elapsed, setElapsed] = useState(0)
  const [words, setWords] = useState('')
  const [sound, setSound] = useState(false)
  const [armed, setArmed] = useState(false)
  const down = useRef<{ x: number; y: number } | null>(null)
  const phaseRef = useRef<Phase>('idle')
  const sendPressed = useRef(false)
  const active = useRef<{ listening: Listening | NonNullable<ReturnType<typeof recordNote>>; start: number; timer: number } | null>(null)
  const cb = useRef(props)
  cb.current = props
  const lang = props.language ?? store.language()

  function change(p: Phase) {
    const wasActive = phaseRef.current !== 'idle'
    phaseRef.current = p
    renderPhase(p)
    if (wasActive !== (p !== 'idle')) cb.current.onActive?.(p !== 'idle')
  }

  function cancel() {
    down.current = null
    const a = active.current
    if (!a) return
    active.current = null
    window.clearInterval(a.timer)
    a.listening.abort()
    setArmed(false)
    change('idle')
  }

  function speechFailed(error?: string, clip: VoiceClip | null = null) {
    const denied = error === 'not-allowed' || error === 'service-not-allowed'
    cb.current.onFail?.(denied ? 'denied' : 'unheard', sayChat(lang, denied ? 'voice.denied' : 'voice.unheard'), clip)
  }

  async function send() {
    const a = active.current
    if (!a || phaseRef.current === 'sending') return
    window.clearInterval(a.timer)
    down.current = null
    setArmed(false)
    change('sending')
    const clip = { id: `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, durationMs: Date.now() - a.start }
    cb.current.onClip?.(clip)
    const result = await a.listening.finish()
    if (active.current !== a) return
    active.current = null
    change('idle')
    if ('note' in result && result.note) cb.current.onAudio?.(result.note)
    else if (cb.current.onAudio) cb.current.onFail?.('recording', result.error || 'Try recording your message again.', null)
    else if (result.text) cb.current.onTranscript?.(result.text, clip)
    else speechFailed(result.error, clip)
  }

  function begin(mode: 'hold' | 'locked') {
    if (phaseRef.current !== 'idle' || cb.current.disabled) return
    const audio = !!cb.current.onAudio
    let start = Date.now()
    let started = !audio
    setReady(started)
    function failed(error: string) {
      if (active.current?.listening !== listening || phaseRef.current === 'sending') return
      cancel()
      if (audio) cb.current.onFail?.('recording', error, null)
      else speechFailed(error)
    }
    // Recording and speech recognition each own their microphone stream.
    const listening = audio ? recordNote(() => {
      start = Date.now()
      started = true
      setReady(true)
    }, failed) : listen(speechLocale(lang, phoneLocale()), failed, props.livePreview ? setWords : undefined, setSound)
    if (!listening) { cb.current.onFail?.('unsupported', audio ? 'This browser can’t record voice messages.' : sayChat(lang, 'voice.off'), null); return }
    const timer = window.setInterval(() => {
      if (!started) return
      const ms = Date.now() - start
      setElapsed(ms)
      if (ms >= (audio ? NOTE_SECONDS : VOICE_MESSAGE_SECONDS) * 1000) void send()
    }, 200)
    active.current = { listening, start, timer }
    sendPressed.current = false
    setElapsed(0)
    setWords('')
    setSound(false)
    change(mode)
  }

  useEffect(() => {
    const hidden = () => { if (document.hidden && phaseRef.current !== 'sending') cancel() }
    document.addEventListener('visibilitychange', hidden)
    return () => {
      document.removeEventListener('visibilitychange', hidden)
      const a = active.current
      active.current = null
      if (a) { window.clearInterval(a.timer); a.listening.abort() }
    }
  }, [])

  const recording = phase === 'hold' || phase === 'locked'
  return (
    <div className="vr" data-phase={phase} data-armed={armed} onKeyDown={(e) => {
      if (e.key === 'Escape' && recording) { e.stopPropagation(); cancel() }
    }}>
      {recording && (
        <div className="vr-bar" aria-label="Recording a voice message">
          {phase === 'locked' && <button type="button" className="vr-del" onClick={cancel} aria-label="Delete the recording"><Icon name="trash" size={20} /></button>}
          <span className="vr-clock"><i className="vr-dot" aria-hidden="true" /><span className="num">{clock(elapsed)}</span></span>
          <span className="vr-wave" data-sound={sound || (!!props.onAudio && ready)} aria-hidden="true">{[8, 15, 21, 12, 18, 7].map((h, i) => <i key={i} style={{ height: h, animationDelay: `${i * 55}ms` }} />)}</span>
          <span className="vr-status" role="status">{armed ? 'Release to cancel' : words || (!ready ? 'Allow microphone…' : phase === 'locked' ? (props.onAudio ? 'Recording…' : 'Listening…') : 'Release to send')}</span>
          {phase === 'locked' && <button type="button" className="vr-send" disabled={!ready} aria-label="Send the voice message"
            onPointerDown={() => { sendPressed.current = true }} onPointerCancel={() => { sendPressed.current = false }}
            onClick={(e) => {
              // A touch that just locked the mic can generate a click on the
              // replacement button under the same finger. Require a new press.
              if (e.detail === 0 || sendPressed.current) void send()
              sendPressed.current = false
            }}><Icon name="send" size={20} /></button>}
        </div>
      )}
      {phase !== 'locked' && (
        <button type="button" className="vr-mic" disabled={props.disabled || phase === 'sending'} aria-busy={phase === 'sending'}
          aria-label="Tap to record a voice message" aria-pressed={recording}
          onPointerDown={(e) => {
            if (!e.isPrimary || e.button !== 0 || phaseRef.current !== 'idle') return
            e.preventDefault()
            try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* older browsers */ }
            down.current = { x: e.clientX, y: e.clientY }
            // Touch normally activates on release. After a previous gesture, browsers that still
            // grant activation can start immediately and support hold-to-send as well.
            if (e.pointerType === 'mouse' || navigator.userActivation?.isActive) begin('hold')
          }}
          onPointerMove={(e) => {
            if (!down.current || phaseRef.current !== 'hold') return
            const left = down.current.x - e.clientX >= 80
            setArmed(left)
            if (!left && down.current.y - e.clientY >= 56) { down.current = null; change('locked') }
          }}
          onPointerUp={(e) => {
            if (!e.isPrimary) return
            const start = down.current
            down.current = null
            if (!start) return
            if (e.pointerType !== 'mouse' && phaseRef.current !== 'hold') {
              // Touch grants user activation on release, not on pointerdown.
              if (Math.hypot(start.x - e.clientX, start.y - e.clientY) < 24) begin('locked')
              return
            }
            if (phaseRef.current !== 'hold') return
            if (start.x - e.clientX >= 80) cancel()
            else if (!ready || Date.now() - (active.current?.start ?? 0) < 400) change('locked')
            else void send()
          }}
          onPointerCancel={cancel} onLostPointerCapture={() => { if (phaseRef.current === 'hold') cancel() }}
          onClick={(e) => { if (e.detail === 0) begin('locked') }} onContextMenu={(e) => e.preventDefault()}
        >{phase === 'sending' ? <i className="vr-spin" aria-hidden="true" /> : <VIcon name="mic" size={22} />}</button>
      )}
    </div>
  )
}
