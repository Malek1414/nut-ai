// Save a meal from a link: paste (or share) an Instagram, TikTok, YouTube, Facebook or web link,
// get the meal with the engine's numbers, save it. When a source will not be read, the person
// types what the meal is and gets the same result.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { extractUrl } from '../../../snapmenu-api/src/social/links'
import type { DishEstimate, Profile } from '../../../snapmenu-api/src/types'
import { Icon, Macros, RangeBar } from '../components/ui'
import { track } from '../lib/api'
import { kcalRange } from '../lib/format'
import { importLink, savedImports, SocialError, type ImportResult, type ImportSource, type SavedImport } from './client'

type Phase =
  | { at: 'idle' }
  | { at: 'loading' }
  | { at: 'result'; result: ImportResult }
  | { at: 'ask'; result: ImportResult | null; message: string }
  | { at: 'failed'; message: string; retry: boolean }
  | { at: 'saved'; item: SavedImport }

const author = (s: ImportSource) => (s.author ? (s.platform === 'tiktok' || s.platform === 'instagram' ? `@${s.author.replace(/^@/, '')}` : s.author) : null)

function SourceLine({ source }: { source: ImportSource }) {
  return (
    <a className="so-source" href={source.url} target="_blank" rel="noopener noreferrer">
      <span>{[source.label, author(source)].filter(Boolean).join(' · ')}</span>
      <Icon name="external" size={14} />
    </a>
  )
}

/** The meal as the result and the saved view show it: where it is from, its name, and the engine's numbers. */
function Meal({ source, restaurant, dish, fromHint }: { source: ImportSource; restaurant: ImportResult['restaurant']; dish: DishEstimate; fromHint?: boolean }) {
  const [broken, setBroken] = useState(false)
  const where = restaurant ? [restaurant.name, restaurant.city].filter(Boolean).join(', ') : null
  return (
    <>
      {source.image && !broken && (
        <img className="so-thumb" src={source.image} alt="" referrerPolicy="no-referrer" loading="lazy" onError={() => setBroken(true)} />
      )}
      <div className="so-shared__head">
        <SourceLine source={source} />
        <h1 className="h1">{dish.name}</h1>
        {dish.translated && dish.translated.toLowerCase() !== dish.name.toLowerCase() && <p className="lead">{dish.translated}</p>}
        {where && <p className="so-where"><Icon name="pin" size={16} />{where}</p>}
      </div>
      <section className="card" style={{ padding: 20, display: 'grid', gap: 16 }}>
        <RangeBar range={dish.kcal} tier={dish.bandTier} />
        <Macros d={dish} />
        {dish.why && <p className="best__why">{dish.why}</p>}
      </section>
      {dish.allergens.length > 0 && (
        <section className="card-flat allergy-card">
          <div className="allergen-row" aria-label="Likely allergens">
            <span className="small">May contain</span>
            {dish.allergens.map((a) => {
              const hit = dish.userAllergenHits.some((h) => h.allergen === a.allergen)
              return <span key={a.allergen} className={`a-chip ${hit ? 'hit' : ''}`} title={a.reason}>{hit && <Icon name="alert" size={13} />}{a.label.split(' (')[0]}</span>
            })}
          </div>
          <p className="small">Hints, not a guarantee. Confirm with the restaurant.</p>
        </section>
      )}
      <p className="small so-note">{fromHint ? 'An estimate from what you typed. Portions vary.' : 'An estimate from the post, not from the restaurant. Portions vary.'}</p>
    </>
  )
}

export function ImportScreen({ initialUrl, profile, onBack, toast }: { initialUrl: string | null; profile: Profile | null; onBack: () => void; toast: (t: string) => void }) {
  const [link, setLink] = useState(initialUrl ?? '')
  const [phase, setPhase] = useState<Phase>({ at: 'idle' })
  const [dish, setDish] = useState('')
  const [place, setPlace] = useState('')
  const abort = useRef<AbortController | null>(null)
  const started = useRef<string | null>(null)
  const saved = useSyncExternalStore(savedImports.subscribe, savedImports.list, savedImports.list)
  const canPaste = typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function'

  const run = async (raw: string, hint: { dish?: string; restaurant?: string } | null) => {
    const url = extractUrl(raw)
    if (!url) { setPhase({ at: 'failed', message: 'That does not look like a link.', retry: false }); return }
    abort.current?.abort()
    const ctrl = new AbortController()
    abort.current = ctrl
    setPhase({ at: 'loading' })
    track('import_start', { hint: Boolean(hint) })
    try {
      const r = await importLink(url, profile, hint, ctrl.signal)
      if (r.status === 'ok' && r.dish) setPhase({ at: 'result', result: r })
      else {
        // The place the link named is kept: only the dish is asked for.
        if (r.restaurant && !place) setPlace(r.restaurant.name)
        setPhase({ at: 'ask', result: r, message: r.message ?? '' })
      }
    } catch (e) {
      if (e instanceof SocialError && e.code === 'aborted') return
      const err = e instanceof SocialError ? e : null
      setPhase({ at: 'failed', message: err?.message ?? 'That did not work. Try again in a moment.', retry: err?.code !== 'bad_link' && err?.code !== 'rate_limited' })
    }
  }

  // A link handed over by the phone's share sheet is read straight away.
  useEffect(() => {
    if (initialUrl && started.current !== initialUrl) {
      started.current = initialUrl
      setLink(initialUrl)
      void run(initialUrl, null)
    }
    // Leaving stops the read. The marker is cleared too, so a remount (React runs effects twice in dev) reads again instead of waiting on a cancelled request.
    return () => { abort.current?.abort(); started.current = null }
    // Only a new link from outside starts a read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUrl])

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      const url = extractUrl(text)
      if (url) setLink(url)
      else toast('No link on the clipboard')
    } catch {
      toast('Paste the link into the field')
    }
  }
  const save = (r: ImportResult) => {
    const item = savedImports.add(r)
    if (!item) return
    track('import_save', { platform: r.source.platform })
    toast('Saved to favorites')
    setPhase({ at: 'saved', item })
  }
  const reset = () => { abort.current?.abort(); setPhase({ at: 'idle' }); setLink(''); setDish(''); setPlace('') }
  const back = () => (phase.at === 'idle' ? onBack() : reset())

  const top = (
    <div className="topbar">
      <button className="icon-btn" onClick={back} aria-label="Back"><Icon name="back" /></button>
    </div>
  )

  if (phase.at === 'loading') {
    return (
      <main className="screen" aria-busy="true">
        {top}
        <div className="state">
          <span className="s-ic"><span className="attach__spin" style={{ width: 28, height: 28 }} /></span>
          <h1 className="h2">Reading the link</h1>
          <p className="body">This takes a few seconds.</p>
        </div>
      </main>
    )
  }

  if (phase.at === 'result') {
    const r = phase.result
    return (
      <main className="screen with-cta so-import">
        {top}
        <Meal source={r.source} restaurant={r.restaurant} dish={r.dish!} fromHint={r.fromHint} />
        <div className="cta-bar so-cta-2">
          <button className="btn btn-primary" onClick={() => save(r)}><Icon name="bookmark" size={20} /> Save to favorites</button>
          <button className="link-btn" onClick={() => { setDish(''); setPhase({ at: 'ask', result: r, message: 'Tell us what it really is.' }) }}>Not this dish?</button>
        </div>
      </main>
    )
  }

  if (phase.at === 'saved') {
    const s = phase.item
    return (
      <main className="screen with-cta so-import">
        {top}
        <Meal source={s.source} restaurant={s.restaurant} dish={s.dish} />
        <div className="cta-bar so-cta-2">
          <button className="btn btn-primary" onClick={reset}><Icon name="check" size={20} /> Done</button>
          <button className="link-btn" onClick={() => { savedImports.remove(s.id); toast('Removed'); reset() }}><Icon name="trash" size={16} /> Remove</button>
        </div>
      </main>
    )
  }

  if (phase.at === 'ask') {
    const source = phase.result?.source ?? null
    return (
      <main className="screen with-cta so-import">
        {top}
        <form className="so-form" onSubmit={(e) => { e.preventDefault(); if (dish.trim()) void run(link, { dish: dish.trim(), ...(place.trim() ? { restaurant: place.trim() } : {}) }) }}>
          <header className="so-shared__head">
            {source && <SourceLine source={source} />}
            <h1 className="h1">What is the meal?</h1>
            {phase.message && <p className="body">{phase.message}</p>}
          </header>
          <label className="so-field">
            <span className="small">Meal</span>
            <input className="input" value={dish} onChange={(e) => setDish(e.target.value)} placeholder="Chicken döner" maxLength={120} autoFocus enterKeyHint="next" />
          </label>
          <label className="so-field">
            <span className="small">Place (optional)</span>
            <input className="input" value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Restaurant" maxLength={120} enterKeyHint="go" />
          </label>
          <div className="cta-bar">
            <button type="submit" className="btn btn-primary" disabled={!dish.trim()}>Estimate it</button>
          </div>
        </form>
      </main>
    )
  }

  return (
    <main className="screen with-cta so-import">
      {top}
      {/* noValidate: the field is type=url for the link keyboard, but a pasted sentence or a link without https must get through to our own reading of it. */}
      <form className="so-form" noValidate onSubmit={(e) => { e.preventDefault(); if (link.trim()) void run(link, null) }}>
        <header className="so-shared__head">
          <h1 className="h1">Save a meal from a link</h1>
          <p className="body">Instagram, TikTok, YouTube, Facebook or any page.</p>
        </header>
        <div className="so-link">
          <input
            className="input" type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste a link" aria-label="Link" aria-invalid={phase.at === 'failed' && !phase.retry}
            enterKeyHint="go"
          />
          {canPaste && !link && <button type="button" className="so-link__paste" onClick={() => void paste()}>Paste</button>}
          {link && <button type="button" className="so-link__clear" onClick={() => { setLink(''); setPhase({ at: 'idle' }) }} aria-label="Clear"><Icon name="close" size={16} /></button>}
        </div>
        {phase.at === 'failed' && <p className="banner" role="alert"><Icon name="info" size={18} />{phase.message}</p>}
        <div className="cta-bar">
          <button type="submit" className="btn btn-primary" disabled={!link.trim()}>Find the meal</button>
        </div>
      </form>

      {saved.length > 0 && (
        <section className="so-saved">
          <h2 className="eyebrow">Saved from links</h2>
          <div className="card-flat list-card">
            {saved.map((s) => (
              <button key={s.id} className="dish-row" onClick={() => setPhase({ at: 'saved', item: s })}>
                <span className="dish-row__text">
                  <b>{s.dish.name}</b>
                  <span className="small">{[s.restaurant?.name, s.source.label].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="dish-row__nums"><span className="dr-k">{kcalRange(s.dish.kcal)}</span><span className="small">kcal</span></span>
                <Icon name="chevron" size={18} />
              </button>
            ))}
          </div>
        </section>
      )}
    </main>
  )
}
