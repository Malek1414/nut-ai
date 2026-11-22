// Eating together, as its own small set of pages inside the app:
//
//   /g            start: plan a meal out, or pick for the table
//   /g/CODE       one group (the link friends get)
//   /g/CODE/scan  the group arrived: scan the menu
//   /table        scan a menu and open a table
//
// App.tsx renders this for those paths (see `isGroupPath`). Everything else of the app is one tap away at "/".
import { useCallback, useEffect, useRef, useState } from 'react'
import { Footer, Icon, Toast, Wordmark } from '../components/ui'
import { track } from '../lib/api'
import { declinePosition, getPosition, requestPosition } from '../lib/position'
import { openGroup, recentGroups } from './api'
import { GroupPage } from './GroupPage'
import { TableScan } from './TableScan'
import './group.css'

type Route = { view: 'hub' } | { view: 'group'; id: string } | { view: 'scan'; id: string | null }

export const isGroupPath = (path: string) => /^\/(g|table)(\/|$)/.test(path)

export function parseRoute(path: string): Route {
  const m = /^\/g\/([A-Za-z0-9]{8})(\/scan)?\/?$/.exec(path)
  if (m) return m[2] ? { view: 'scan', id: m[1]!.toUpperCase() } : { view: 'group', id: m[1]!.toUpperCase() }
  return /^\/table\/?$/.test(path) ? { view: 'scan', id: null } : { view: 'hub' }
}

export function GroupApp() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname))
  const [toast, setToast] = useState<string | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const go = useCallback((path: string, replace = false) => {
    try {
      if (replace) window.history.replaceState({ g: path }, '', path)
      else window.history.pushState({ g: path }, '', path)
    } catch { /* ignore */ }
    setRoute(parseRoute(path))
    window.scrollTo({ top: 0 })
  }, [])
  useEffect(() => {
    const onPop = () => setRoute(parseRoute(window.location.pathname))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const showToast = useCallback((t: string) => {
    setToast(t)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setToast(null), 2600)
  }, [])

  return (
    <>
      {route.view === 'hub' && <Hub go={go} toast={showToast} />}
      {route.view === 'group' && <GroupPage key={route.id} id={route.id} go={go} toast={showToast} />}
      {route.view === 'scan' && <TableScan groupId={route.id} go={go} />}
      <Toast text={toast} />
    </>
  )
}

/**
 * Where the group is: the phone's position, asked for once. Without it the group has no position of
 * its own; the search then runs around the app's fallback (Berlin Mitte) and the page says so.
 */
async function whereAmI(): Promise<{ lat: number; lng: number } | Record<string, never>> {
  if (getPosition().status !== 'granted' && !getPosition().asked) {
    const answered = await Promise.race([requestPosition(), new Promise<null>((r) => window.setTimeout(() => r(null), 7000))])
    if (!answered) declinePosition()
  }
  const now = getPosition()
  return now.status === 'granted' ? now.position : {}
}

function Hub({ go, toast }: { go: (path: string, replace?: boolean) => void; toast: (t: string) => void }) {
  const [busy, setBusy] = useState(false)
  const recent = recentGroups()

  const plan = async () => {
    setBusy(true)
    try {
      const { id } = await openGroup({ kind: 'group', ...(await whereAmI()) })
      track('group_start', {})
      go(`/g/${id}`)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'That did not work. Try again.')
      setBusy(false)
    }
  }

  return (
    <main className="screen g-hub">
      <div className="topbar"><Wordmark onClick={() => window.location.assign('/')} /></div>
      <header className="g-hub__head">
          <h1 className="display">Eat together.</h1>
          <p className="lead">Share your preferences. Find a place or pick from the menu together.</p>
      </header>

      <div className="options">
        <button className="option" onClick={() => void plan()} disabled={busy}>
          <span className="o-icon" style={{ background: 'var(--basil-tint)', color: 'var(--basil)' }}>{busy ? <span className="attach__spin" /> : <Icon name="users" size={22} />}</span>
          <span className="o-text"><span className="o-title">Plan a meal out</span><span className="o-sub">One link. Places that fit everyone.</span></span>
          <Icon name="chevron" size={20} />
        </button>
        <button className="option" onClick={() => go('/table')} disabled={busy}>
          <span className="o-icon" style={{ background: 'var(--saffron-tint)', color: '#7a5208' }}><Icon name="camera" size={22} /></span>
          <span className="o-text"><span className="o-title">We are at the table</span><span className="o-sub">One menu. A pick for each of you.</span></span>
          <Icon name="chevron" size={20} />
        </button>
      </div>

      {recent.length > 0 && (
        <section className="g-recent" aria-label="Your groups">
          <h2 className="eyebrow">Pick up where you were</h2>
          <div className="card-flat list-card">
            {recent.map((r) => (
              <button key={r.id} className="set-row" onClick={() => go(`/g/${r.id}`)}>
                <span className="set-row__ic" style={{ background: 'var(--bg)', color: 'var(--ink-2)' }}><Icon name={r.kind === 'table' ? 'receipt' : 'users'} size={18} /></span>
                <span className="set-row__label g-recent__label">{r.label}</span>
                <span className="spacer" />
                <Icon name="chevron" size={18} />
              </button>
            ))}
          </div>
        </section>
      )}
      <Footer />
    </main>
  )
}
