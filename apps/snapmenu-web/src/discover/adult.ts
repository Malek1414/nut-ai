// "Are you 18 or older?", asked once and kept on this phone. Alcoholic drinks stay hidden unless the answer is yes.
// A tiny store like lib/position.ts: no account, nothing leaves the phone.
import { useSyncExternalStore } from 'react'

/** 'yes': confirmed 18 or older. 'no': keep alcohol hidden. null: never asked. */
export type AdultAnswer = 'yes' | 'no' | null

const KEY = 'snapmenu.adult'
const listeners = new Set<() => void>()

function load(): AdultAnswer {
  try {
    // Plain 'yes' / 'no'; a JSON-quoted value reads the same.
    const v = window.localStorage.getItem(KEY)?.replace(/"/g, '')
    return v === 'yes' || v === 'no' ? v : null
  } catch {
    return null
  }
}

let state: AdultAnswer = typeof window === 'undefined' ? null : load()

export const getAdult = (): AdultAnswer => state

export function setAdult(v: 'yes' | 'no'): void {
  state = v
  try { window.localStorage.setItem(KEY, v) } catch { /* storage blocked: the answer holds until the page closes */ }
  listeners.forEach((l) => l())
}

export function useAdult(): AdultAnswer {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => state, () => state)
}
