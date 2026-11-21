// The Me tab and the screens behind it. The app knows one screen, "me"; which of these views is open
// lives in the browser history, so the phone's back button walks back through them like any other screen.
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { Place, Profile } from '../../../snapmenu-api/src/types'
import { store } from '../lib/storage'
import { Favorites } from './Favorites'
import { Hub } from './Hub'
import { MealBuilder } from './MealBuilder'
import { QuickLog } from './QuickLog'
import { TargetsEditor } from './TargetsEditor'
import { TasteEditor } from './TasteEditor'
import { GOAL_FALLBACK } from './store'
import './me.css'

export type View = 'home' | 'log' | 'targets' | 'taste' | 'favorites' | 'meal'
const VIEWS: View[] = ['home', 'log', 'targets', 'taste', 'favorites', 'meal']
const asView = (v: unknown): View => (VIEWS.includes(v as View) ? (v as View) : 'home')

let pending: View | null = null
let mounted: ((v: View) => void) | null = null
/**
 * Ask for a view, right before the app switches to the Me tab: 'taste' from a
 * scan result, 'home' when the Me tab itself is tapped (so a second tap on the
 * tab leads back to its first page, like any tab).
 */
export function requestMeView(v: View) {
  if (mounted) mounted(v)
  else pending = v
}

const fromHistory = (): View => {
  try { return asView((history.state as { me?: unknown } | null)?.me) } catch { return 'home' }
}

export function MeSpace({ profile, toast, onPlace, onScan, home }: {
  profile: Profile | null
  toast: (t: string) => void
  /** Open a restaurant on the map. */
  onPlace: (p: Place) => void
  onScan: () => void
  /** The Me screen itself, with this module's part as its top. */
  home: (top: ReactNode) => ReactNode
}) {
  const [view, setView] = useState<View>(() => {
    if (!pending) return fromHistory()
    const v = pending
    pending = null
    // Opened from another screen: back returns there, not to the Me tab's first page.
    try { history.replaceState({ ...(history.state as object | null), s: 'me', me: v }, '') } catch { /* ignore */ }
    return v
  })

  useEffect(() => {
    const onPop = () => setView(fromHistory())
    window.addEventListener('popstate', onPop)
    mounted = (v) => { setView(v); window.scrollTo({ top: 0 }) }
    return () => { window.removeEventListener('popstate', onPop); mounted = null }
  }, [])

  const open = useCallback((v: View) => {
    setView(v)
    try { history.pushState({ s: 'me', me: v }, '') } catch { /* ignore */ }
    window.scrollTo({ top: 0 })
  }, [])
  const back = useCallback(() => history.back(), [])

  // Someone who skipped the interview still gets a working day: a balanced goal in the phone's language.
  const p: Profile = profile ?? { goal: GOAL_FALLBACK, allergies: [], language: store.language() }

  switch (view) {
    case 'log': return <QuickLog profile={p} onBack={back} toast={toast} />
    case 'targets': return <TargetsEditor profile={p} onBack={back} />
    case 'taste': return <TasteEditor onDone={back} />
    case 'favorites': return <Favorites onBack={back} toast={toast} onBuild={() => open('meal')} />
    case 'meal': return <MealBuilder profile={p} onBack={back} toast={toast} />
    default: return <>{home(<Hub profile={p} open={open} toast={toast} onPlace={onPlace} onScan={onScan} />)}</>
  }
}
