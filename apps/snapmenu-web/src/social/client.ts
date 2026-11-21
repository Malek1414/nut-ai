// Calls to the sharing, import and Premium routes (apps/snapmenu-api/src/social), and what this phone remembers about them.
import type { DishEstimate, Place, Profile } from '../../../snapmenu-api/src/types'
import { visitSource } from '../../../snapmenu-api/src/social/links'
import type { ImportResult, ImportSource, ShareKind, SharedDish, SharedPlace, ShareView } from '../../../snapmenu-api/src/social/types'
import { saySocial, type SocialKey } from '../../../snapmenu-api/src/social/copy'
import { phoneLocale } from '../lib/format'
import { store } from '../lib/storage'

export type { ImportResult, ImportSource, ShareKind, SharedDish, SharedPlace, ShareView }

export class SocialError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message)
  }
}

const headers = () => ({ 'content-type': 'application/json', 'x-device': store.deviceId(), 'x-team': store.isTeam() ? '1' : '0', 'x-lang': store.language() })

async function call<T>(path: string, body: object | null, fallback: SocialKey, signal?: AbortSignal): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: headers(),
      ...(body ? { body: JSON.stringify({ ...body, deviceId: store.deviceId(), team: store.isTeam(), locale: phoneLocale() }) } : {}),
      ...(signal ? { signal } : {}),
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new SocialError('Cancelled.', 'aborted', 0)
    throw new SocialError(saySocial(store.language(), fallback), 'offline', 0)
  }
  let data: unknown = null
  try { data = await res.json() } catch { /* a non-JSON error page */ }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } } | null)?.error
    throw new SocialError(err?.message ?? saySocial(store.language(), fallback), err?.code ?? 'http', res.status)
  }
  return data as T
}

// ---------- Sharing ----------

/** What can be shared: a dish from a scan, the pick for the user's goal, or a restaurant from the map. */
export type ShareItem =
  | { kind: 'dish' | 'pick'; dish: DishEstimate; why?: string | null; restaurant: string | null; place: Place | null; goal: string | null }
  | { kind: 'place'; place: Place }

/** The numbers of a dish as a link carries them: a snapshot of what the engine computed. */
export const toSharedDish = (d: DishEstimate, why?: string | null): SharedDish => ({
  name: d.name,
  translated: d.translated && d.translated.toLowerCase() !== d.name.toLowerCase() ? d.translated : null,
  description: d.description || null,
  kcal: d.kcal, protein: d.protein, carbs: d.carbs, fat: d.fat,
  bandTier: d.bandTier,
  why: why ?? d.why ?? null,
  price: d.price,
  vegetarian: d.diet.vegetarian,
  vegan: d.diet.vegan,
  allergens: d.allergens.map((a) => a.label.split(' (')[0]!).slice(0, 14),
})

export const toSharedPlace = (p: Place): SharedPlace => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng, cuisine: p.cuisine, address: p.address })

export interface MadeShare { id: string; path: string; title: string; summary: string }

export function createShare(item: ShareItem, image: string | null): Promise<MadeShare> {
  const body = item.kind === 'place'
    ? { kind: 'place', place: toSharedPlace(item.place), image }
    : { kind: item.kind, dish: toSharedDish(item.dish, item.why), place: item.place ? toSharedPlace(item.place) : null, restaurant: item.restaurant, goal: item.goal, image }
  return call<MadeShare>('/api/share', body, 'share_failed')
}

export const fetchShare = (id: string, signal?: AbortSignal) => call<ShareView & { title: string; summary: string }>(`/api/share?id=${encodeURIComponent(id)}`, null, 'failed', signal)

// ---------- Link imports ----------

export function importLink(url: string, profile: Profile | null, hint: { dish?: string; restaurant?: string } | null, signal?: AbortSignal): Promise<ImportResult> {
  return call<ImportResult>('/api/import', { url, ...(profile ? { profile } : {}), ...(hint ? { hint } : {}) }, 'failed', signal)
}

// ---------- Premium ----------

export const joinPremium = (body: { email: string; name: string; wants: string[]; note: string }) =>
  call<{ ok: true }>('/api/premium-interest', { ...body, consent: true, source: firstSource() }, 'failed')
export const leavePremium = () => call<{ removed: number }>('/api/premium-interest', { remove: true }, 'failed')

// ---------- What this phone remembers ----------

function read<T>(key: string, fallback: T): T {
  try {
    const v = window.localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}
function write(key: string, value: unknown) {
  try { window.localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage unavailable: keep going in memory */ }
}

/** A meal saved from a link. The dish is the engine's estimate as it was when saved. */
export interface SavedImport {
  id: string
  savedAt: number
  source: ImportSource
  restaurant: { name: string; city: string | null } | null
  dish: DishEstimate
}

const SAVED_KEY = 'snapmenu.social.saved'
const MAX_SAVED = 60
const watchers = new Set<() => void>()
let savedCache: SavedImport[] | null = null

/**
 * Meals saved from links, on this phone. This is the store the Favorites
 * screen should read: `list()` newest first, `subscribe()` for changes.
 */
export const savedImports = {
  list(): SavedImport[] {
    savedCache ??= read<SavedImport[]>(SAVED_KEY, []).filter((s) => s && s.dish && s.source)
    return savedCache
  },
  has: (url: string): boolean => savedImports.list().some((s) => s.source.url === url),
  add(r: ImportResult): SavedImport | null {
    if (!r.dish) return null
    const item: SavedImport = { id: `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, savedAt: Date.now(), source: r.source, restaurant: r.restaurant, dish: r.dish }
    savedCache = [item, ...savedImports.list().filter((s) => s.source.url !== r.source.url)].slice(0, MAX_SAVED)
    write(SAVED_KEY, savedCache)
    watchers.forEach((w) => w())
    return item
  },
  remove(id: string) {
    savedCache = savedImports.list().filter((s) => s.id !== id)
    write(SAVED_KEY, savedCache)
    watchers.forEach((w) => w())
  },
  subscribe(fn: () => void): () => void {
    watchers.add(fn)
    return () => { watchers.delete(fn) }
  },
}

export const flags = {
  premiumJoined: () => read<boolean>('snapmenu.social.premium', false),
  setPremiumJoined: (v: boolean) => write('snapmenu.social.premium', v),
  installHintSeen: () => read<number>('snapmenu.social.a2hs', 0) > 0,
  setInstallHintSeen: () => write('snapmenu.social.a2hs', Date.now()),
}

// ---------- Where this visit came from ----------

let sessionSource: string | null | undefined

/** The `utm_source` of the link that opened the app this time ("instagram"), kept for the visit. */
export function currentSource(): string | null {
  if (sessionSource !== undefined) return sessionSource
  let s: string | null = null
  try {
    s = visitSource(window.location.search)
    if (s) window.sessionStorage.setItem('snapmenu.social.source', s)
    else s = window.sessionStorage.getItem('snapmenu.social.source')
  } catch { /* no session storage: the address alone decides */ }
  if (s && !read<string | null>('snapmenu.social.first', null)) write('snapmenu.social.first', s)
  sessionSource = s
  return s
}

/** The source of this phone's very first visit: what a Premium sign-up is credited to. */
export const firstSource = (): string | null => read<string | null>('snapmenu.social.first', null) ?? currentSource()
