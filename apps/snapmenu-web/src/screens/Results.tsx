import { useState, type ReactNode } from 'react'
import type { DishEstimate, MenuResult, OrderTip } from '../../../snapmenu-api/src/types'
import { Footer, Icon, Macros, RangeBar, Wordmark } from '../components/ui'
import { GOAL_LABEL, kcalRange } from '../lib/format'

export function SayThis({ tip, onToast }: { tip: OrderTip; onToast: (t: string) => void }) {
  const copy = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(tip.local)
      else {
        // Plain-HTTP fallback (phones on the local Wi-Fi URL have no async clipboard).
        const ta = document.createElement('textarea')
        ta.value = tip.local
        ta.setAttribute('readonly', '')
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        const ok = document.execCommand('copy')
        ta.remove()
        if (!ok) throw new Error('copy')
      }
      onToast('Copied. Show it or read it out.')
    } catch {
      onToast('Copy is blocked here. Long-press the text instead.')
    }
  }
  const speak = () => {
    try {
      const u = new SpeechSynthesisUtterance(tip.local)
      u.rate = 0.92
      window.speechSynthesis.cancel()
      window.speechSynthesis.speak(u)
    } catch {
      onToast('Speech is not available on this phone.')
    }
  }
  return (
    <div className="say">
      <div className="s-label">
        <span>Order it your way</span>
        <span className="s-actions">
          {'speechSynthesis' in window && <button className="s-btn" onClick={speak} aria-label="Read it out"><Icon name="speaker" size={16} /></button>}
          <button className="s-btn" onClick={copy}><Icon name="copy" size={16} /> Copy</button>
        </span>
      </div>
      <div className="s-local" lang="auto">“{tip.local}”</div>
      <div className="s-tr">{tip.translated}</div>
    </div>
  )
}

function TopCard({ d, rank, tip, onOpen, onToast }: { d: DishEstimate; rank: number; tip: OrderTip | undefined; onOpen: () => void; onToast: (t: string) => void }) {
  return (
    <article className="card top-card">
      <button className="dish-title" onClick={onOpen} style={{ textAlign: 'left' }} aria-label={`${d.name}, details`}>
        <span className={`rank r${rank}`}>{rank}</span>
        <span className="names">
          <span className="h3">{d.name}</span>
          {d.translated && d.translated !== d.name && <span className="small">{d.translated}</span>}
        </span>
        {d.price && <span className="price">{d.price}</span>}
      </button>
      <RangeBar range={d.kcal} tier={d.bandTier} />
      <Macros d={d} />
      <div className="why"><Icon name="spark" size={16} /><span>{d.why}</span></div>
      {d.allergens.length > 0 && (
        <div className="allergen-row" aria-label="Likely allergens">
          {d.allergens.map((a) => <span key={a.allergen} className="a-chip">{a.label.split(' (')[0]}</span>)}
        </div>
      )}
      {tip && <SayThis tip={tip} onToast={onToast} />}
      <button className="btn btn-ghost btn-sm" style={{ justifySelf: 'start', paddingLeft: 0 }} onClick={onOpen}>
        Where these numbers come from <Icon name="chevron" size={18} />
      </button>
    </article>
  )
}

export function Results({ result, onOpenDish, onRescan, onHome, onShare, onToast, attachSlot }: {
  result: MenuResult
  /** "Where are you eating?" card, shown above the top dishes. */
  attachSlot?: ReactNode
  onOpenDish: (id: string) => void
  onRescan: () => void
  onHome: () => void
  onShare: (d: DishEstimate) => void
  onToast: (t: string) => void
}) {
  const [showAll, setShowAll] = useState(false)
  const byId = new Map(result.dishes.map((d) => [d.id, d]))
  const top = result.top.map((id) => byId.get(id)).filter((d): d is DishEstimate => Boolean(d))
  const avoid = result.avoid.map((a) => ({ ...a, d: byId.get(a.dishId) })).filter((a) => a.d)
  const p = result.profile
  const goal = p.goal === 'plant_based' ? (p.plantStyle === 'vegetarian' ? 'Vegetarian' : 'Vegan') : GOAL_LABEL[p.goal]
  const ordered = [...result.dishes].sort((a, b) => b.score - a.score)

  return (
    <main className="screen with-cta">
      <div className="topbar">
        <Wordmark onClick={onHome} />
        <button className="btn btn-secondary btn-sm" onClick={onRescan}><Icon name="camera" size={18} /> New scan</button>
      </div>

      <header className="results-head">
        <p className="eyebrow">{[result.cuisine, `${result.menuLanguage} menu`, `${result.dishes.length} dishes`].filter(Boolean).join(' · ')}</p>
        <h1 className="h1">{result.restaurant ?? 'Your menu'}</h1>
        <p className="body">Best for <b style={{ color: 'var(--ink)' }}>{goal.toLowerCase()}</b>{p.allergies.length ? <> · avoiding <b style={{ color: 'var(--ink)' }}>{p.allergies.join(', ').replace(/_/g, ' ')}</b></> : null}</p>
      </header>

      {attachSlot}

      {top.length === 0 ? (
        <div className="card" style={{ padding: 20 }}>
          <h2 className="h3">Nothing here fits your goal and allergies.</h2>
          <p className="body" style={{ marginTop: 8 }}>Every dish we read either likely contains one of your allergens or does not fit your diet. Check the list below, or ask the restaurant what they can change.</p>
        </div>
      ) : (
        top.map((d, i) => (
          <TopCard key={d.id} d={d} rank={i + 1} tip={result.tips.find((t) => t.dishId === d.id)} onOpen={() => onOpenDish(d.id)} onToast={onToast} />
        ))
      )}

      {avoid.length > 0 && (
        <>
          <div className="section-title"><h2 className="h2">Skip these</h2><span className="small">{avoid.length} dishes</span></div>
          {avoid.map(({ d, reasons }) => {
            const allergy = d!.userAllergenHits.length > 0
            return (
              <button key={d!.id} className="card-flat avoid-card" onClick={() => onOpenDish(d!.id)}>
                <span className={`avoid-ic ${allergy ? 'alert' : ''}`}><Icon name={allergy ? 'alert' : 'thumbDown'} size={18} /></span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <b style={{ fontSize: 15 }}>{d!.name}</b>
                    <span className="small num" style={{ whiteSpace: 'nowrap' }}>{kcalRange(d!.kcal)} kcal</span>
                  </span>
                  <ul>{reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                </span>
              </button>
            )
          })}
          <div className="confirm" style={{ marginTop: 12 }}>
            <Icon name="shield" size={18} />
            <span>Allergy flags are hints from the menu text and usual recipes. Always confirm with the restaurant.</span>
          </div>
        </>
      )}

      <div className="section-title"><h2 className="h2">Whole menu</h2><span className="small">best first</span></div>
      <div className="card-flat list-card">
        {(showAll ? ordered : ordered.slice(0, 6)).map((d) => (
          <button key={d.id} className="dish-row" onClick={() => onOpenDish(d.id)}>
            <span style={{ flex: 1, minWidth: 0, display: 'grid' }}>
              <span className="row" style={{ gap: 6 }}>
                <b style={{ fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</b>
                {result.top.includes(d.id) && <span className="badge top">Top</span>}
                {d.userAllergenHits.length > 0 && <span className="badge avoid">Allergy</span>}
              </span>
              <span className="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.translated}</span>
            </span>
            <span style={{ display: 'grid', justifyItems: 'end' }}>
              <span className="dr-k">{kcalRange(d.kcal)}</span>
              <span className="small">{Math.round(d.protein.mid)} g protein</span>
            </span>
            <Icon name="chevron" size={18} className="" />
          </button>
        ))}
      </div>
      {ordered.length > 6 && (
        <button className="btn btn-ghost" onClick={() => setShowAll((s) => !s)}>{showAll ? 'Show fewer' : `Show all ${ordered.length} dishes`}</button>
      )}
      <p className="small" style={{ marginTop: 16 }}>
        Ranges come from the open-source Nut AI engine: grams from standard recipes or typical portions, nutrition per 100 g from USDA FoodData Central or Open Food Facts. The AI only reads and translates the menu.
      </p>
      <Footer />

      {top[0] && (
        <div className="cta-bar">
          <button className="btn btn-primary" onClick={() => onShare(top[0]!)}>
            <Icon name="share" size={20} /> Share my best order
          </button>
        </div>
      )}
    </main>
  )
}
