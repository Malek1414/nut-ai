// Eating together: the calls to /api/group, and what this phone remembers about its groups.
import type { GroupKind, GroupView, MenuInput, Needs, ParsedNeeds } from '../../../snapmenu-api/src/group/types'
import type { MenuResult } from '../../../snapmenu-api/src/types'
import { errorText } from '../../../snapmenu-api/src/voice/index'
import { ApiError } from '../lib/api'
import { store } from '../lib/storage'

export type { GroupKind, GroupView, MenuInput, Needs, ParsedNeeds }

/** The name people see in a shared link's message. */
export const APP_NAME = 'PlatePal'

const headers = (): Record<string, string> => ({
  'content-type': 'application/json',
  'x-device': store.deviceId(),
  'x-lang': store.language(),
  ...(store.isTeam() ? { 'x-team': '1' } : {}),
})

async function send<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: headers(), ...(body === undefined ? {} : { body: JSON.stringify(body) }), ...(signal ? { signal } : {}) })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new ApiError('Cancelled.', 'aborted', 0)
    throw new ApiError(errorText(store.language(), 'offline').message, 'offline', 0)
  }
  const data = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null
  if (!res.ok) throw new ApiError(data?.error?.message ?? errorText(store.language(), 'oops').message, data?.error?.code ?? 'http', res.status)
  return data as T
}

export const openGroup = (input: { kind: GroupKind; lat?: number; lng?: number; menu?: MenuInput }) => send<{ id: string; group: GroupView }>('/api/group', input)

/** The group, or null when nothing changed since `since` (polling). */
export async function fetchGroup(id: string, since?: number, signal?: AbortSignal): Promise<GroupView | null> {
  const out = await send<{ group?: GroupView; unchanged?: boolean }>(`/api/group?id=${encodeURIComponent(id)}${since ? `&since=${since}` : ''}`, undefined, signal)
  return out.group ?? null
}

export const joinGroup = (input: { id: string; memberId?: string; name: string; needs: Needs; lat?: number; lng?: number }) => send<{ memberId: string; group: GroupView }>('/api/group/join', input)
export const leaveGroup = (id: string, memberId: string) => send<{ group: GroupView }>('/api/group/leave', { id, memberId })
export const voteGroup = (id: string, memberId: string, placeId: string | null) => send<{ group: GroupView }>('/api/group/vote', { id, memberId, placeId })
export const setGroupMenu = (id: string, menu: MenuInput | null) => send<{ group: GroupView }>('/api/group/menu', { id, menu })
export const readNeedsText = (text: string) => send<ParsedNeeds>('/api/group/needs', { text })

/** A scan's dishes as a table needs them: the engine's numbers, the scan's allergy hints. */
export function menuOf(result: MenuResult): MenuInput {
  return {
    scanId: result.scanId,
    restaurant: result.restaurant,
    dishes: result.dishes.map((d) => ({
      name: d.name, translated: d.translated && d.translated !== d.name ? d.translated : null, price: d.price, course: d.course,
      kcal: { low: d.kcal.low, mid: d.kcal.mid, high: d.kcal.high }, protein: d.protein.mid, carbs: d.carbs.mid, fat: d.fat.mid, fiber: d.fiber,
      vegetarian: d.diet.vegetarian, vegan: d.diet.vegan, allergens: d.allergens.map((a) => a.allergen),
    })),
  }
}

// ---------- What this phone remembers ----------

export interface Recent { id: string; kind: GroupKind; label: string; ts: number }
const KEY = 'snapmenu.groups'

export function recentGroups(): Recent[] {
  try {
    const list = JSON.parse(window.localStorage.getItem(KEY) ?? '[]') as Recent[]
    return Array.isArray(list) ? list.filter((r) => r && typeof r.id === 'string' && Date.now() - r.ts < 7 * 24 * 60 * 60_000).slice(0, 3) : []
  } catch {
    return []
  }
}

export function rememberGroup(g: GroupView, label: string) {
  try {
    const rest = recentGroups().filter((r) => r.id !== g.id)
    window.localStorage.setItem(KEY, JSON.stringify([{ id: g.id, kind: g.kind, label, ts: Date.now() }, ...rest].slice(0, 3)))
  } catch { /* storage blocked: nothing to remember */ }
}

export function forgetGroup(id: string) {
  try { window.localStorage.setItem(KEY, JSON.stringify(recentGroups().filter((r) => r.id !== id))) } catch { /* ignore */ }
}

/** The link friends open, and the message it travels in. */
export const groupLink = (id: string) => `${window.location.origin}/g/${id}`
export function inviteText(g: Pick<GroupView, 'id' | 'kind' | 'table'>): string {
  const link = groupLink(g.id)
  return g.table
    ? `We are ordering with ${APP_NAME}. Add what you eat and get your pick from the menu: ${link}`
    : `Where should we eat? Add what you eat, it takes ten seconds. ${APP_NAME} finds a place that fits all of us: ${link}`
}
export const whatsappLink = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`
