import type { CommentView, PostView } from '../../../snapmenu-api/src/types'
import { store } from './storage'

export type { CommentView, PostView }

export const COMMUNITIES = [
  { id: 'HighProtein', label: 'High protein', blurb: 'Big protein, sensible calories.', icon: 'bolt', tint: 'var(--protein-tint)', ink: '#22408f' },
  { id: 'LoseFat', label: 'Lose fat', blurb: 'Filling meals that keep the calories honest.', icon: 'flame', tint: 'var(--fat-tint)', ink: '#8e2547' },
  { id: 'Vegan', label: 'Vegan', blurb: 'Plant-based orders that fill you up.', icon: 'leaf', tint: 'var(--basil-tint)', ink: 'var(--basil-ink)' },
  { id: 'Delivery', label: 'Delivery', blurb: 'Order delivery without wrecking your diet.', icon: 'bag', tint: 'var(--carbs-tint)', ink: '#8a5306' },
  { id: 'Kreuzberg', label: 'Kreuzberg', blurb: 'Kotti, Bergmannkiez and the canal.', icon: 'pin', tint: 'var(--saffron-tint)', ink: '#7a5208' },
  { id: 'Mitte', label: 'Mitte', blurb: 'Alex, Hackescher Markt, Rosenthaler Platz.', icon: 'pin', tint: 'var(--saffron-tint)', ink: '#7a5208' },
  { id: 'Neukölln', label: 'Neukölln', blurb: 'Sonnenallee, Weserstraße, Schillerkiez.', icon: 'pin', tint: 'var(--saffron-tint)', ink: '#7a5208' },
  { id: 'PrenzlauerBerg', label: 'Prenzlauer Berg', blurb: 'Kastanienallee to Kollwitzplatz.', icon: 'pin', tint: 'var(--saffron-tint)', ink: '#7a5208' },
  { id: 'Friedrichshain', label: 'Friedrichshain', blurb: 'Boxi, Simon-Dach and Warschauer.', icon: 'pin', tint: 'var(--saffron-tint)', ink: '#7a5208' },
] as const

export const communityOf = (id: string) => COMMUNITIES.find((c) => c.id === id) ?? COMMUNITIES[0]

export class CommunityError extends Error {
  constructor(message: string, readonly code: string) { super(message) }
}

async function call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method: init?.method ?? 'GET',
      headers: { 'content-type': 'application/json', 'x-device': store.deviceId(), ...(store.isTeam() ? { 'x-team': '1' } : {}) },
      ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    })
  } catch {
    throw new CommunityError('No connection. Check your internet and try again.', 'offline')
  }
  const body = (await res.json().catch(() => null)) as (T & { error?: { code: string; message: string } }) | null
  if (!res.ok) throw new CommunityError(body?.error?.message ?? `Something went wrong (${res.status}).`, body?.error?.code ?? 'http')
  return body as T
}

export type Sort = 'hot' | 'new' | 'top'

export const feed = (q: { community?: string | null; sort?: Sort; saved?: boolean; mine?: boolean; place?: string; delivers?: boolean }) => {
  const p = new URLSearchParams()
  if (q.community) p.set('c', q.community)
  if (q.sort) p.set('sort', q.sort)
  if (q.saved) p.set('saved', '1')
  if (q.mine) p.set('mine', '1')
  if (q.place) p.set('place', q.place)
  if (q.delivers) p.set('delivers', '1')
  return call<{ posts: PostView[] }>(`/api/feed?${p}`).then((r) => r.posts)
}
export const getPost = (id: string) => call<{ post: PostView; comments: CommentView[] }>(`/api/post?id=${encodeURIComponent(id)}`)
export const createPost = (body: Record<string, unknown>) => call<PostView>('/api/posts', { method: 'POST', body: { ...body, nickname: nickname.get() } })
export const createComment = (postId: string, text: string, parentId: string | null) =>
  call<CommentView>('/api/comments', { method: 'POST', body: { postId, body: text, parentId, nickname: nickname.get() } })
export const vote = (kind: 'post' | 'comment', id: string, value: -1 | 0 | 1) => call<{ score: number; myVote: -1 | 0 | 1 }>('/api/vote', { method: 'POST', body: { kind, id, value } })
export const savePost = (postId: string, on: boolean) => call<{ saved: boolean }>('/api/save', { method: 'POST', body: { postId, on } })
export const report = (kind: 'post' | 'comment', id: string, reason: string) => call<{ hidden: boolean }>('/api/report', { method: 'POST', body: { kind, id, reason } })
export const removeOwn = (kind: 'post' | 'comment', id: string) => call<{ removed: boolean }>('/api/delete', { method: 'POST', body: { kind, id } })

const ADJ = ['Hungry', 'Crispy', 'Spicy', 'Leafy', 'Golden', 'Zesty', 'Hearty', 'Sunny', 'Salty', 'Tangy']
const NOUN = ['Otter', 'Falafel', 'Pretzel', 'Bao', 'Radish', 'Lentil', 'Fox', 'Dumpling', 'Panda', 'Tofu']

export const nickname = {
  get(): string | null {
    try { return window.localStorage.getItem('snapmenu.nickname') } catch { return null }
  },
  set(v: string) {
    try { window.localStorage.setItem('snapmenu.nickname', v) } catch { /* ignore */ }
  },
  suggest(): string {
    const r = (n: number) => Math.floor(Math.random() * n)
    return `${ADJ[r(ADJ.length)]}${NOUN[r(NOUN.length)]}${10 + r(89)}`
  },
}

/** Client-side mirror of the server's nickname rule, for instant feedback. */
export const validNickname = (v: string) => /^[\p{L}\p{N}._-]{2,24}$/u.test(v)

export function timeAgo(ts: number): string {
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d`
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export const compactScore = (n: number) => (Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
