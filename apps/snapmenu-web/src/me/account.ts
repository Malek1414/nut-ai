import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Place, Profile } from '../../../snapmenu-api/src/types'
import type { Body } from '../../../snapmenu-api/src/me/targets'
import type { DishSnap, Targets, Taste } from '../../../snapmenu-api/src/me/types'
import { store } from '../lib/storage'
import { nickname } from '../lib/community'
import { me, useMe } from './store'
import { clearChat } from './chat-state'

export async function accountApi<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/account/${path}`, { cache: 'no-store', signal: AbortSignal.timeout(path === 'chat' ? 35_000 : 12_000), ...(body === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-device': store.communityDeviceId() }, body: JSON.stringify(body),
  }) }).catch(() => { throw new Error('Couldn’t connect. Try again.') })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(data?.error?.message ?? 'Something went wrong. Try again.')
  return data as T
}

export interface Snapshot {
  goals: { profile?: Profile | null; targets?: Targets | null; taste?: Taste; body?: Body | null; tasteAsked?: boolean }
  favorites: DishSnap[]
  places: Place[]
}
export interface Session extends Snapshot { username: string; revision: number }
export class UnsyncedChanges extends Error {}
const GUEST = 'snapmenu.account.guest'
let backup: Snapshot | null = null
const hadGuest = () => read<Snapshot>(GUEST) ?? backup
const read = <T,>(k: string): T | null => { try { return JSON.parse(localStorage.getItem(k) ?? 'null') as T | null } catch { return null } }
const set = (k: string, v: unknown) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)) } catch { /* storage blocked */ } }
let places = read<Place[]>('snapmenu.saved.places') ?? []
const subs = new Set<() => void>()
const subscribe = (fn: () => void) => { subs.add(fn); return () => { subs.delete(fn) } }
export const useSavedPlaces = () => useSyncExternalStore(subscribe, () => places)
function savePlaces(data: Place[]) {
  places = Array.isArray(data) ? data.filter((p) => p && /^[nwr]\d+$/.test(p.id) && typeof p.name === 'string' && Number.isFinite(p.lat) && Number.isFinite(p.lng)).slice(0, 60) : []
  set('snapmenu.saved.places', places)
  subs.forEach((fn) => fn())
}
export const togglePlace = (place: Place) => savePlaces(places.some((p) => p.id === place.id) ? places.filter((p) => p.id !== place.id) : [place, ...places])

function current(profile: Profile | null): Snapshot {
  const { targets, favorites, taste, body, tasteAsked } = me.get()
  return { goals: { profile, targets, taste, body, tasteAsked }, favorites, places }
}

export function useAccount(profile: Profile | null, onProfile: (profile: Profile | null) => void) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(() => !!hadGuest())
  const [message, setMessage] = useState('')
  const [retry, setRetry] = useState(0)
  const revision = useRef(0)
  const sent = useRef('')
  const inFlight = useRef<Promise<void> | null>(null)
  const settings = useMe(), saved = useSavedPlaces()
  const latest = useRef(current(profile))
  latest.current = current(profile)
  const onProfileRef = useRef(onProfile)
  onProfileRef.current = onProfile

  function apply(snapshot: Snapshot) {
    const candidate = snapshot.goals?.profile
    const p = candidate && ['balanced', 'lose_fat', 'build_muscle', 'plant_based'].includes(candidate.goal) && Array.isArray(candidate.allergies) && candidate.allergies.every((a) => typeof a === 'string') && typeof candidate.language === 'string' ? candidate : null
    if (p) store.saveProfile(p); else store.clearProfile()
    onProfileRef.current(p)
    me.restoreAccount(snapshot.goals, snapshot.favorites)
    savePlaces(snapshot.places)
    latest.current = current(p)
    sent.current = JSON.stringify(latest.current)
  }
  const accept = (s: Session) => { revision.current = s.revision; apply(s); nickname.signedIn(s.username); setSession(s); setMessage('') }
  useEffect(() => {
    const guest = hadGuest()
    let live = true
    if (guest) setLoading(true)
    accountApi<Session | null>('session').then((s) => {
      if (!live) return
      if (s) {
        if (!guest) { backup = latest.current; set(GUEST, backup) }
        accept(s)
      } else if (guest) { apply(guest); backup = null; set(GUEST, null); clearChat(); nickname.signedIn(null); setSession(null); store.rotateCommunityDevice(); setMessage('') }
    }).catch((error) => { if (live && guest) setMessage((error as Error).message) }).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [retry])

  function flush(): Promise<void> {
    if (!session) return Promise.resolve()
    if (inFlight.current) return inFlight.current.then(flush)
    const snapshot = latest.current
    const packed = JSON.stringify(snapshot)
    if (sent.current === packed) return Promise.resolve()
    const task = accountApi<{ revision: number }>('sync', { revision: revision.current, snapshot }).then((r) => {
      revision.current = r.revision
      sent.current = packed
      setMessage('')
    }).finally(() => { inFlight.current = null })
    inFlight.current = task
    return task
  }
  useEffect(() => {
    if (!session) return
    const sync = () => { void flush().catch((e: Error) => setMessage(e.message)) }
    const timer = window.setTimeout(sync, 650)
    window.addEventListener('online', sync)
    return () => { window.clearTimeout(timer); window.removeEventListener('online', sync) }
  }, [session, profile, settings.targets, settings.body, settings.taste, settings.tasteAsked, settings.favorites, saved])

  return { session, loading, message, retry: () => setRetry((n) => n + 1),
    async link() {
      const guest = latest.current
      const s = await accountApi<Session>('link', { snapshot: guest })
      backup = guest
      set(GUEST, guest)
      accept(s)
    },
    async logout(discard = false) {
      if (!discard) {
        try { await flush() } catch { throw new UnsyncedChanges('Some changes couldn’t sync.') }
      }
      await accountApi('logout', {})
      const guest = hadGuest()
      if (guest) apply(guest)
      backup = null
      set(GUEST, null)
      clearChat()
      nickname.signedIn(null)
      store.rotateCommunityDevice()
      setSession(null)
      setMessage('')
    },
  }
}
