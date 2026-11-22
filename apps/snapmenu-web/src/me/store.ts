// Device-first storage. An optional account syncs favorites and goals; logs and meals stay on-device.
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

/** Someone who skipped the interview still gets a working day. */
export const GOAL_FALLBACK: Profile['goal'] = 'balanced'

const KEY = 'snapmenu.me'
const MAX_SCANNED = 36
const MAX_FAVORITES = 60
const MAX_MEALS = 30
const MAX_DRAFT = 8

const list = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isRange = (r: unknown): boolean => Boolean(r) && typeof r === 'object' && num((r as { low?: unknown }).low) && num((r as { high?: unknown }).high) && num((r as { mid?: unknown }).mid)
/** A saved dish that every screen can show without checking again: names, four ranges, a width. */
const isSnap = (d: unknown): d is DishSnap => {
  if (!d || typeof d !== 'object') return false
  const x = d as Partial<DishSnap>
  return typeof x.key === 'string' && typeof x.name === 'string' && typeof x.words === 'string' && typeof x.why === 'string' && num(x.half) && num(x.fit)
    && isRange(x.kcal) && isRange(x.protein) && isRange(x.carbs) && isRange(x.fat)
}
const isEntry = (e: unknown): e is LogEntry => {
  if (!e || typeof e !== 'object') return false
  const x = e as Partial<LogEntry>
  return typeof x.id === 'string' && typeof x.day === 'string' && num(x.ts) && num(x.portion) && x.portion > 0 && x.portion <= 10 && isSnap(x.dish)
}

function load(): MeState {
  let raw: Record<string, unknown> = {}
  try {
    const v = window.localStorage.getItem(KEY)
    const parsed: unknown = v ? JSON.parse(v) : null
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) raw = parsed as Record<string, unknown>
  } catch { /* storage blocked or damaged: start empty */ }
  const t = raw['targets']
  return {
    targets: t && typeof t === 'object' && (t as Targets).custom === true ? (t as Targets) : null,
    body: validBody(raw['body']),
    taste: readTaste(raw['taste']),
    tasteAsked: raw['tasteAsked'] === true,
    log: pruneLog(list<unknown>(raw['log']).filter(isEntry), new Date()),
    favorites: list<unknown>(raw['favorites']).filter(isSnap),
    meals: list<Meal>(raw['meals']).filter((m) => Boolean(m) && typeof m.id === 'string' && typeof m.name === 'string' && Array.isArray(m.items) && m.items.length > 0 && m.items.every(isSnap)),
    draft: list<unknown>(raw['draft']).filter(isSnap),
    scanned: list<Scanned>(raw['scanned']).filter((s) => Boolean(s) && isSnap(s.dish)).map((s) => ({ dish: s.dish, cuisine: typeof s.cuisine === 'string' ? s.cuisine : null, ts: num(s.ts) ? s.ts : 0 })),
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
  restoreAccount(goals: { targets?: Targets | null; body?: Body | null; taste?: Taste; tasteAsked?: boolean }, favorites: unknown) {
    const targets = goals?.targets
    set({ targets: targets?.custom && [targets.kcal, targets.protein, targets.carbs, targets.fat].every(num) ? targets : null, body: validBody(goals?.body), taste: readTaste(goals?.taste), tasteAsked: goals?.tasteAsked === true, favorites: list<unknown>(favorites).filter(isSnap).slice(0, MAX_FAVORITES) })
  },

  setTargets: (targets: Targets | null) => set({ targets }),
  setBody: (body: Body | null) => set({ body }),
  setTaste: (taste: Taste) => set({ taste }),
  tasteDone: () => set({ tasteAsked: true }),

  /** Log a dish for today. `scan` is the scan it was picked from, when it was picked on a menu. */
  log(dish: DishSnap, portion = 1, scan?: string): LogEntry {
    const now = new Date()
    const entry: LogEntry = { id: id(), day: dayKey(now), ts: now.getTime(), portion, dish, ...(scan ? { scan } : {}) }
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

  /** Taste and what is left today, sent with a scan so the person's own picks get the "how to order" words too. */
  forScan(goal: Profile['goal']): MeCtx {
    const now = new Date()
    const entries = entriesOf(state.log, dayKey(now))
    const left = remainingOf(readTargets(state.targets, goal, state.body), eatenOf(entries))
    return { taste: state.taste, day: entries.length > 0 ? { left, mealsLeft: mealsLeft(now.getHours()) } : null }
  },

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
  /** Meals the rest of the day still holds, by the hour. */
  meals: number
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
    const meals = mealsLeft(hour)
    return { targets, entries, eaten, left, meals, ctx: entries.length > 0 ? { left, mealsLeft: meals } : null }
  }, [s.targets, s.body, s.log, goal, day, hour])
}

/**
 * A scanned menu, ranked again for this person's taste and what is left of their day.
 * `profile` is the profile as it is now: the targets follow its goal, and a dish that hits an allergy or
 * breaks a diet added since the scan is never a pick (the scan keeps the profile it was ranked for).
 */
export function useMyResult(result: MenuResult | null, profile?: Profile | null): MenuResult | null {
  const s = useMe()
  const day = useDay(profile?.goal ?? result?.profile.goal ?? GOAL_FALLBACK)
  return useMemo(() => {
    if (!result) return null
    // What was eaten from this very menu is this meal: the menu stays ranked for what was left before it,
    // so the dish someone just picked here does not turn into "more than you have left".
    const before = day.entries.filter((e) => e.scan !== result.scanId)
    const ctx: MeCtx = {
      taste: s.taste,
      day: before.length > 0 ? { left: remainingOf(day.targets, eatenOf(before)), mealsLeft: day.meals } : null,
      now: profile ?? undefined,
    }
    try {
      return personalize(result, ctx)
    } catch {
      // A scan kept from an older version may not have every field: show it as it was scanned.
      return result
    }
  }, [result, profile, s.taste, day.entries, day.targets, day.meals])
}
