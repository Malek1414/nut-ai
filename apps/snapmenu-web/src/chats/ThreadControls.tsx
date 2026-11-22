import { useState } from 'react'
import { Flag, Minus, UserMinus, UserPlus } from 'lucide-react'
import type { Message, Person } from '../../../snapmenu-api/src/chats/types'
import { chatsApi, pathOf, useFriends, type ThreadData } from './client'
import { ChatSheet, FriendRow, Notice } from './parts'

type Change = { kind: 'remove' | 'block' | 'unfriend'; person: Person } | { kind: 'leave' }
export function MembersSheet({ data, close, refresh, leave }: { data: ThreadData; close: () => void; refresh: () => void; leave: () => void }) {
  const { chat, me, members } = data
  const group = chat.kind === 'group'
  const owner = group && me.id === chat.ownerId
  const people = useFriends(group ? me.username : null)
  const [change, setChange] = useState<Change | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const friend = members.find(m => m.id !== me.id)
  async function act(path: string, body: unknown, exit = false) {
    setBusy(true); setError('')
    try { await chatsApi(path, body); if (exit) leave(); else { setChange(null); refresh(); close() } }
    catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  function confirm() {
    if (!change) return
    if (change.kind === 'leave') void act(pathOf(chat.id) + '/leave', {}, true)
    else if (change.kind === 'remove') void act(pathOf(chat.id) + '/members/remove', { memberId: change.person.id })
    else void act(change.kind === 'block' ? '/block' : '/friends/remove', { memberId: change.person.id }, true)
  }
  const action = change?.kind === 'leave' ? 'Leave group' : change?.kind === 'remove' ? 'Remove member' : change?.kind === 'unfriend' ? 'Remove friend' : 'Block'
  return <ChatSheet label={change ? action : group ? 'Group details' : 'Chat details'} close={close}>
    {error && <Notice>{error}</Notice>}
    {change ? <>
      <p>{change.kind === 'leave' ? 'Leave ' + chat.title + '? You’ll lose access to this conversation.' :
        change.kind === 'block' ? 'Block ' + change.person.username + '? This ends your direct chat and removes you from all groups you share.' :
        change.kind === 'unfriend' ? 'Remove ' + change.person.username + ' from your friends and close your direct chat?' :
        'Remove ' + change.person.username + ' from ' + chat.title + '?'}</p>
      <button className="btn pc-danger-btn" disabled={busy} onClick={confirm}>{action}</button><button className="btn btn-secondary" disabled={busy} onClick={() => setChange(null)}>Cancel</button>
    </> : <>
      <h3>{chat.title}</h3>
      {members.map(person => <FriendRow key={person.id} name={person.username}>
        {person.id === chat.ownerId && <small>Owner</small>}
        {person.id === me.id ? <small>You</small> : <span className="pc-person-actions">
          {owner && <button aria-label={'Remove ' + person.username} onClick={() => setChange({ kind: 'remove', person })}><Minus size={18} /></button>}
          {group && <button aria-label={'Block ' + person.username} onClick={() => setChange({ kind: 'block', person })}><Flag size={16} /></button>}
        </span>}
      </FriendRow>)}
      {group && members.length < 12 && <>
        <h3>Add friends</h3>{people.error && <Notice retry={people.reload}>{people.error}</Notice>}
        {people.friends?.filter(p => !members.some(m => m.id === p.id)).map(p => <FriendRow key={p.id} name={p.username} disabled={busy} onSelect={() => void act(pathOf(chat.id) + '/members/add', { memberId: p.id })}><UserPlus size={17} /></FriendRow>)}
        {people.friends?.every(p => members.some(m => m.id === p.id)) && <p className="pc-muted">All your friends are already here.</p>}
      </>}
      {group ? <button className="pc-action pc-danger" onClick={() => setChange({ kind: 'leave' })}><UserMinus size={18} /> Leave group</button> :
        friend && <><button className="pc-action" onClick={() => setChange({ kind: 'unfriend', person: friend })}><UserMinus size={18} /> Remove friend</button><button className="pc-action pc-danger" onClick={() => setChange({ kind: 'block', person: friend })}><Flag size={18} /> Block {friend.username}</button></>}
    </>}
  </ChatSheet>
}

export function MessageActions({ thread, message, close, refresh, onReport }: { thread: ThreadData; message: Message; close: () => void; refresh: () => void; onReport: () => void }) {
  const mine = message.sender?.id === thread.me.id
  const [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function submit() {
    setBusy(true); setError('')
    try {
      await chatsApi(pathOf(thread.chat.id) + (mine ? '/delete' : '/report'), { messageId: message.id, ...(mine ? {} : { reason }) })
      if (!mine) onReport()
      refresh(); close()
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  return <ChatSheet label={mine ? 'Delete message?' : 'Report message'} close={close}>
    {error && <Notice>{error}</Notice>}
    {mine ? <p>This will delete the message for everyone in this chat.</p> :
      <label className="pc-field">Why are you reporting this message?<select value={reason} onChange={e => setReason(e.target.value)}><option value="">Choose a reason</option>{['Spam', 'Harassment', 'Unsafe content', 'Other'].map(reason => <option key={reason}>{reason}</option>)}</select></label>}
    <button className="btn pc-danger-btn" disabled={busy || (!mine && !reason)} onClick={() => void submit()}>{mine ? 'Delete message' : 'Send report'}</button>
  </ChatSheet>
}
