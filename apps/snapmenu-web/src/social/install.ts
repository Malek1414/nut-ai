// "Add to Home Screen": whether this browser can install the app, and how.
import { track } from '../lib/api'

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: InstallPromptEvent | null = null
const watchers = new Set<() => void>()
const changed = () => watchers.forEach((w) => w())

if (typeof window !== 'undefined') {
  // Chrome and friends on Android fire this when the app is installable. Kept until a button asks for it.
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as InstallPromptEvent
    changed()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    track('pwa_install', {})
    changed()
  })
}

const ua = () => (typeof navigator === 'undefined' ? '' : navigator.userAgent)

/** Already opened from the home screen. */
export function isStandalone(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
  } catch {
    return false
  }
}

/** The browser inside Instagram, Facebook, TikTok and the like: it cannot add anything to the home screen. */
export const isInAppBrowser = (): boolean => /Instagram|FBAN|FBAV|FB_IAB|TikTok|musical_ly|Line\/|Snapchat|Pinterest|LinkedInApp/i.test(ua())

/** Safari on an iPhone or iPad: no install prompt there, the way is Share, then "Add to Home Screen". */
export const isIosSafari = (): boolean => /iPhone|iPad|iPod/i.test(ua()) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua()) && !isInAppBrowser()

export type InstallWay = 'prompt' | 'ios' | null

/** How this phone can install the app right now, or null when it cannot (or already has). */
export function installWay(): InstallWay {
  if (typeof window === 'undefined' || isStandalone()) return null
  if (deferred) return 'prompt'
  return isIosSafari() ? 'ios' : null
}

/** Show the browser's own install prompt. Resolves to whether the person said yes. */
export async function promptInstall(): Promise<boolean> {
  const ev = deferred
  if (!ev) return false
  deferred = null
  changed()
  try {
    await ev.prompt()
    return (await ev.userChoice).outcome === 'accepted'
  } catch {
    return false
  }
}

export function onInstallChange(fn: () => void): () => void {
  watchers.add(fn)
  return () => { watchers.delete(fn) }
}
