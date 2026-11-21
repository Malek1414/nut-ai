// Everything "Me" keeps lives on this phone: targets, taste, today's log, favorites, meals.
// No account and no server copy. Storage is always wrapped: a private window must not break the app.
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { DishEstimate, MenuResult, Profile } from '../../../snapmenu-api/src/types'
import { dayKey, eatenOf, entriesOf, mealsLeft, pruneLog, remainingOf } from '../../../snapmenu-api/src/me/day'
import { personalize, type DayCtx, type MeCtx } from '../../../snapmenu-api/src/me/rank'
import { snapOfDish } from '../../../snapmenu-api/src/me/snap'
import { readTaste } from '../../../snapmenu-api/src/me/taste'
import { readTargets, validBody, type Body } from '../../../snapmenu-api/src/me/targets'
import type { DishSnap, LogEntry, Meal, Nutrition, Remaining, Targets, Taste } from '../../../snapmenu-api/src/me/types'

/** A dish from a scan, kept for the quick log and for "Today for you". */
export interface Scanned { dish: DishSnap; cuisine: string | null; ts: number }

export interface MeState {
  /** Only the person's own targets are saved; until then they follow the goal. */
  targets: Targets | null
  body: Body | null
  taste: Taste
  /** The taste questions were answered or skipped once: do not ask again. */
  tasteAsked: boolean
  log: LogEntry[]
  favorites: DishSnap[]
  meals: Meal[]
  /** The meal being built. */
  draft: DishSnap[]
  scanned: Scanned[]
}

const KEY = 'snapmenu.me'
const MAX_SCANNED = 36
const MAX_FAVORITES = 60
const MAX_MEALS = 30
const MAX_DRAFT = 8

const list = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
const isSnap = (d: unknown): d is DishSnap => Boolean(d) && typeof (d as DishSnap).key === 'string' && typeof (d as DishSnap).name === 'string' && typeof (d as DishSnap).kcal?.mid === 'number'

function load(): MeState {
  let raw: Record<string, unknown> = {}
  try {
    const v = window.localStorage.getItem(KEY)
    if (v) raw = JSON.parse(v) as Record<string, unknown>
  } catch { /* storage blocked or damaged: start empty */ }
  const t = raw['targets']
  return {
    targets: t && typeof t === 'object' && (t as Targets).custom === true ? (t as Targets) : null,
    body: validBody(raw['body']),
    taste: readTaste(raw['taste']),
    tasteAsked: raw['tasteAsked'] === true,
    log: pruneLog(list<LogEntry>(raw['log']).filter((e) => isSnap(e?.dish) && typeof e.day === 'string'), new Date()),
    favorites: list<DishSnap>(raw['favorites']).filter(isSnap),
    meals: list<Meal>(raw['meals']).filter((m) => typeof m?.id === 'string' && Array.isArray(m.items) && m.items.every(isSnap)),
    draft: list<DishSnap>(raw['draft']).filter(isSnap),
    scanned: list<Scanned>(raw['scanned']).filter((s) => isSnap(s?.dish)),
  }
}

let state: MeState = typeof window === 'undefined'
  ? { targets: null, body: null, taste: { cuisines: [], likes: [], dislikes: [] }, tasteAsked: false, log: [], favorites: [], meals: [], draft: [], scanned: [] }
  : load()
const listeners = new Set<() => void>()

function set(patch: Partial<MeState>) {
  state = { ...state, ...patch }
  try { window.localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* keep going in memory */ }
  listeners.forEach((l) => l())
}

const id = () => (crypto.randomUUID ? crypto.randomUUID() : `m-${Date.now()}-${Math.random().toString(36).slice(2)}`)

export const me = {
  get: () => state,

  setTargets: (targets: Targets | null) => set({ targets }),
  setBody: (body: Body | null) => set({ body }),
  setTaste: (taste: Taste) => set({ taste }),
  tasteDone: () => set({ tasteAsked: true }),

  /** Log a dish for today. */
  log(dish: DishSnap, portion = 1): LogEntry {
    const now = new Date()
    const entry: LogEntry = { id: id(), day: dayKey(now), ts: now.getTime(), portion, dish }
    set({ log: pruneLog([...state.log, entry], now) })
    return entry
  },
  unlog: (entryId: string) => set({ log: state.log.filter((e) => e.id !== entryId) }),
  setPortion: (entryId: string, portion: number) => set({ log: state.log.map((e) => (e.id === entryId ? { ...e, portion } : e)) }),

  isFavorite: (key: string) => state.favorites.some((f) => f.key === key),
  /** Save or unsave a dish. Returns whether it is saved now. */
  toggleFavorite(dish: DishSnap): boolean {
    const had = state.favorites.some((f) => f.key === dish.key)
    set({ favorites: had ? state.favorites.filter((f) => f.key !== dish.key) : [dish, ...state.favorites].slice(0, MAX_FAVORITES) })
    return !had
  },

  /** Add a dish to the meal being built. False when the meal is full. */
  addToDraft(dish: DishSnap): boolean {
    if (state.draft.length >= MAX_DRAFT) return false
    set({ draft: [...state.draft, dish] })
    return true
  },
  removeFromDraft: (index: number) => set({ draft: state.draft.filter((_d, i) => i !== index) }),
  setDraft: (draft: DishSnap[]) => set({ draft: draft.slice(0, MAX_DRAFT) }),

  saveMeal(name: string, items: DishSnap[]): Meal {
    const meal: Meal = { id: id(), name: name.trim().slice(0, 40) || items.map((i) => i.name).join(' + ').slice(0, 40), ts: Date.now(), items }
    set({ meals: [meal, ...state.meals].slice(0, MAX_MEALS) })
    return meal
  },
  removeMeal: (mealId: string) => set({ meals: state.meals.filter((m) => m.id !== mealId) }),

  /** Remember the dishes of a scan: the picks first, nothing that hit the person's allergies, no drinks. */
  noteScan(result: MenuResult, place: string | null) {
    const order = new Map(result.top.map((dishId, i) => [dishId, i]))
    const keep = (d: DishEstimate) => d.course !== 'drink' && d.kcal.mid > 0 && d.userAllergenHits.length === 0 && d.rows.some((r) => r.counted)
    const fresh: Scanned[] = result.dishes
      .filter(keep)
      .sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99) || b.score - a.score)
      .slice(0, 16)
      .map((d) => ({ dish: snapOfDish(d, { place: place ?? result.restaurant, goal: result.profile.goal, from: 'scan' }), cuisine: result.cuisine || null, ts: Date.now() }))
    const keys = new Set(fresh.map((s) => s.dish.key))
    set({ scanned: [...fresh, ...state.scanned.filter((s) => !keys.has(s.dish.key))].slice(0, MAX_SCANNED) })
  },
}

export function useMe(): MeState {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => state, () => state)
}

/** Re-renders when the phone comes back to the app or the hour changes, so "today" is never yesterday. */
function useClock(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const tick = () => setNow(new Date())
    const onShow = () => { if (document.visibilityState === 'visible') tick() }
    document.addEventListener('visibilitychange', onShow)
    const t = window.setInterval(tick, 10 * 60_000)
    return () => { document.removeEventListener('visibilitychange', onShow); window.clearInterval(t) }
  }, [])
  return now
}

export interface Day {
  targets: Targets
  /** Today's entries, oldest first. */
  entries: LogEntry[]
  eaten: Nutrition
  left: Remaining
  /** For the ranking: null until something was logged today. */
  ctx: DayCtx | null
}

/** Today for this person: targets, what was eaten, what is left. */
export function useDay(goal: Profile['goal']): Day {
  const s = useMe()
  const now = useClock()
  const day = dayKey(now)
  const hour = now.getHours()
  return useMemo(() => {
    const targets = readTargets(s.targets, goal, s.body)
    const entries = entriesOf(s.log, day)
    const eaten = eatenOf(entries)
    const left = remainingOf(targets, eaten)
    return { targets, entries, eaten, left, ctx: entries.length > 0 ? { left, mealsLeft: mealsLeft(hour) } : null }
  }, [s.targets, s.body, s.log, goal, day, hour])
}

/** A scanned menu, ranked again for this person's taste and what is left of their day. */
export function useMyResult(result: MenuResult | null): MenuResult | null {
  const s = useMe()
  const day = useDay(result?.profile.goal ?? 'balanced')
  return useMemo(() => {
    if (!result) return null
    const ctx: MeCtx = { taste: s.taste, day: day.ctx }
    return personalize(result, ctx)
  }, [result, s.taste, day.ctx])
}

export const GOAL_FALLBACK: Profile['goal'] = 'balanced'
