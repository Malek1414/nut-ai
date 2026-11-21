// Mounted once in App. Everything this folder shows on its own lives here: the page a share link
// opens to, "Save a meal from a link", the share sheet and the Premium sheet.
//
// The two pages are full screens above the app, opened by address ("/s/<id>", "/?s=<id>",
// "/import?url=…" from the phone's share sheet) or by a button anywhere (`social` in ./bus).
// The address decides what is open, so the phone's back button and a reload both do the right thing.
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { importTargetFrom, shareIdFrom } from '../../../snapmenu-api/src/social/links'
import type { Place, Profile } from '../../../snapmenu-api/src/types'
import { track } from '../lib/api'
import { social, type Command } from './bus'
import { currentSource, type ShareItem } from './client'
import { ImportScreen } from './ImportScreen'
import { PremiumSheet } from './Premium'
import { SharedView } from './SharedView'
import { ShareSheet } from './ShareSheet'
import './social.css'

type Page = { name: 'shared'; id: string } | { name: 'import'; url: string | null } | null

function pageFromLocation(): Page {
  const { pathname, search } = window.location
  const id = shareIdFrom(pathname, search)
  if (id) return { name: 'shared', id }
  const target = importTargetFrom(pathname, search)
  return target ? { name: 'import', url: target.url } : null
}

/** The app's own screen under the page, as App keeps it in the history entry. */
const appScreen = (): string => ((window.history.state as { s?: string } | null)?.s ?? 'landing')

export function SocialLayer({ profile, onScan, onViewPlace, toast }: {
  profile: Profile | null
  /** Start a scan (the app's own "Scan a menu"). */
  onScan: () => void
  /** Open the map on a restaurant. */
  onViewPlace: (place: Place) => void
  toast: (t: string) => void
}) {
  const [page, setPage] = useState<Page>(pageFromLocation)
  const [sharing, setSharing] = useState<ShareItem | null>(null)
  const [premium, setPremium] = useState(false)

  // Where this visit came from, once per load: "instagram" for the Instagram link, "homescreen" for the installed app.
  useEffect(() => {
    const source = currentSource()
    if (source) track('landing', { source, path: window.location.pathname })
  }, [])

  useEffect(() => {
    const onPop = () => setPage(pageFromLocation())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => social.on((c: Command) => {
    if (c.type === 'share') setSharing(c.item)
    else if (c.type === 'premium') setPremium(true)
    else {
      // A new history entry with its own address: back closes the page, a reload keeps it.
      try { window.history.pushState({ s: appScreen(), social: 'import' }, '', c.url ? `/import?url=${encodeURIComponent(c.url)}` : '/import') } catch { /* ignore */ }
      setPage({ name: 'import', url: c.url ?? null })
    }
  }), [])

  /** Take the page away and put the address back to the app's own. */
  const clear = useCallback(() => {
    try { window.history.replaceState({ s: appScreen() }, '', '/') } catch { /* ignore */ }
    setPage(null)
  }, [])
  /** Close: back to where the page was opened from, or to the start when a link opened it. */
  const close = useCallback(() => {
    if ((window.history.state as { social?: string } | null)?.social) window.history.back()
    else clear()
  }, [clear])

  return (
    <>
      {page && createPortal(
        <div className="so-page" key={page.name === 'shared' ? `s-${page.id}` : 'import'}>
          {page.name === 'shared' && (
            <SharedView id={page.id} onClose={clear} onScan={() => { clear(); onScan() }} onViewPlace={(p) => { clear(); onViewPlace(p) }} />
          )}
          {page.name === 'import' && <ImportScreen initialUrl={page.url} profile={profile} onBack={close} toast={toast} />}
        </div>,
        document.body,
      )}
      {sharing && <ShareSheet item={sharing} onClose={() => setSharing(null)} toast={toast} />}
      {premium && <PremiumSheet onClose={() => setPremium(false)} toast={toast} />}
    </>
  )
}
