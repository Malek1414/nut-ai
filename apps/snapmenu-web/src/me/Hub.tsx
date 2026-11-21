// The top of the Me tab: today's numbers with one action, what was eaten, "Today for you", and the
// rows that open targets, taste, favorites and the meal builder.
import { useEffect, useMemo, useState } from 'react'
import type { Place, PlacesResponse, Profile } from '../../../snapmenu-api/src/types'
import { portionOf } from '../../../snapmenu-api/src/me/meal'
import { suggest, type Candidate, type Suggestion } from '../../../snapmenu-api/src/me/rank'
import { snapOfLite } from '../../../snapmenu-api/src/me/snap'
import { cuisineLabel, foodLabel, hasTaste } from '../../../snapmenu-api/src/me/taste'
import type { LogEntry, Macro } from '../../../snapmenu-api/src/me/types'
import { Fold, Icon, Sheet } from '../components/ui'
import { kcalRange, n0 } from '../lib/format'
import { fetchPlaces } from '../lib/places'
import { distance, formatDistance, usePosition } from '../lib/position'
import { DishSheet, MeIcon, Totals } from './parts'
import { me, useDay, useMe, type Day } from './store'
import type { View } from './MeSpace'

const PORTIONS: Array<{ v: number; label: string }> = [{ v: 0.5, label: '½' }, { v: 1, label: '1' }, { v: 1.5, label: '1½' }, { v: 2, label: '2' }]
const portionLabel = (v: number) => PORTIONS.find((p) => p.v === v)?.label ?? String(v)

const pct = (v: number, of: number) => `${Math.max(0, Math.min(100, of > 0 ? (v / of) * 100 : 0))}%`

/** What is left today, as one number, a track and three small bars. Never red: over is just over. */
function DayCard({ day, onLog }: { day: Day; onLog: () => void }) {
  const { targets, eaten, left } = day
  const over = left.kcal < 0
  const scale = Math.max(targets.kcal, eaten.kcal.high)
  const macro = (m: Macro, cls: string, label: string) => {
    const l = left[m]
    return (
      <div className={`macro ${cls}`}>
        <div className="m-label"><span>{label}</span></div>
        <div className="m-val">{n0(Math.abs(l))}<small>{l < 0 ? 'g over' : 'g left'}</small></div>
        <div className="m-bar"><i style={{ width: pct(eaten[m].mid, targets[m]) }} /></div>
      </div>
    )
  }
  return (
    <section className="card day-card" aria-label="Today">
      <div className="day-card__head">
        <span className="eyebrow">Today</span>
        {day.entries.length > 0 && <span className="conf" title="Added up from estimates">Estimate</span>}
      </div>
      <div className="day-card__big">
        <b className="num">{n0(Math.abs(left.kcal))}</b>
        <span>{over ? 'kcal over' : 'kcal left'}</span>
        <span className="day-card__of">of {n0(targets.kcal)}</span>
      </div>
      <div className="day-track" role="img" aria-label={day.entries.length > 0 ? `Eaten ${n0(eaten.kcal.low)} to ${n0(eaten.kcal.high)} of ${n0(targets.kcal)} kcal` : `Nothing logged yet. Target ${n0(targets.kcal)} kcal`}>
        <i className="day-track__sure" style={{ width: pct(eaten.kcal.low, scale) }} />
        <i className="day-track__band" style={{ left: pct(eaten.kcal.low, scale), width: pct(eaten.kcal.high - eaten.kcal.low, scale) }} />
        {scale > targets.kcal && <i className="day-track__goal" style={{ left: pct(targets.kcal, scale) }} />}
      </div>
      <div className="macros">
        {macro('protein', 'p', 'Protein')}
        {macro('carbs', 'c', 'Carbs')}
        {macro('fat', 'f', 'Fat')}
      </div>
      <button className="btn btn-primary" onClick={onLog}>
        <Icon name="plus" size={22} strokeWidth={2.2} /> What did you eat?
      </button>
    </section>
  )
}

function EntrySheet({ entry, onClose, toast }: { entry: LogEntry; onClose: () => void; toast: (t: string) => void }) {
  const shown = portionOf(entry.dish, entry.portion)
  return (
    <Sheet label={entry.dish.name} onClose={onClose} className="me-sheet">
      <h2 className="h2">{entry.dish.name}</h2>
      {entry.dish.place && <p className="small me-sheet__sub">{entry.dish.place}</p>}
      <Totals n={shown} />
      <div className="me-portion" role="radiogroup" aria-label="How much of it">
        {PORTIONS.map((p) => (
          <button key={p.v} type="button" className="q-chip" role="radio" aria-checked={entry.portion === p.v} aria-pressed={entry.portion === p.v} onClick={() => me.setPortion(entry.id, p.v)}>{p.label}</button>
        ))}
      </div>
      <div className="me-sheet__actions">
        <button className="btn btn-primary" onClick={onClose}>Done</button>
        <button className="btn btn-secondary" onClick={() => { me.unlog(entry.id); toast('Removed'); onClose() }}><Icon name="trash" size={18} /> Remove</button>
      </div>
    </Sheet>
  )
}

const SOURCE: Record<Candidate['from'], string> = { scan: 'From your scan', saved: 'Saved', nearby: 'Nearby' }

/** A few dishes for today: from menus the person scanned, dishes they saved, and restaurants nearby. */
function TodayPicks({ profile, day, onPlace, onScan, toast }: { profile: Profile; day: Day; onPlace: (p: Place) => void; onScan: () => void; toast: (t: string) => void }) {
  const s = useMe()
  const pos = usePosition()
  const [near, setNear] = useState<PlacesResponse | null | undefined>(undefined)
  const [open, setOpen] = useState<Suggestion | null>(null)
  const { lat, lng } = pos.position
  const goalKey = `${profile.goal}|${profile.plantStyle ?? ''}`

  useEffect(() => {
    let live = true
    // Nearby dishes are a bonus: the card never waits long for them.
    const giveUp = window.setTimeout(() => live && setNear((n) => n ?? null), 2500)
    fetchPlaces(lat, lng, profile).then((r) => live && setNear(r)).catch(() => live && setNear(null))
    return () => { live = false; window.clearTimeout(giveUp) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng, goalKey])

  const places = useMemo(() => new Map((near?.places ?? []).map((p) => [p.id, p])), [near])
  const picks = useMemo(() => {
    const cands: Candidate[] = [
      ...s.scanned.map((x): Candidate => ({ dish: x.dish, from: 'scan', distance: null, cuisine: x.cuisine, example: false, placeId: null })),
      ...s.favorites.filter((f) => f.from !== 'meal').map((f): Candidate => ({ dish: f, from: 'saved', distance: null, cuisine: null, example: false, placeId: null })),
    ]
    for (const [placeId, sc] of Object.entries(near?.scored ?? {})) {
      const place = places.get(placeId)
      if (!place) continue
      cands.push({ dish: snapOfLite(sc.best, place.name), from: 'nearby', distance: pos.status === 'granted' ? distance(pos.position, place) : null, cuisine: place.cuisine, example: sc.example, placeId })
    }
    return suggest(cands, { profile, taste: s.taste, day: day.ctx })
  }, [s.scanned, s.favorites, s.taste, near, places, pos.status, pos.position, profile, day.ctx])

  const ready = near !== undefined || s.scanned.length + s.favorites.length > 0
  const place = open?.placeId ? places.get(open.placeId) : undefined
  return (
    <section className="card-flat today" aria-label="Today for you">
      <div className="today__head">
        <span className="today__ic"><Icon name="spark" size={16} strokeWidth={2.1} /></span>
        <h2 className="h3">Today for you</h2>
      </div>
      {!ready && <div className="me-skel" aria-busy="true"><span className="skeleton" /><span className="skeleton" /></div>}
      {ready && picks.map((p) => (
        <button key={`${p.from}-${p.dish.key}`} type="button" className="today__row" onClick={() => setOpen(p)}>
          <span className="today__text">
            <b>{p.dish.name}</b>
            <span className="small today__where">
              <span>{p.dish.place ?? SOURCE[p.from]}</span>
              {p.distance !== null && <span>· {formatDistance(p.distance)}</span>}
              {p.example && <span className="example-badge" title="Example data, not a real scan">Example</span>}
            </span>
            <span className="today__why">{p.line}</span>
          </span>
          <span className="dish-row__nums">
            <span className="dr-k">{kcalRange(p.dish.kcal)}</span>
            <span className="small">{n0(p.dish.protein.mid)} g protein</span>
          </span>
        </button>
      ))}
      {ready && picks.length === 0 && (
        <button type="button" className="today__row today__row--empty" onClick={onScan}>
          <span className="today__text"><b>Scan a menu</b><span className="small">Your picks for today show up here.</span></span>
          <Icon name="camera" size={20} />
        </button>
      )}
      {open && (
        <DishSheet
          dish={open.dish} toast={toast} onClose={() => setOpen(null)}
          onMap={place ? () => { setOpen(null); onPlace(place) } : undefined}
        />
      )}
    </section>
  )
}

/** The Me tab's own part: today, picks, and the way into targets, taste, favorites and meals. */
export function Hub({ profile, open, toast, onPlace, onScan }: { profile: Profile; open: (v: View) => void; toast: (t: string) => void; onPlace: (p: Place) => void; onScan: () => void }) {
  const s = useMe()
  const day = useDay(profile.goal)
  const [entryId, setEntryId] = useState<string | null>(null)
  const entry = day.entries.find((e) => e.id === entryId) ?? null
  const tasteLine = hasTaste(s.taste)
    ? [...s.taste.cuisines.map(cuisineLabel), ...s.taste.likes.map(foodLabel), ...s.taste.dislikes.map((d) => `no ${foodLabel(d).toLowerCase()}`)].slice(0, 3).join(', ')
    : 'Add'
  return (
    <div className="me-hub">
      <DayCard day={day} onLog={() => open('log')} />

      {day.entries.length > 0 && (
        <Fold title="Eaten today" count={day.entries.length} defaultOpen>
          {[...day.entries].reverse().map((e) => {
            const d = portionOf(e.dish, e.portion)
            return (
              <button key={e.id} type="button" className="dish-row" onClick={() => setEntryId(e.id)}>
                <span className="dish-row__text">
                  <span className="row" style={{ gap: 6 }}><b>{e.dish.name}</b>{e.portion !== 1 && <span className="badge top">{portionLabel(e.portion)}</span>}</span>
                  {e.dish.place && <span className="small">{e.dish.place}</span>}
                </span>
                <span className="dish-row__nums">
                  <span className="dr-k">{kcalRange(d.kcal)}</span>
                  <span className="small">{n0(d.protein.mid)} g protein</span>
                </span>
                <Icon name="chevron" size={18} />
              </button>
            )
          })}
        </Fold>
      )}

      <TodayPicks profile={profile} day={day} onPlace={onPlace} onScan={onScan} toast={toast} />

      <div className="card-flat list-card">
        <button className="set-row" onClick={() => open('targets')}>
          <span className="set-row__ic" style={{ background: 'var(--basil-tint)', color: 'var(--basil)' }}><MeIcon name="target" size={18} /></span>
          <span className="set-row__label">Targets</span>
          <span className="set-row__value">{n0(day.targets.kcal)} kcal</span>
          <Icon name="chevron" size={18} />
        </button>
        <button className="set-row" onClick={() => open('taste')}>
          <span className="set-row__ic" style={{ background: 'var(--saffron-tint)', color: '#7a5208' }}><MeIcon name="sliders" size={18} /></span>
          <span className="set-row__label">Taste</span>
          <span className="set-row__value">{tasteLine}</span>
          <Icon name="chevron" size={18} />
        </button>
        <button className="set-row" onClick={() => open('favorites')}>
          <span className="set-row__ic" style={{ background: 'var(--fat-tint)', color: 'var(--fat)' }}><MeIcon name="heart" size={18} /></span>
          <span className="set-row__label">Favorites</span>
          <span className="set-row__value">{s.favorites.length + s.meals.length || 'None yet'}</span>
          <Icon name="chevron" size={18} />
        </button>
        <button className="set-row" onClick={() => open('meal')}>
          <span className="set-row__ic" style={{ background: 'var(--protein-tint)', color: 'var(--protein)' }}><MeIcon name="layers" size={18} /></span>
          <span className="set-row__label">Meal builder</span>
          <span className="set-row__value">{s.draft.length > 0 ? `${s.draft.length} ${s.draft.length === 1 ? 'dish' : 'dishes'}` : 'Combine dishes'}</span>
          <Icon name="chevron" size={18} />
        </button>
      </div>

      {entry && <EntrySheet entry={entry} toast={toast} onClose={() => setEntryId(null)} />}
    </div>
  )
}
