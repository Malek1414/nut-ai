import { useState } from 'react'
import type { Profile } from '../../../snapmenu-api/src/types'
import type { DishSnap } from '../../../snapmenu-api/src/me/types'
import { Icon } from '../components/ui'
import { track } from '../lib/api'
import { n0 } from '../lib/format'
import { DishPicker } from './parts'
import { me, useDay } from './store'

/** "What did you eat?": tap a dish you scanned or saved, or type it. One tap logs it for today. */
export function QuickLog({ profile, onBack, toast }: { profile: Profile; onBack: () => void; toast: (t: string) => void }) {
  const day = useDay(profile.goal)
  /** What was added in this visit: dish key to log entry, so a second tap takes it back. */
  const [added, setAdded] = useState<Record<string, string>>({})

  const pick = (dish: DishSnap) => {
    const had = added[dish.key]
    if (had) {
      me.unlog(had)
      setAdded(({ [dish.key]: _gone, ...rest }) => rest)
      toast('Removed')
      return
    }
    const entry = me.log(dish)
    setAdded((a) => ({ ...a, [dish.key]: entry.id }))
    track('me_log', { from: dish.from })
    toast('Added to today')
  }

  const left = day.left.kcal
  return (
    <main className="screen with-cta me-screen">
      <div className="topbar">
        <button className="icon-btn" onClick={onBack} aria-label="Back"><Icon name="back" /></button>
        <span className="me-left num" aria-live="polite">{n0(Math.abs(left))} kcal {left < 0 ? 'over' : 'left'}</span>
      </div>
      <h1 className="h1 q-head">What did you eat?</h1>
      <DishPicker profile={profile} onPick={pick} picked={new Set(Object.keys(added))} />
      <div className="cta-bar">
        <button className="btn btn-primary" onClick={onBack}>Done</button>
      </div>
    </main>
  )
}
