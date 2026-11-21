import type { Profile } from '../../../snapmenu-api/src/types'

/** localStorage, always wrapped: private windows and blocked storage must not break the app. */
function read<T>(key: string): T | null {
  try {
    const v = window.localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : null
  } catch {
    return null
  }
}
function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable: keep going in memory */
  }
}

let memoryDevice: string | null = null

export const store = {
  profile: () => read<Profile>('snapmenu.profile'),
  saveProfile: (p: Profile) => write('snapmenu.profile', p),
  clearProfile: () => {
    try { window.localStorage.removeItem('snapmenu.profile') } catch { /* ignore */ }
  },
  deviceId(): string {
    const existing = read<string>('snapmenu.device')
    if (existing) return existing
    memoryDevice ??= crypto.randomUUID ? crypto.randomUUID() : `d-${Date.now()}-${Math.random().toString(36).slice(2)}`
    write('snapmenu.device', memoryDevice)
    return memoryDevice
  },
  /** Team devices are excluded from /numbers. Open the app once with ?team=1. */
  isTeam(): boolean {
    try {
      const q = new URLSearchParams(window.location.search).get('team')
      if (q === '1') write('snapmenu.team', true)
      if (q === '0') write('snapmenu.team', false)
    } catch { /* ignore */ }
    return read<boolean>('snapmenu.team') === true
  },
  lastResult: () => read<unknown>('snapmenu.last'),
  saveLastResult: (r: unknown) => write('snapmenu.last', r),
}
