// The small pieces of "Me" that live on other screens: the actions under a dish, and the one-line
// invitation after a scan to tell the app your taste.
import type { DishEstimate, Profile, Range } from '../../../snapmenu-api/src/types'
import { snapOfDish } from '../../../snapmenu-api/src/me/snap'
import { hasTaste } from '../../../snapmenu-api/src/me/taste'
import { Icon } from '../components/ui'
import { track } from '../lib/api'
import { MeIcon, Safe } from './parts'
import { me, useDay, useMe } from './store'
import './me.css'

/**
 * Under a dish: "I ate this", save it, add it to a meal. `numbers` are the dish's
 * numbers after the person changed it on this screen (smaller, no fries); null
 * when they did not. If it fails to draw, the dish screen stays as it was.
 */
export function DishActions(props: Parameters<typeof DishActionsInner>[0]) {
  return <Safe><DishActionsInner {...props} /></Safe>
}

function DishActionsInner({ dish, numbers, place, goal, scanId, toast }: {
  /** The dish as the engine returned it. */
  dish: DishEstimate
  numbers: { kcal: Range; protein: Range; carbs: Range; fat: Range } | null
  place: string | null
  goal: Profile['goal']
  /** The scan this dish is from. */
  scanId: string
  toast: (t: string) => void
}) {
  const s = useMe()
  const day = useDay(goal)
  const snap = snapOfDish(dish, { place, goal, from: 'scan', numbers: numbers ?? undefined })
  const saved = s.favorites.some((f) => f.key === snap.key)
  /** Already logged today, from this menu or by its name: the button says so, and a second tap takes it back. */
  const logged = day.entries.find((e) => e.dish.key === snap.key || (e.scan === scanId && e.dish.name === snap.name))?.id ?? null
  const eat = () => {
    if (logged) { me.unlog(logged); toast('Removed'); return }
    me.log(snap, 1, scanId)
    track('me_log', { from: 'dish' })
    toast('Added to today')
  }
  return (
    <div className="dish-actions">
      <button className={`btn ${logged ? 'btn-secondary' : 'btn-primary'}`} onClick={eat} aria-pressed={Boolean(logged)}>
        <Icon name="check" size={20} strokeWidth={2.4} /> {logged ? 'Added to today' : 'I ate this'}
      </button>
      <button className="icon-btn dish-actions__ic" aria-pressed={saved} aria-label={saved ? 'Saved. Remove from favorites' : 'Save to favorites'} onClick={() => { const on = me.toggleFavorite(snap); track('me_favorite', { on }); toast(on ? 'Saved' : 'Removed') }}>
        <MeIcon name="heart" size={21} filled={saved} />
      </button>
      <button className="icon-btn dish-actions__ic" aria-label="Add to a meal" onClick={() => toast(me.addToDraft(snap) ? `In your meal · ${me.get().draft.length}` : 'Your meal is full')}>
        <MeIcon name="layers" size={21} />
      </button>
    </div>
  )
}

/** After a result, once: one row that opens the three taste questions. Gone as soon as they were answered or skipped. */
export function TastePrompt({ onOpen }: { onOpen: () => void }) {
  const s = useMe()
  if (s.tasteAsked || hasTaste(s.taste)) return null
  return (
    <button className="post-prompt" onClick={onOpen}>
      <span className="me-ic" style={{ background: 'var(--basil-tint)', color: 'var(--basil)' }}><MeIcon name="sliders" size={20} /></span>
      <b>Tune picks to your taste</b>
      <Icon name="chevron" size={18} />
    </button>
  )
}
