import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowUp, AtSign, Ellipsis, Utensils, X } from 'lucide-react'
import type { Card, Message } from '../../../snapmenu-api/src/chats/types'
import { getPosition } from '../lib/position'
import { store } from '../lib/storage'
import { VoiceRecorder } from '../voice/VoiceRecorder'
import type { RecordedNote } from '../voice/audio-note'
import { ChatError, chatsApi, pathOf, refreshInbox, type SendResult, type ThreadData } from './client'
import { ChatAvatar, dayLabel, Notice } from './parts'
import { MessageBubble } from './Messages'
import { MembersSheet, MessageActions } from './ThreadControls'

function base64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.onerror = () => reject(new Error('Couldn’t read that recording.'))
    reader.readAsDataURL(blob)
  })
}
export function Thread({ id, username, onClose, onOpenShare }: { id: string; username: string; onClose: () => void; onOpenShare?: (card: Card) => void }) {
  const [data, setData] = useState<ThreadData | null>(null)
  const [old, setOld] = useState<Message[]>([])
  const [more, setMore] = useState(true), [paging, setPaging] = useState(false)
  const [details, setDetails] = useState(false), [actions, setActions] = useState<Message | null>(null)
  const [loadError, setLoadError] = useState(''), [error, setError] = useState(''), [status, setStatus] = useState('')
  const [text, setText] = useState(''), [busy, setBusy] = useState(''), [retryClip, setRetryClip] = useState<RecordedNote | null>(null)
  const [recording, setRecording] = useState(false)
  const pane = useRef<HTMLElement>(null), log = useRef<HTMLDivElement>(null), input = useRef<HTMLTextAreaElement>(null)
  const loading = useRef(false), previousPage = useRef<Message[]>([])
  const version = useRef(0), stick = useRef(true), acknowledged = useRef(0), reading = useRef(false), nearMessage = useRef(0)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const navigation = document.querySelector<HTMLElement>('nav.tabbar')
    if (navigation) navigation.inert = true
    pane.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
    const back = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('[aria-modal="true"]') && !pane.current?.querySelector('.vr[data-phase="locked"],.vr[data-phase="hold"]')) close.current()
    }
    window.addEventListener('keydown', back)
    return () => {
      if (navigation) navigation.inert = false
      window.removeEventListener('keydown', back)
    }
  }, [])
  const path = pathOf(id)
  const read = useCallback(async () => {
    const last = nearMessage.current
    if (!last || last <= acknowledged.current || reading.current || document.hidden || !stick.current) return
    reading.current = true
    try { await chatsApi(path + '/read', { through: last }); acknowledged.current = last; refreshInbox(username) }
    catch { /* An upcoming visible refresh retries. */ }
    finally { reading.current = false }
  }, [path, username])
  const load = useCallback(async () => {
    if (document.hidden) return
    const revision = ++version.current
    loading.current = true
    try {
      const res = await chatsApi<ThreadData>(path)
      if (revision !== version.current || document.hidden) return
      const first = res.messages[0]?.id
      const overlap = first && previousPage.current.some(message => message.id === first)
      if (res.messages.length === 50 && overlap) {
        const displaced = previousPage.current.filter(message => message.id < first)
        if (displaced.length) setOld(prev => [...prev, ...displaced.filter(m => !prev.some(p => p.id === m.id))])
      } else if (res.messages.length < 50 || !overlap) {
        setOld([]); setMore(res.messages.length === 50)
      }
      previousPage.current = res.messages
      setData(res); setLoadError('')
      // The newest page is authoritative, including changed vote counts and deletions.
      nearMessage.current = res.messages.at(-1)?.id ?? 0
      if (res.chat.unread) void read()
    } catch (e) {
      if (revision !== version.current) return
      setLoadError((e as Error).message)
      if (e instanceof ChatError && [401, 403, 404].includes(e.status)) {
        previousPage.current = []; setData(null); setOld([]); setActions(null); setDetails(false); refreshInbox(username)
      }
    } finally { if (revision === version.current) loading.current = false }
  }, [path, read, username])
  useEffect(() => {
    void load()
    const interval = window.setInterval(() => { if (!loading.current) void load() }, 8_000)
    document.addEventListener('visibilitychange', load)
    window.addEventListener('online', load)
    return () => { version.current++; clearInterval(interval); document.removeEventListener('visibilitychange', load); window.removeEventListener('online', load) }
  }, [load])
  useEffect(() => {
    const viewport = window.visualViewport
    const resize = () => {
      if (!viewport) return
      pane.current?.style.setProperty('--pc-height', viewport.height + 'px')
      pane.current?.style.setProperty('--pc-top', viewport.offsetTop + 'px')
      if (stick.current && log.current) log.current.scrollTop = log.current.scrollHeight
    }
    resize()
    viewport?.addEventListener('resize', resize); viewport?.addEventListener('scroll', resize)
    return () => { viewport?.removeEventListener('resize', resize); viewport?.removeEventListener('scroll', resize) }
  }, [])
  const messages = data ? [...old.filter(m => m.id < (data.messages[0]?.id ?? 0)), ...data.messages] : []
  const lastMine = [...messages].reverse().find(m => m.sender?.id === data?.me.id)?.id
  const last = messages.at(-1)?.id
  useLayoutEffect(() => { const node = log.current; if (node && stick.current) node.scrollTop = node.scrollHeight }, [last])
  const anchor = useRef<{ top: number; height: number } | null>(null)
  useLayoutEffect(() => {
    if (log.current && anchor.current) {
      log.current.scrollTop = anchor.current.top + log.current.scrollHeight - anchor.current.height
      anchor.current = null
    }
  }, [old])
  async function earlier() {
    if (paging || !messages.length) return
    setPaging(true); setError('')
    try {
      const first = messages[0].id
      const res = await chatsApi<ThreadData>(path + '?before=' + first)
      if (log.current) anchor.current = { top: log.current.scrollTop, height: log.current.scrollHeight }
      setOld(previous => [...res.messages, ...previous.filter(m => m.id >= first)])
      setMore(res.messages.length === 50)
    } catch (e) { setError((e as Error).message) }
    finally { setPaging(false) }
  }
  async function act(label: string, perform: () => Promise<unknown>) {
    if (busy) return
    setBusy(label); setError(''); setStatus('')
    try { await perform(); await load(); refreshInbox(username) }
    catch (e) { setError((e as Error).message) }
    finally { setBusy('') }
  }
  function send() {
    const words = text.trim()
    if (!words || busy) return
    void act('send', async () => {
      const res = await chatsApi<SendResult>(path + '/messages', { type: 'text', text: words })
      setText(''); stick.current = true
      if (res.assistantError) setError(res.assistantError)
    })
  }
  function sendAudio(note: RecordedNote) {
    setRetryClip(note)
    void act('voice', async () => {
      await chatsApi(path + '/messages', { type: 'voice', mime: note.audio.type, audio: await base64(note.audio), durationMs: note.durationMs })
      setRetryClip(null); stick.current = true
    })
  }
  function plan() {
    void act('plan', async () => {
      const { position, status } = getPosition()
      await chatsApi(path + '/plan', { ...(status === 'granted' ? position : {}), language: store.language() })
      stick.current = true
    })
  }
  return <main className="pc-thread" ref={pane}>
    <header className="pc-thread-top"><button type="button" className="pc-icon" onClick={onClose} aria-label="Back to chats"><ArrowLeft size={21} /></button>
      {data && <ChatAvatar name={data.chat.title} group={data.chat.kind === 'group'} size={36} />}
      <div><h1>{data?.chat.title || 'Chat'}</h1>{data && <small>{data.chat.kind === 'group' ? data.members.length + ' members' : 'Direct message'}</small>}</div>
      {data && <button type="button" className="pc-icon" aria-label="Chat details" onClick={() => setDetails(true)}><Ellipsis size={21} /></button>}
    </header>
    {loadError && <Notice retry={() => void load()}>{loadError}</Notice>}
    <div ref={log} className="pc-log" role="region" aria-label="Messages" onScroll={e => {
      const node = e.currentTarget
      stick.current = node.scrollHeight - node.scrollTop - node.clientHeight < 75
      if (stick.current && data?.chat.unread) void read()
    }}>
      {!data && !loadError && <p className="pc-muted">Loading messages…</p>}
      {data && !messages.length && <p className="pc-thread-empty">Send the first message to {data.chat.title}.</p>}
      {more && messages.length >= 50 && <button className="pc-earlier" disabled={paging} onClick={() => void earlier()}>{paging ? 'Loading…' : 'Earlier messages'}</button>}
      {messages.map((m, i) => <Fragment key={m.id}>{(!i || new Date(m.createdAt).toDateString() !== new Date(messages[i - 1].createdAt).toDateString()) && <p className="pc-day">{dayLabel(m.createdAt)}</p>}
        <MessageBubble id={id} message={m} mine={m.sender?.id === data!.me.id} seenBy={m.id === lastMine ? data!.members.filter(p => p.id !== data!.me.id && (data!.reads?.[p.id] ?? 0) >= m.id).map(p => p.username) : undefined} group={data!.chat.kind === 'group'} busy={!!busy} onMenu={() => setActions(m)} onOpenShare={onOpenShare}
          onVote={optionId => void act('vote', () => chatsApi(path + '/vote', { messageId: m.id, optionId }))} />
      </Fragment>)}
    </div>
    {data && <footer className="pc-composer">
      {error && <Notice>{error}</Notice>}
      {retryClip && !busy && <div className="pc-retry"><button type="button" onClick={() => sendAudio(retryClip)}>Retry voice message</button><button className="pc-icon" aria-label="Discard recording" onClick={() => setRetryClip(null)}><X size={17} /></button></div>}
      {status && <p role="status" className="pc-muted">{status}</p>}
      <div className="pc-tools"><button type="button" disabled={!!busy || recording} onClick={plan}><Utensils size={14} />{busy === 'plan' ? 'Planning…' : 'Plan a meal'}</button><button type="button" disabled={!!busy || recording} onClick={() => { setText(v => /@platepal\b/i.test(v) ? v : (v ? v + ' ' : '') + '@PlatePal '); input.current?.focus() }}><AtSign size={14} />PlatePal</button></div>
      {/(?:^|[^\p{L}\p{N}_@])@platepal(?![\p{L}\p{N}_])/iu.test(text) && <p className="pc-disclosure">Sends recent chat text and meal options to OpenAI.</p>}
      <form onSubmit={e => { e.preventDefault(); send() }} className="pc-compose-line">
        <textarea aria-label="Message" rows={1} maxLength={2000} placeholder="Message…" ref={input} value={text} disabled={!!busy || recording} onChange={e => setText(e.target.value)} onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() }
        }} />
        {text.trim() ? <button className="pc-send" type="submit" aria-label="Send message" disabled={!!busy}><ArrowUp size={22} /></button> :
          <VoiceRecorder onAudio={sendAudio} onFail={(_, msg) => setError(msg)} onActive={setRecording} disabled={!!busy || !!retryClip} />}
      </form>
    </footer>}
    {data && details && <MembersSheet data={data} close={() => setDetails(false)} refresh={() => void load()} leave={onClose} />}
    {data && actions && <MessageActions thread={data} message={actions} close={() => setActions(null)} refresh={() => {
      setOld(prev => prev.filter(m => !(actions.sender?.id === data.me.id && m.id === actions.id))); void load(); refreshInbox(username)
    }} onReport={() => setStatus('Report sent.')} />}
  </main>
}
