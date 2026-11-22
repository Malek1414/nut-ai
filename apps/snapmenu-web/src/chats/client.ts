import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { Chat, Message, Person } from '../../../snapmenu-api/src/chats/types'

export interface ThreadData { chat: Chat; me: Person; members: Person[]; reads: Record<string, number>; messages: Message[] }
export type SendResult = { id: number; assistantError?: string }
export const pathOf = (id: string) => '/' + encodeURIComponent(id)

export class ChatError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}
export async function chatsApi<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch('/api/chats' + path, {
    cache: 'no-store', signal: AbortSignal.timeout(body ? 60_000 : 12_000),
    ...(body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  }).catch(() => { throw new ChatError(0, 'Couldn’t connect. Please try again.') })
  const data = await res.json().catch(() => null)
  if (!res.ok || data === null) throw new ChatError(res.status, data?.error?.message ?? 'Couldn’t load this chat. Please try again.')
  return data as T
}

type Inbox = { chats: Chat[]; unread: number; loading: boolean; error: string }
const emptyInbox: Inbox = { chats: [], unread: 0, loading: true, error: '' }
type Feed = { value: Inbox; listeners: Set<() => void>; loading: boolean; dirty: boolean; dispose: () => void }
const feeds = new Map<string, Feed>()

async function refresh(username: string, feed: Feed) {
  if (document.hidden || !feed.listeners.size) return
  if (feed.loading) { feed.dirty = true; return }
  feed.loading = true
  try {
    const result = await chatsApi<Pick<Inbox, 'chats' | 'unread'>>('')
    feed.value = { ...result, loading: false, error: '' }
  } catch (e) { feed.value = { ...feed.value, loading: false, error: (e as Error).message } }
  finally {
    feed.loading = false
    feed.listeners.forEach(fn => fn())
    if (feed.dirty && feeds.get(username) === feed) { feed.dirty = false; void refresh(username, feed) }
  }
}

export function refreshInbox(username: string) {
  const feed = feeds.get(username)
  if (feed) void refresh(username, feed)
}
function subscribe(username: string | null, fn: () => void) {
  if (!username) return () => {}
  let feed = feeds.get(username)
  if (!feed) {
    const tick = () => refreshInbox(username)
    const timer = window.setInterval(tick, 30_000)
    document.addEventListener('visibilitychange', tick)
    window.addEventListener('online', tick)
    feed = { value: emptyInbox, listeners: new Set(), loading: false, dirty: false, dispose: () => {
      clearInterval(timer); document.removeEventListener('visibilitychange', tick); window.removeEventListener('online', tick)
    } }
    feeds.set(username, feed)
  }
  feed.listeners.add(fn)
  if (feed.listeners.size === 1) void refresh(username, feed)
  return () => {
    feed.listeners.delete(fn)
    if (!feed.listeners.size) { feed.dispose(); feeds.delete(username) }
  }
}
export function useInbox(username: string | null) {
  const sub = useCallback((fn: () => void) => subscribe(username, fn), [username])
  return useSyncExternalStore(sub, () => username && feeds.get(username)?.value || emptyInbox)
}
export const useChatUnread = (username: string | null) => useInbox(username).unread

export function useFriends(username: string | null) {
  const [friends, setFriends] = useState<Person[] | null>(null)
  const [error, setError] = useState('')
  const [version, setVersion] = useState(0)
  const reload = () => setVersion(v => v + 1)
  useEffect(() => {
    let live = true
    if (!username) return
    setError('')
    chatsApi<{ friends: Person[] }>('/friends').then(res => { if (live) setFriends(res.friends) })
      .catch(e => { if (live) setError(e.message) })
    return () => { live = false }
  }, [username, version])
  return { friends, error, reload }
}
export function directChat(memberId: string) {
  return chatsApi<{ id: string }>('', { kind: 'direct', memberIds: [memberId] })
}
