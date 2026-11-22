// New post: a question or tip, or a "best order" drafted from a scan (dish, restaurant, kcal range,
// protein, price, optional photo of the plate, short text).
import { useMemo, useRef, useState } from 'react'
import type { DishEstimate, MenuResult, Place } from '../../../snapmenu-api/src/types'
import { say } from '../../../snapmenu-api/src/voice/index'
import { Icon } from '../components/ui'
import { track } from '../lib/api'
import { COMMUNITIES, CommunityError, createPost, nickname, type PostView } from '../lib/community'
import { kcalRange, n0 } from '../lib/format'
import { compressImage } from '../lib/image'
import { PROVIDERS, type Provider } from '../lib/delivery'
import { store } from '../lib/storage'
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

/** The headline the app drafts for the post, in the user's language. Its numbers are the engine's. */
function autoTitle(d: DishEstimate, place: Place | null | undefined, restaurant: string | null): string {
  const where = place?.name ?? restaurant
  const vars = { dish: d.name, protein: d.protein.mid, kcal: kcalRange(d.kcal) }
  return (where ? say(store.language(), 'community.order_title.place', { ...vars, place: where }) : say(store.language(), 'community.order_title', vars)).slice(0, 140)
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
  const [photoBusy, setPhotoBusy] = useState(false)
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
    if (!f || photoBusy) return
    setPhotoBusy(true)
    try {
      const img = await compressImage(f, { maxEdge: 960, quality: 0.78 })
      if (img.dataUrl.length > 440_000) { toast('Photo too large'); return }
      setPhoto(img.dataUrl)
    } catch {
      toast('Could not open that photo')
    } finally { setPhotoBusy(false) }
  }

  const canPost = title.trim().length >= 6 && (!isOrder || dish !== null) && !sending && !photoBusy

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

  const where = draft.place?.name ?? result?.restaurant ?? null

  return (
    <main className="screen with-cta compose">
      <div className="topbar">
        <button className="icon-btn" onClick={onCancel} aria-label="Cancel"><Icon name="close" size={20} /></button>
        <b className="compose__heading">{isOrder ? 'Best order' : 'New post'}</b>
        <span style={{ width: 44 }} />
      </div>

      {isOrder && (
        <section className="compose__block">
          <div className="dish-pick" role="radiogroup" aria-label="Dish">
            {(showAll ? ordered : ordered.slice(0, 3)).map((d) => (
              <button key={d.id} type="button" className="dish-pick__opt" role="radio" aria-checked={d.id === dishId} onClick={() => pickDish(d)}>
                <span className="dish-pick__text">
                  <b>{d.name}</b>
                  <span className="small">{kcalRange(d.kcal)} kcal · {n0(d.protein.mid)} g protein</span>
                </span>
                <span className="o-check"><Icon name="check" size={14} strokeWidth={2.5} /></span>
              </button>
            ))}
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            {where ? <span className="small compose__where"><Icon name="pin" size={14} /> {where}</span> : <span />}
            {ordered.length > 3 && <button type="button" className="link-btn" onClick={() => setShowAll((s) => !s)}>{showAll ? 'Fewer' : `${ordered.length - 3} more`}</button>}
          </div>
        </section>
      )}

      <section className="compose__block compose__text">
        <textarea
          id="post-title"
          className="compose__title"
          value={title}
          onChange={(e) => { setTitle(e.target.value.replace(/\n/g, ' ')); setTitleEdited(true) }}
          placeholder={isOrder ? 'What should people order here?' : 'Ask a question or share a tip'}
          aria-label={isOrder ? 'Headline' : 'Question or tip'}
          maxLength={140}
          rows={3}
        />
        <textarea id="post-body" className="compose__body" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Details (optional)" aria-label="Details (optional)" maxLength={2000} rows={3} />
      </section>

      <section className="compose__block">
        {photoBusy ? <div className="skeleton" role="status" aria-label="Preparing photo" style={{ height: 72 }} /> : photo ? (
          <div className="compose__photo">
            <img src={photo} alt="Attached photo" />
            <button type="button" className="icon-btn" onClick={() => setPhoto(null)} aria-label="Remove photo"><Icon name="close" size={18} /></button>
          </div>
        ) : (
          <button type="button" className="compose__add-photo" onClick={() => fileRef.current?.click()}>
            <Icon name="image" size={20} /> <b>Add photo</b>
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => { void onPhoto(e.target.files?.[0]); e.target.value = '' }} />
      </section>

      {isOrder && (
        <section className="compose__block">
          <p className="eyebrow">How you got it</p>
          <div className="quick" role="radiogroup" aria-label="How you got it">
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
        <div className="quick" role="radiogroup" aria-label="Community">
          {[...COMMUNITIES].sort((a, b) => Number(suggested.includes(b.id)) - Number(suggested.includes(a.id)) || Number(b.id === community) - Number(a.id === community)).map((c) => (
            <button key={c.id} type="button" className="q-chip c-chip" role="radio" aria-checked={community === c.id} aria-pressed={community === c.id} onClick={() => setCommunity(c.id)}>
              <span className="c-chip__ic" style={{ background: c.tint, color: c.ink }}><Icon name={c.icon} size={12} strokeWidth={2.2} /></span>
              {c.label}
            </button>
          ))}
        </div>
      </section>

      {error && <p className="banner" role="alert" style={{ marginTop: 16, background: 'var(--alert-tint)', color: 'var(--alert)' }}><Icon name="alert" /> {error}</p>}

      <div className="cta-bar">
        <button className="btn btn-primary" disabled={!canPost} onClick={() => void submit()}>
          {sending ? 'Posting…' : <><Icon name="send" size={20} /> Post</>}
        </button>
        <p className="small" style={{ textAlign: 'center' }}>Be kind. No personal data.</p>
      </div>

      {askNick && <NicknameSheet onClose={() => setAskNick(false)} onDone={() => { setAskNick(false); void submit() }} />}
    </main>
  )
}
