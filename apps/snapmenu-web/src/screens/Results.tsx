import { useState, type ReactNode } from 'react'
import type { DishEstimate, MenuResult, OrderTip } from '../../../snapmenu-api/src/types'
import { Fold, Footer, Icon, RangeTrack, Sheet, Wordmark } from '../components/ui'
import { allergySummary, goalLabel, kcalRange, n0 } from '../lib/format'

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
      onToast('Copied')
    } catch {
      onToast('Long-press the text to copy')
    }
  }
  const speak = () => {
    try {
      const u = new SpeechSynthesisUtterance(tip.local)
      u.rate = 0.92
      window.speechSynthesis.cancel()
      window.speechSynthesis.speak(u)
    } catch {
      onToast('Speech is not available here')
    }
  }
  return (
    <div className="say">
      <div className="s-label">
        <span>Say this</span>
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

/** The answer: one dish, its calorie range and protein. Everything else waits behind a tap. */
function BestCard({ d, tip, onOpen, onToast }: { d: DishEstimate; tip: OrderTip | undefined; onOpen: () => void; onToast: (t: string) => void }) {
  const [say, setSay] = useState(false)
  return (
    <article className="card best">
      <button className="best__head" onClick={onOpen} aria-label={`${d.name}, details`}>
        <span className="best__top">
          <span className="best__tag"><Icon name="spark" size={14} strokeWidth={2.2} /> Best order</span>
          {d.price && <span className="price">{d.price}</span>}
        </span>
        <span className="h2">{d.name}</span>
        {d.translated && d.translated !== d.name && <span className="small">{d.translated}</span>}
      </button>
      <div className="best__nums">
        <div className="big"><b>{kcalRange(d.kcal)}</b><span>kcal</span></div>
        <div className="big big--protein"><b>{n0(d.protein.mid)}<small>g</small></b><span>protein</span></div>
      </div>
      <RangeTrack range={d.kcal} />
      <p className="best__why">{d.why}</p>
      {d.allergens.length > 0 && (
        <div className="allergen-row" aria-label="Likely allergens">
          <span className="small">May contain</span>
          {d.allergens.map((a) => {
            const hit = d.userAllergenHits.some((h) => h.allergen === a.allergen)
            return <span key={a.allergen} className={`a-chip ${hit ? 'hit' : ''}`}>{hit && <Icon name="alert" size={13} />}{a.label.split(' (')[0]}</span>
          })}
        </div>
      )}
      <div className="best__actions">
        {tip && (
          <button className="btn btn-secondary btn-sm" aria-expanded={say} onClick={() => setSay((v) => !v)}>
            <Icon name="speaker" size={18} /> How to order
          </button>
        )}
        <button className="btn btn-ghost btn-sm" onClick={onOpen}>Details <Icon name="chevron" size={18} /></button>
      </div>
      {tip && say && <SayThis tip={tip} onToast={onToast} />}
    </article>
  )
}

/** One dish in a list: name, range, protein. */
function DishRow({ d, rank, tags, onOpen }: { d: DishEstimate; rank?: number; tags?: ReactNode; onOpen: () => void }) {
  return (
    <button className="dish-row" onClick={onOpen}>
      {rank != null && <span className="rank r2">{rank}</span>}
      <span className="dish-row__text">
        <span className="row" style={{ gap: 6 }}><b>{d.name}</b>{tags}</span>
        {d.translated && d.translated !== d.name && <span className="small">{d.translated}</span>}
      </span>
      <span className="dish-row__nums">
        <span className="dr-k">{kcalRange(d.kcal)}</span>
        <span className="small">{n0(d.protein.mid)} g protein</span>
      </span>
      <Icon name="chevron" size={18} />
    </button>
  )
}

export function Results({ result, onOpenDish, onRescan, onHome, onShare, onToast, attachSlot }: {
  result: MenuResult
  /** "Where are you eating?" and "Post", shown under the picks. */
  attachSlot?: ReactNode
  onOpenDish: (id: string) => void
  onRescan: () => void
  onHome: () => void
  onShare: (d: DishEstimate) => void
  onToast: (t: string) => void
}) {
  const [how, setHow] = useState(false)
  const byId = new Map(result.dishes.map((d) => [d.id, d]))
  const top = result.top.map((id) => byId.get(id)).filter((d): d is DishEstimate => Boolean(d))
  const avoid = result.avoid.map((a) => ({ ...a, d: byId.get(a.dishId) })).filter((a): a is typeof a & { d: DishEstimate } => Boolean(a.d))
  const allergyHits = avoid.filter((a) => a.d.userAllergenHits.length > 0).length
  const p = result.profile
  const ordered = [...result.dishes].sort((a, b) => b.score - a.score)
  const best = top[0]

  return (
    <main className="screen with-cta results">
      <div className="topbar">
        <Wordmark onClick={onHome} />
        <button className="btn btn-secondary btn-sm" onClick={onRescan}><Icon name="camera" size={18} /> New scan</button>
      </div>

      <header className="results-head">
        <h1 className="h1">{result.restaurant ?? 'Your menu'}</h1>
        <p className="body">{[`${result.dishes.length} dishes`, goalLabel(p), allergySummary(p.allergies)].filter(Boolean).join(' · ')}</p>
      </header>

      {best ? (
        <>
          <BestCard d={best} tip={result.tips.find((t) => t.dishId === best.id)} onOpen={() => onOpenDish(best.id)} onToast={onToast} />
          {top.length > 1 && (
            <div className="card-flat list-card" style={{ marginTop: 12 }}>
              {top.slice(1).map((d, i) => <DishRow key={d.id} d={d} rank={i + 2} onOpen={() => onOpenDish(d.id)} />)}
            </div>
          )}
        </>
      ) : (
        <div className="card best">
          <h2 className="h3">Nothing here fits</h2>
          <p className="body">Every dish clashes with your goal or allergies. Ask what the kitchen can change.</p>
        </div>
      )}

      {avoid.length > 0 && (
        <Fold title="Skip" count={avoid.length} badge={allergyHits > 0 ? <span className="badge avoid"><Icon name="alert" size={12} strokeWidth={2.2} /> {allergyHits === 1 ? 'Allergy' : `${allergyHits} allergies`}</span> : undefined}>
          {avoid.map(({ d, reasons }) => {
            const allergy = d.userAllergenHits.length > 0
            return (
              <button key={d.id} className="skip-row" onClick={() => onOpenDish(d.id)}>
                <span className={`avoid-ic ${allergy ? 'alert' : ''}`}><Icon name={allergy ? 'alert' : 'thumbDown'} size={18} /></span>
                <span className="skip-row__text">
                  <span className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <b>{d.name}</b>
                    <span className="small num">{kcalRange(d.kcal)}</span>
                  </span>
                  {reasons.map((r) => <span key={r} className="small">{r}</span>)}
                </span>
              </button>
            )
          })}
        </Fold>
      )}

      <Fold title="Whole menu" count={ordered.length}>
        {ordered.map((d) => (
          <DishRow
            key={d.id}
            d={d}
            onOpen={() => onOpenDish(d.id)}
            tags={<>
              {result.top.includes(d.id) && <span className="badge top">Top</span>}
              {d.userAllergenHits.length > 0 && <span className="badge avoid">Allergy</span>}
            </>}
          />
        ))}
      </Fold>

      {attachSlot && <div className="results-extra">{attachSlot}</div>}

      <button className="link-btn" style={{ alignSelf: 'center', marginTop: 12 }} onClick={() => setHow(true)}>
        <Icon name="info" size={16} /> How the numbers work
      </button>

      {best && (
        <div className="cta-bar">
          <button className="btn btn-primary" onClick={() => onShare(best)}>
            <Icon name="share" size={20} /> Share my best order
          </button>
        </div>
      )}

      {how && (
        <Sheet label="How the numbers work" onClose={() => setHow(false)}>
          <h2 className="h2">How the numbers work</h2>
          <ul className="how-list">
            <li><Icon name="focus" size={18} /><span>The AI only reads and translates the menu.</span></li>
            <li><Icon name="balance" size={18} /><span>Grams come from standard recipes or typical portions.</span></li>
            <li><Icon name="database" size={18} /><span>Nutrition per 100 g comes from USDA FoodData Central or Open Food Facts, through the open-source Nut AI engine.</span></li>
            <li><Icon name="shield" size={18} /><span>Every number is a range. Allergy flags are hints; always confirm with the restaurant.</span></li>
          </ul>
          <Footer />
          <button className="btn btn-secondary" onClick={() => setHow(false)}>Close</button>
        </Sheet>
      )}
    </main>
  )
}
