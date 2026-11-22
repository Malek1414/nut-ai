// Table mode starts with one photo of the menu, read by the same scan as everywhere else in the app.
// The dishes then belong to the table: everyone gets a pick from this one menu, with or without a restaurant listing.
import { useEffect, useRef, useState } from 'react'
import type { MenuResult, Profile } from '../../../snapmenu-api/src/types'
import { errorText } from '../../../snapmenu-api/src/voice/index'
import { Icon } from '../components/ui'
import { ApiError, scanMenu, track } from '../lib/api'
import { compressImage } from '../lib/image'
import { store } from '../lib/storage'
import { Scanning } from '../screens/Scanning'
import { menuOf, openGroup, setGroupMenu } from './api'

/** The scan needs a profile for its own ranking; a table ranks per person afterwards, so a neutral one does. */
const scanProfile = (): Profile => store.profile() ?? { goal: 'balanced', allergies: [], language: store.language() }

/** Seat a table on a scan: a new table, or the menu for a group that just arrived at the restaurant. */
export async function seatTable(result: MenuResult, groupId: string | null): Promise<string> {
  const menu = menuOf(result)
  if (groupId) { await setGroupMenu(groupId, menu); return groupId }
  return (await openGroup({ kind: 'table', menu })).id
}

export function TableScan({ groupId, go }: { groupId: string | null; go: (path: string, replace?: boolean) => void }) {
  const cameraRef = useRef<HTMLInputElement>(null)
  const pickRef = useRef<HTMLInputElement>(null)
  const abort = useRef<AbortController | null>(null)
  const [photo, setPhoto] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const last = store.lastResult() as MenuResult | null
  useEffect(() => () => abort.current?.abort(), [])

  const seat = async (result: MenuResult) => {
    const id = await seatTable(result, groupId)
    track('table_open', { dishes: result.dishes.length, fromGroup: Boolean(groupId) })
    go(`/g/${id}`, true)
  }

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setBusy(true)
    setError(null)
    const lang = store.language()
    let dataUrl: string
    try {
      dataUrl = (await compressImage(f)).dataUrl
    } catch {
      setBusy(false)
      setError(errorText(lang, 'photo').message)
      return
    }
    const ctrl = new AbortController()
    abort.current = ctrl
    setPhoto(dataUrl)
    try {
      const result = await scanMenu(dataUrl, scanProfile(), ctrl.signal, { table: true })
      store.saveLastResult(result)
      await seat(result)
    } catch (err) {
      if (err instanceof ApiError && err.code === 'aborted') return
      setError(err instanceof Error ? err.message : errorText(lang, 'oops').message)
    } finally {
      setPhoto(null)
      setBusy(false)
    }
  }

  const useLast = async () => {
    if (!last) return
    setBusy(true)
    setError(null)
    try { await seat(last) } catch (err) { setError(err instanceof Error ? err.message : errorText(store.language(), 'oops').message); setBusy(false) }
  }

  if (photo) return <Scanning photo={photo} onCancel={() => { abort.current?.abort(); setPhoto(null); setBusy(false) }} />

  return (
    <main className={`screen with-cta capture g-scan ${last && last.dishes?.length > 0 ? 'g-scan--three' : ''}`}>
      <div className="topbar">
        {/* Opened straight from a link there is nothing to go back to: then the start page is "back". */}
        <button className="icon-btn" onClick={() => (window.history.length > 1 ? window.history.back() : go('/g', true))} aria-label="Back"><Icon name="back" /></button>
      </div>
      <header className="results-head">
        <h1 className="h1">Snap the menu</h1>
        <p className="body">One photo. A pick for everyone at the table.</p>
      </header>

      {error && <div className="banner" role="alert"><Icon name="info" size={18} /><span>{error}</span></div>}

      <button className="capture-stage" disabled={busy} onClick={() => cameraRef.current?.click()} aria-label="Take a photo of the menu">
        <svg viewBox="0 0 400 400" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <rect width="400" height="400" fill="#10201A" />
          <g transform="rotate(-3 200 190)" opacity=".92">
            <rect x="112" y="48" width="176" height="236" rx="16" fill="#F3F5EF" />
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <g key={i}>
                <rect x="130" y={76 + i * 32} width={[92, 116, 80, 104, 88, 120][i]} height="9" rx="4.5" fill="#1E6B4E" opacity={i === 1 || i === 3 || i === 4 ? 0.7 : 0.25} />
                <rect x="246" y={76 + i * 32} width="24" height="9" rx="4.5" fill="#1E6B4E" opacity=".45" />
              </g>
            ))}
          </g>
          {/* three people, three picks */}
          {[['#1E6B4E', 136, 108], ['#3B63D6', 200, 172], ['#C8456B', 264, 204]].map(([c, x, y]) => (
            <g key={x}>
              <path d={`M${x} 326 V${Number(y) + 14}`} stroke={c as string} strokeWidth="3" strokeDasharray="2 7" strokeLinecap="round" opacity=".9" />
              <circle cx={x} cy="340" r="20" fill={c as string} stroke="#10201A" strokeWidth="4" />
            </g>
          ))}
          <path d="M64 88V62a22 22 0 0 1 22-22h26M336 88V62a22 22 0 0 0-22-22h-26" fill="none" stroke="#F2B33D" strokeWidth="6" strokeLinecap="round" />
        </svg>
      </button>

      <input ref={cameraRef} className="sr-only" type="file" accept="image/*" capture="environment" onChange={(e) => void onFile(e)} tabIndex={-1} aria-hidden="true" />
      <input ref={pickRef} className="sr-only" type="file" accept="image/*" onChange={(e) => void onFile(e)} tabIndex={-1} aria-hidden="true" />
      <div className="cta-bar">
        <button className="btn btn-primary" disabled={busy} onClick={() => cameraRef.current?.click()}>
          <Icon name="camera" size={22} /> {busy ? 'Preparing…' : 'Take a photo'}
        </button>
        {last && last.dishes?.length > 0
          ? <button className="btn btn-secondary" disabled={busy} onClick={() => void useLast()}><Icon name="receipt" size={20} /> <span className="g-scan__last">Use my last scan{last.restaurant ? `: ${last.restaurant}` : ''}</span></button>
          : <button className="btn btn-secondary" disabled={busy} onClick={() => pickRef.current?.click()}><Icon name="image" size={20} /> Choose a photo</button>}
        {last && last.dishes?.length > 0 && <button className="link-btn" disabled={busy} onClick={() => pickRef.current?.click()}>Choose a photo</button>}
      </div>
    </main>
  )
}
