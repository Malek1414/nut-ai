import { useEffect, useRef, useState } from 'react'
import { ArrowUp, AudioLines, Bookmark, ChevronRight, Compass, History, Plus, QrCode, Sparkles, Volume2, VolumeX, X } from 'lucide-react'
import type { Profile } from '../../../snapmenu-api/src/types'
import { speechLocale } from '../../../snapmenu-api/src/voice/speech'
import { Logo } from '../components/ui'
import { store } from '../lib/storage'
import { VoiceRecorder } from '../voice/VoiceRecorder'
import { canSpeak, primeVoices, speak } from '../voice/speak'
import { accountApi } from './account'
import { readChat, saveChat, type Message } from './chat-state'
import { me } from './store'

const ideas = ['Plan a high-protein lunch', 'Give me a quick dinner idea']

export function Assistant({ username, profile, onTools, onToday, onAsk, onFriends }: { username: string; profile: Profile | null; onTools: () => void; onToday: () => void; onAsk: () => void; onFriends: () => void }) {
  const [messages, setMessages] = useState<Message[]>(() => readChat(username))
  const [text, setText] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(() => messages.at(-1)?.role === 'user' ? 'Reply interrupted.' : '')
  const [recording, setRecording] = useState(false)
  const [playing, setPlaying] = useState<number | null>(null)
  const frame = useRef<HTMLElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const request = useRef(0)
  const stop = useRef<(() => void) | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    primeVoices()
    const viewport = window.visualViewport
    const measure = () => {
      if (!viewport) return
      frame.current?.style.setProperty('--chat-height', `${viewport.height}px`)
      frame.current?.style.setProperty('--chat-top', `${viewport.offsetTop}px`)
      frame.current?.toggleAttribute('data-keyboard', window.innerHeight - viewport.height > 100)
    }
    measure()
    viewport?.addEventListener('resize', measure)
    viewport?.addEventListener('scroll', measure)
    return () => { request.current++; stop.current?.(); viewport?.removeEventListener('resize', measure); viewport?.removeEventListener('scroll', measure) }
  }, [])
  useEffect(() => { const node = list.current; if (node) node.scrollTop = node.scrollHeight }, [messages, pending, error])

  function save(messages: Message[]) { setMessages(messages); saveChat(username, messages) }

  async function reply(history: Message[]) {
    const id = ++request.current
    setPending(true); setError('')
    try {
      const p = profile ?? { goal: 'balanced', language: store.language(), allergies: [] }
      const ctx = me.forScan(p.goal as Profile['goal'])
      const { text } = await accountApi<{ text: string }>('chat', { messages: history.slice(-11), context: { goal: p.goal, diet: profile?.diet, target: me.get().targets, allergies: p.allergies, language: p.language, taste: ctx.taste, remainingToday: ctx.day } })
      if (id === request.current) save([...history, { text, role: 'assistant' }])
    } catch (e) {
      if (id === request.current) setError((e as Error).message)
    } finally { if (id === request.current) setPending(false) }
  }
  function send(raw: string, voice = false) {
    const text = raw.trim().slice(0, 1200)
    if (!text || pending) return
    const history: Message[] = [...messages, { role: 'user', text, voice }]
    save(history); setText('')
    if (voice) input.current?.blur()
    void reply(history)
  }
  function play(m: Message, index: number) {
    stop.current?.(); stop.current = null
    if (playing === index) { setPlaying(null); return }
    setPlaying(index)
    stop.current = speak(m.text, speechLocale(profile?.language ?? store.language()), () => { setPlaying(null); stop.current = null })
  }
  function clear() {
    request.current++; stop.current?.(); save([]); setText(''); setPending(false); setError('')
  }
  return <main ref={frame} className="screen assistant" aria-label="Meal assistant">
    <header className="assistant-head">
      <div><Logo size={31} /><span><b>Meal assistant</b><small>PlatePal</small></span></div>
      <button className="assistant-icon" type="button" aria-label="New chat" onClick={clear} title="New chat"><Plus size={21} /></button>
      <button className="assistant-avatar" type="button" aria-label="Your dashboard" onClick={onTools}>{username.slice(0, 1).toUpperCase()}</button>
    </header>
    <div className="assistant-tools">
      <button type="button" onClick={onToday}><History size={15} /> Today</button>
      <button type="button" onClick={onFriends}><QrCode size={15} /> Friend QR</button>
      <button type="button" onClick={onTools}><Bookmark size={15} /> My tools <ChevronRight size={13} /></button>
    </div>
    <div className="assistant-scroll" ref={list}>
      {!messages.length ? <section className="assistant-welcome">
        <span className="assistant-spark"><Sparkles size={28} strokeWidth={1.55} /></span>
        <h1>What sounds good?</h1>
        <p>Talk through your next meal.</p>
        <div className="assistant-ideas">
          <button type="button" onClick={onAsk}><Compass size={18} /> Find a dish nearby <ChevronRight size={15} /></button>
          {ideas.map((idea) => <button key={idea} type="button" onClick={() => send(idea)}><Sparkles size={17} />{idea}<ChevronRight size={15} /></button>)}
        </div>
      </section> : <div className="assistant-messages" aria-live="polite" aria-busy={pending}>
        {messages.map((m, i) => <article key={i} className={`assistant-message is-${m.role}`}>
          {m.role === 'assistant' ? <div className="assistant-reply-label"><Logo size={22} /> PlatePal</div> : m.voice && <div className="assistant-voice-label"><AudioLines size={15} /> Voice message</div>}
          <p dir="auto">{m.text}</p>
          {m.role === 'assistant' && canSpeak() && <button className="assistant-icon" type="button" aria-label={playing === i ? 'Stop reading' : 'Read reply aloud'} onClick={() => play(m, i)}>{playing === i ? <VolumeX size={18} /> : <Volume2 size={18} />}</button>}
        </article>)}
        {pending && <div role="status" aria-label="Writing a reply" className="assistant-thinking"><Logo size={22} /><div><i className="skeleton" /><i className="skeleton" /></div></div>}
      </div>}
    </div>
    <div className="assistant-bottom">
      {error && <div className="assistant-error" role="alert"><span>{error}</span>{messages.at(-1)?.role === 'user' && !pending && <button type="button" onClick={() => void reply(messages)}>Retry</button>}<button type="button" aria-label="Dismiss" onClick={() => setError('')}><X size={16} /></button></div>}
      <form className={`assistant-compose ${recording ? 'is-recording' : ''}`} onSubmit={(e) => { e.preventDefault(); send(text) }}>
        <textarea ref={input} aria-label="Message" name="message" placeholder="Message PlatePal…" value={text} rows={1} maxLength={1200} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(text) } }} />
        {text.trim() && !recording && <button type="submit" className="assistant-send" aria-label="Send message" disabled={pending}><ArrowUp size={19} strokeWidth={2.4} /></button>}
        <VoiceRecorder livePreview language={profile?.language} onActive={setRecording} disabled={pending} onTranscript={(t) => send(t, true)} onFail={(_why, message) => { setError(message); input.current?.focus() }} />
      </form>
      <p className="assistant-footnote">Estimates only. Check allergens with staff.</p>
    </div>
  </main>
}
