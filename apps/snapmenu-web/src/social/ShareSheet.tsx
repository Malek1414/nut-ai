// Share a dish, a pick or a restaurant as a link. The sheet shows what a friend will see (the preview
// picture and its two lines) and has one clear action: "Share link".
import { useEffect, useState } from 'react'
import { saySocial } from '../../../snapmenu-api/src/social/copy'
import { Icon, Sheet } from '../components/ui'
import { track } from '../lib/api'
import { renderShareCard, shareCard } from '../lib/share'
import { store } from '../lib/storage'
import { renderLinkCard } from './card'
import { createShare, SocialError, type MadeShare, type ShareItem } from './client'

interface Made { image: string | null; share: MadeShare }

// One link per item and try: opening the sheet twice in a row (React's double effect in dev) must not make two.
const inFlight = new WeakMap<ShareItem, Map<number, Promise<Made>>>()
function makeOnce(item: ShareItem, attempt: number, onImage: (img: string) => void): Promise<Made> {
  let tries = inFlight.get(item)
  if (!tries) { tries = new Map(); inFlight.set(item, tries) }
  let p = tries.get(attempt)
  if (!p) {
    p = (async () => {
      let image: string | null = null
      // Without a picture the link still works: it then previews with the app's own.
      try { image = await renderLinkCard(item) } catch { image = null }
      if (image) onImage(image)
      return { image, share: await createShare(item, image) }
    })()
    tries.set(attempt, p)
  } else {
    void p.then((m) => { if (m.image) onImage(m.image) }, () => {})
  }
  return p
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Older browsers and pages without clipboard permission: select and copy.
    try {
      const el = document.createElement('textarea')
      el.value = text
      el.setAttribute('readonly', '')
      el.style.position = 'fixed'
      el.style.opacity = '0'
      document.body.appendChild(el)
      el.select()
      const ok = document.execCommand('copy')
      el.remove()
      return ok
    } catch {
      return false
    }
  }
}

export function ShareSheet({ item, onClose, toast }: { item: ShareItem; onClose: () => void; toast: (t: string) => void }) {
  const [image, setImage] = useState<string | null>(null)
  const [made, setMade] = useState<MadeShare | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    setError(null)
    setMade(null)
    makeOnce(item, attempt, (img) => live && setImage(img)).then(
      (m) => { if (live) setMade(m.share) },
      (e) => { if (live) setError(e instanceof SocialError ? e.message : saySocial(store.language(), 'share_failed')) },
    )
    return () => { live = false }
  }, [item, attempt])

  const url = made ? `${window.location.origin}${made.path}` : null
  const canNative = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
  const heading = item.kind === 'place' ? 'Share this place' : item.kind === 'pick' ? 'Share your pick' : 'Share this dish'
  const title = made?.title ?? (item.kind === 'place' ? item.place.name : item.dish.name)

  const copy = async () => {
    if (!url) return
    const ok = await copyText(url)
    toast(ok ? 'Link copied' : 'Could not copy the link')
    if (ok) track('share_send', { kind: item.kind, how: 'copy' })
  }
  const send = async () => {
    if (!url || !made) return
    if (!canNative) { await copy(); return }
    try {
      // Called straight from the tap: phones only open their share sheet for a tap.
      await navigator.share({ title: made.title, text: made.title, url })
      track('share_send', { kind: item.kind, how: 'native' })
      onClose()
    } catch (e) {
      if ((e as Error).name !== 'AbortError') await copy()
    }
  }
  const saveImage = async () => {
    if (item.kind === 'place') return
    try {
      const blob = await renderShareCard(item.dish, item.place?.name ?? item.restaurant, item.goal ?? 'Eat balanced')
      const how = await shareCard(blob, made ? `${made.title} ${url}` : item.dish.name)
      if (how === 'downloaded') toast('Image saved')
      track('share_download', { kind: item.kind })
    } catch {
      toast('Could not create the image')
    }
  }

  return (
    <Sheet label={heading} onClose={onClose} className="so-sheet">
      <div className="so-sheet__head">
        <h2 className="h2">{heading}</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={20} /></button>
      </div>

      <div className="so-preview" aria-busy={!made && !error}>
        {image ? <img className="so-preview__img" src={image} alt={`Preview: ${title}`} /> : <div className="so-preview__img skeleton" />}
        <div className="so-preview__text">
          <b>{title}</b>
          {made ? <span className="small">{made.summary}</span> : <span className="skeleton" style={{ height: 12, width: '62%' }} />}
        </div>
      </div>

      {error && <p className="banner" role="alert"><Icon name="info" size={18} />{error}</p>}

      <div className="so-sheet__actions">
        {error
          ? <button className="btn btn-primary" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
          : (
            <button className="btn btn-primary" disabled={!made} onClick={() => void send()}>
              <Icon name={canNative ? 'share' : 'copy'} size={20} /> {made ? (canNative ? 'Share link' : 'Copy link') : 'Making the link…'}
            </button>
          )}
        {made && (
          <div className="so-sheet__quiet">
            {canNative && <button className="link-btn" onClick={() => void copy()}><Icon name="copy" size={16} /> Copy link</button>}
            {item.kind !== 'place' && <button className="link-btn" onClick={() => void saveImage()}><Icon name="download" size={16} /> Save image</button>}
          </div>
        )}
      </div>
    </Sheet>
  )
}
