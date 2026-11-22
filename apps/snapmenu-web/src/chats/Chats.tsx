import { useEffect, useState } from 'react'
import { Check, Circle, MessageSquarePlus, UserPlus, Users } from 'lucide-react'
import type { Card, Person } from '../../../snapmenu-api/src/chats/types'
import { chatsApi, directChat, pathOf, refreshInbox, useFriends, useInbox } from './client'
import { ChatRow, ChatSheet, Empty, FriendRow, Guest, Notice, SharedCard } from './parts'
import { Thread } from './Thread'
import './chats.css'

interface ChatProps {
  username: string | null
  initialThreadId?: string
  onAccount: () => void
  onInvite: () => void
  onOpenShare?: (card: Card) => void
}
export function Chats({ username, ...props }: ChatProps) {
  return <InboxScreen key={username} username={username} {...props} />
}
function InboxScreen({ username, initialThreadId, onInvite, onAccount, onOpenShare }: ChatProps) {
  const [tab, setTab] = useState<'chats' | 'friends'>('chats')
  const [compose, setCompose] = useState(false)
  const [thread, setThread] = useState<string | undefined>(() => initialThreadId ?? history.state?.chatThread)
  const [error, setError] = useState('')
  const [opening, setOpening] = useState(false)
  const inbox = useInbox(username)
  const people = useFriends(username)
  useEffect(() => {
    if (initialThreadId) setThread(initialThreadId)
    const onPop = () => setThread(history.state?.chatThread)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [initialThreadId])
  useEffect(() => {
    if (!username) return
    const show = () => { if (!document.hidden) people.reload() }
    window.addEventListener('focus', show)
    return () => window.removeEventListener('focus', show)
  }, [username])
  function opened(id: string) {
    if (history.state?.chatThread !== id) history.pushState({ ...history.state, chatThread: id }, '')
    setCompose(false); setError(''); setThread(id)
    if (username) refreshInbox(username)
  }
  async function direct(person: Person) {
    setOpening(true); setError('')
    try { opened((await directChat(person.id)).id) }
    catch (e) { setError((e as Error).message) }
    finally { setOpening(false) }
  }
  if (thread && username) return <Thread key={thread} id={thread} username={username} onOpenShare={onOpenShare}
    onClose={() => {
      if (history.state?.chatThread === thread) history.back()
      else setThread(undefined)
      people.reload(); refreshInbox(username)
    }} />
  return <main className="pc-inbox">
    <header className="pc-top"><h1>Chats</h1>{username && <button type="button" className="pc-icon" aria-label="New chat" onClick={() => { setCompose(true); people.reload() }}><MessageSquarePlus size={22} /></button>}</header>
    {!username ? <Guest onAccount={onAccount} /> : <>
      <nav className="pc-tabs" aria-label="Chat sections">{(['chats', 'friends'] as const).map(t => <button key={t} type="button" aria-current={tab === t ? 'page' : undefined} onClick={() => { setTab(t); setError(''); if (t === 'friends') people.reload(); else refreshInbox(username) }}>{t === 'chats' ? 'Messages' : 'Friends'}</button>)}</nav>
      {error && <Notice>{error}</Notice>}
      {tab === 'chats' ? <>
        {inbox.error && <Notice retry={() => refreshInbox(username)}>{inbox.error}</Notice>}
        {inbox.loading ? <p className="pc-muted">Loading chats…</p> : inbox.chats.map(c => <ChatRow key={c.id} chat={c} onSelect={() => opened(c.id)} />)}
        {!inbox.loading && !inbox.error && !inbox.chats.length && <Empty title="Your conversations" action={<button className="btn btn-primary" onClick={people.friends?.length ? () => setCompose(true) : onInvite}>{people.friends?.length ? 'New chat' : 'Invite a friend'}</button>}>Share a dish or decide where to eat together.</Empty>}
      </> : <>
        <button className="pc-action" onClick={onInvite}><UserPlus size={20} /> Add a friend</button>
        {people.error && <Notice retry={people.reload}>{people.error}</Notice>}
        {!people.friends && !people.error && <p className="pc-muted">Loading friends…</p>}
        {people.friends?.map(p => <FriendRow key={p.id} name={p.username} disabled={opening} onSelect={() => void direct(p)} />)}
        {people.friends?.length === 0 && <p className="pc-muted">Invite a friend to start your first conversation.</p>}
      </>}
      {compose && <NewChat friends={people.friends} error={people.error} retry={people.reload} onClose={() => setCompose(false)} onInvite={() => { setCompose(false); onInvite() }} onOpen={opened} />}
    </>}
  </main>
}

function NewChat({ friends, error, retry, onClose, onInvite, onOpen }: { friends: Person[] | null; error: string; retry: () => void; onClose: () => void; onInvite: () => void; onOpen: (id: string) => void }) {
  const [group, setGroup] = useState(false)
  const [name, setName] = useState('')
  const [ids, setIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  async function create(selected: string[]) {
    setBusy(true); setProblem('')
    try { const res = await chatsApi<{ id: string }>('', { kind: group ? 'group' : 'direct', title: name.trim(), memberIds: selected }); onOpen(res.id) }
    catch (e) { setProblem((e as Error).message) }
    finally { setBusy(false) }
  }
  return <ChatSheet label={group ? 'New group' : 'New chat'} close={onClose}>
    {group ? <label className="pc-field">Group name<input maxLength={60} placeholder="Friday dinner" value={name} onChange={e => setName(e.target.value)} /></label> :
      <button className="pc-action" onClick={() => setGroup(true)}><Users size={20} /> New group</button>}
    <button className="pc-action" onClick={onInvite}><UserPlus size={20} /> Add a friend</button>
    <h3>Friends</h3>
    {(error || problem) && <Notice retry={error ? retry : undefined}>{error || problem}</Notice>}
    {friends?.map(p => <FriendRow key={p.id} name={p.username} disabled={busy || (group && !ids.includes(p.id) && ids.length >= 11)} onSelect={() => {
      if (!group) { void create([p.id]); return }
      setIds(ids.includes(p.id) ? ids.filter(id => id !== p.id) : [...ids, p.id])
    }}>{group && (ids.includes(p.id) ? <Check aria-label="Selected" size={20} /> : <Circle aria-label="Select" size={20} />) || undefined}</FriendRow>)}
    {!friends && !error && <p className="pc-muted">Loading friends…</p>}
    {friends?.length === 0 && <p className="pc-muted">Your friends will appear here after they accept your invite.</p>}
    {group && <button className="btn btn-primary" disabled={busy || !name.trim() || !ids.length} onClick={() => void create(ids)}>Create group</button>}
  </ChatSheet>
}

export function ChatSharePicker({ username, card, onAccount, onClose, onSent }: { username: string | null; card: Card; onAccount: () => void; onClose: () => void; onSent?: (id: string) => void }) {
  const inbox = useInbox(username)
  const people = useFriends(username)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const otherFriends = people.friends?.filter(person => !inbox.chats.some(chat => chat.kind === 'direct' && chat.title === person.username))
  async function share(target: { chatId: string } | { memberId: string }) {
    if (!username || busy) return
    setBusy(true); setError('')
    try {
      const id = 'chatId' in target ? target.chatId : (await directChat(target.memberId)).id
      await chatsApi(pathOf(id) + '/messages', { type: 'card', card })
      refreshInbox(username); onClose(); onSent?.(id)
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  return <ChatSheet label="Send to chat" close={onClose}><SharedCard card={card} />
    {!username ? <Guest onAccount={onAccount} /> : <>
      {error && <Notice>{error}</Notice>}
      {inbox.error && <Notice retry={() => refreshInbox(username)}>{inbox.error}</Notice>}
      {people.error && <Notice retry={people.reload}>{people.error}</Notice>}
      {inbox.loading && <p className="pc-muted">Loading chats…</p>}
      {inbox.chats.length > 0 && <h3>Recent chats</h3>}
      {inbox.chats.map(c => <ChatRow key={c.id} chat={c} disabled={busy} onSelect={() => void share({ chatId: c.id })} />)}
      {!!otherFriends?.length && <h3>Friends</h3>}
      {otherFriends?.map(p => <FriendRow key={p.id} name={p.username} disabled={busy} onSelect={() => void share({ memberId: p.id })} />)}
      {!inbox.loading && !inbox.chats.length && people.friends?.length === 0 && <p className="pc-muted">Add a friend in Chats to send this {card.kind}.</p>}
    </>}
  </ChatSheet>
}
