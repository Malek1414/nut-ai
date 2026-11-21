// New post: a question or tip, or a "best order" drafted from a scan (dish, restaurant, kcal range,
// protein, price, optional photo of the plate, short text).
import { useMemo, useRef, useState } from 'react'
import type { DishEstimate, MenuResult, Place } from '../../../snapmenu-api/src/types'
import { Icon } from '../components/ui'
import { track } from '../lib/api'
import { COMMUNITIES, CommunityError, createPost, nickname, type PostView } from '../lib/community'
import { kcalRange, n0 } from '../lib/format'
import { compressImage } from '../lib/image'
import { PROVIDERS, type Provider } from '../lib/delivery'
import { NicknameSheet } from './parts'

export interface Draft {
  kind: 'order' | 'text'
  community: string | null
  result?: MenuResult | null
  place?: Place | null
}

const KIEZ_CENTRES: Array<[string, number, number]> = [
  ['Kreuzberg', 52.4977, 13.4108], ['Mitte', 52.5235, 13.4005], ['Neukölln', 52.4811, 13.435], ['PrenzlauerBerg', 52.539, 13.424], ['Friedrichshain', 52.5125, 13.454],
]
function kiezOf(p: Place | null | undefined): string | null {
  if (!p) return null
  let best: string | null = null
  let d = Infinity
  for (const [id, lat, lng] of KIEZ_CENTRES) {
    const x = (lat - p.lat) ** 2 + ((lng - p.lng) * 0.61) ** 2
    if (x < d) { d = x; best = id }
  }
  return d < 0.00055 ? best : null
}
const goalCommunity = (goal: string | undefined) => (goal === 'build_muscle' ? 'HighProtein' : goal === 'plant_based' ? 'Vegan' : 'LoseFat')

function autoTitle(d: DishEstimate, place: Place | null | undefined, restaurant: string | null): string {
  const where = place?.name ?? restaurant
  return `${d.name}${where ? ` at ${where}` : ''}: ${n0(d.protein.mid)} g protein for ${kcalRange(d.kcal)} kcal`.slice(0, 140)
}

export function Compose({ draft, onCancel, onPosted, toast }: { draft: Draft; onCancel: () => void; onPosted: (p: PostView) => void; toast: (t: string) => void }) {
  const result = draft.result ?? null
  const isOrder = draft.kind === 'order' && result !== null
  const ordered = useMemo(() => {
    if (!result) return []
    const top = result.top.map((id) => result.dishes.find((d) => d.id === id)).filter((d): d is DishEstimate => Boolean(d))
    const rest = [...result.dishes].filter((d) => !result.top.includes(d.id) && d.course !== 'drink').sort((a, b) => b.score - a.score)
    return [...top, ...rest]
  }, [result])
  const [dishId, setDishId] = useState<string | null>(ordered[0]?.id ?? null)
  const dish = ordered.find((d) => d.id === dishId) ?? null
  const [title, setTitle] = useState(() => (isOrder && dish ? autoTitle(dish, draft.place, result!.restaurant) : ''))
  const [titleEdited, setTitleEdited] = useState(false)
  const [body, setBody] = useState('')
  const [community, setCommunity] = useState<string>(() => draft.community ?? (isOrder ? goalCommunity(result!.profile.goal) : kiezOf(draft.place) ?? 'Mitte'))
  const [photo, setPhoto] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [askNick, setAskNick] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [showAll, setShowAll] = useState(false)
  const [via, setVia] = useState<Provider | null>(null)

  const kiez = kiezOf(draft.place)
  const suggested = isOrder ? [...(via ? ['Delivery'] : []), goalCommunity(result!.profile.goal), ...(kiez ? [kiez] : [])] : []

  const pickDish = (d: DishEstimate) => {
    setDishId(d.id)
    if (!titleEdited) setTitle(autoTitle(d, draft.place, result!.restaurant))
  }

  const onPhoto = async (f: File | undefined) => {
    if (!f) return
    try {
      const img = await compressImage(f, { maxEdge: 960, quality: 0.78 })
      if (img.dataUrl.length > 440_000) { toast('That photo is too large. Try another one.'); return }
      setPhoto(img.dataUrl)
    } catch {
      toast('Could not open that photo.')
    }
  }

  const canPost = title.trim().length >= 6 && (!isOrder || dish !== null) && !sending

  const submit = async () => {
    if (!canPost) return
    if (!nickname.get()) { setAskNick(true); return }
    setSending(true)
    setError(null)
    try {
      const p = await createPost({
        kind: isOrder ? 'order' : 'text',
        community,
        title: title.trim(),
        body: body.trim(),
        goal: result?.profile.goal ?? null,
        place: draft.place ? { id: draft.place.id, name: draft.place.name, lat: draft.place.lat, lng: draft.place.lng } : null,
        dish: isOrder && dish ? { name: dish.name, kcalLow: dish.kcal.low, kcalHigh: dish.kcal.high, protein: dish.protein.mid, price: dish.price } : null,
        photo,
        via: isOrder ? via : null,
      })
      track('post_ui', { kind: p.kind, community })
      onPosted(p)
    } catch (e) {
      setError(e instanceof CommunityError ? e.message : 'Could not post. Try again.')
    } finally {
      setSending(false)
    }
  }

  return (
    <main className="screen with-cta compose">
      <div className="topbar">
        <button className="icon-btn" onClick={onCancel} aria-label="Cancel"><Icon name="close" size={20} /></button>
        <b className="compose__heading">{isOrder ? 'Share your best order' : 'New post'}</b>
        <span style={{ width: 44 }} />
      </div>

      {isOrder && (
        <section className="compose__block">
          <p className="eyebrow">Dish</p>
          <div className="dish-pick">
            {(showAll ? ordered : ordered.slice(0, 3)).map((d) => (
              <button key={d.id} type="button" className="dish-pick__opt" role="radio" aria-checked={d.id === dishId} onClick={() => pickDish(d)}>
                <span className="dish-pick__text">
                  <b>{d.name}</b>
                  <span className="small">{kcalRange(d.kcal)} kcal · {n0(d.protein.mid)} g protein{d.price ? ` · ${d.price}` : ''}</span>
                </span>
                <span className="o-check"><Icon name="check" size={14} strokeWidth={2.5} /></span>
              </button>
            ))}
          </div>
          {ordered.length > 3 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowAll((s) => !s)}>{showAll ? 'Show fewer' : `Pick another dish (${ordered.length - 3} more)`}</button>}
          <p className="small"><Icon name="pin" size={13} /> {draft.place ? draft.place.name : result!.restaurant ?? 'Restaurant not set'}{!draft.place && ' · attach the scan to a restaurant to put this post on the map'}</p>
        </section>
      )}

      <section className="compose__block">
        <label className="eyebrow" htmlFor="post-title">{isOrder ? 'Headline' : 'Question or tip'}</label>
        <textarea
          id="post-title"
          className="compose__title"
          value={title}
          onChange={(e) => { setTitle(e.target.value.replace(/\n/g, ' ')); setTitleEdited(true) }}
          placeholder={isOrder ? 'What should people order here?' : 'Best high-protein lunch in Kreuzberg under 12 EUR?'}
          maxLength={140}
          rows={3}
        />
        <div className="compose__count small">{title.length}/140</div>
        <label className="eyebrow" htmlFor="post-body" style={{ marginTop: 12 }}>Details <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 600 }}>(optional)</span></label>
        <textarea id="post-body" value={body} onChange={(e) => setBody(e.target.value)} placeholder={isOrder ? 'How to order it, what to skip, portion size…' : 'Add some context'} maxLength={2000} />
      </section>

      {isOrder && (
        <section className="compose__block">
          <p className="eyebrow">Photo of the plate <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 600 }}>(optional)</span></p>
          {photo ? (
            <div className="compose__photo">
              <img src={photo} alt="Your plate" />
              <button type="button" className="icon-btn" onClick={() => setPhoto(null)} aria-label="Remove photo"><Icon name="close" size={18} /></button>
            </div>
          ) : (
            <button type="button" className="compose__add-photo" onClick={() => fileRef.current?.click()}>
              <Icon name="camera" size={22} /> <span><b>Add a photo</b><span className="small">Food only, please. No faces.</span></span>
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => { void onPhoto(e.target.files?.[0]); e.target.value = '' }} />
        </section>
      )}

      {isOrder && (
        <section className="compose__block">
          <p className="eyebrow">Delivered via <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 600 }}>(optional)</span></p>
          <div className="c-pick" role="radiogroup" aria-label="Delivered via">
            <button type="button" className="q-chip" role="radio" aria-checked={via === null} aria-pressed={via === null} onClick={() => setVia(null)}>Ate there</button>
            {PROVIDERS.map((p) => (
              <button key={p.id} type="button" className="q-chip c-chip" role="radio" aria-checked={via === p.id} aria-pressed={via === p.id}
                onClick={() => { setVia(p.id); if (community !== 'Delivery' && !draft.community) setCommunity('Delivery') }}>
                <i className="dl-dot" style={{ background: p.color }} aria-hidden="true" /> {p.label}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="compose__block">
        <p className="eyebrow">Community</p>
        <div className="c-pick">
          {[...COMMUNITIES].sort((a, b) => Number(suggested.includes(b.id)) - Number(suggested.includes(a.id))).map((c) => (
            <button key={c.id} type="button" className="q-chip c-chip" aria-pressed={community === c.id} onClick={() => setCommunity(c.id)}>
              <span className="c-chip__ic" style={{ background: c.tint, color: c.ink }}><Icon name={c.icon} size={12} strokeWidth={2.2} /></span>
              c/{c.id}
            </button>
          ))}
        </div>
      </section>

      <p className="small" style={{ marginTop: 12 }}>Be kind and specific. No links, emails, phone numbers or other personal data. Posts with 3 reports are hidden.</p>
      {error && <p className="banner" role="alert" style={{ marginTop: 12, background: 'var(--alert-tint)', color: 'var(--alert)' }}><Icon name="alert" /> {error}</p>}

      <div className="cta-bar">
        <button className="btn btn-primary" disabled={!canPost} onClick={() => void submit()}>
          {sending ? 'Posting…' : <><Icon name="send" size={20} /> Post to c/{community}</>}
        </button>
      </div>

      {askNick && <NicknameSheet onClose={() => setAskNick(false)} onDone={() => { setAskNick(false); void submit() }} />}
    </main>
  )
}
