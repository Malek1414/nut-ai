// Map adapted from the team's wohin app (apps/web/src/components/RankCard.tsx), restyled to Snapmenu.
// Ranked dish cards for the map carousel and the map sheet list. RankCard is the big card (art on top,
// stat chips below); RankRow is the compact list row with a rank number.
import type { CSSProperties } from 'react'
import { formatDistance } from '../lib/position'
import { kcalRange, n0 } from '../lib/format'
import type { DishResult } from './ranking'

export function ScoreRing({ score, size = 40 }: { score: number; size?: number }) {
  const r = 16
  const c = 2 * Math.PI * r
  return (
    <span className="score-ring" style={{ width: size, height: size } as CSSProperties} role="img" aria-label={`Fit for your goal: ${score} of 100`}>
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <circle cx="20" cy="20" r={r} className="score-ring__track" />
        <circle cx="20" cy="20" r={r} className="score-ring__value" strokeDasharray={`${(score / 100) * c} ${c}`} transform="rotate(-90 20 20)" />
      </svg>
      <span className="score-ring__num">{score}</span>
    </span>
  )
}

const TINTS = [
  ['#e3efe8', '#1e6b4e'],
  ['#fdf1d8', '#a26c0a'],
  ['#e5ebfb', '#3b63d6'],
  ['#fbeedb', '#b9720f'],
  ['#f9e3ea', '#b03d61'],
  ['#ece9fb', '#6553cf'],
] as const

/** Soft placeholder art with the dish initial, tinted from the Snapmenu palette by the dish name. */
export function DishArt({ name, className }: { name: string; className?: string }) {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const [bg, ink] = TINTS[h % TINTS.length]!
  const initial = name.replace(/^[^\p{L}]+/u, '').charAt(0).toUpperCase() || '·'
  return (
    <span className={`dish-art ${className ?? ''}`} style={{ background: `radial-gradient(120% 140% at 85% 0%, #ffffff 0%, ${bg} 55%)`, color: ink }} aria-hidden="true">
      <span>{initial}</span>
    </span>
  )
}

export function ExampleBadge() {
  return <span className="example-badge" title="Example data to show how the map works, not a real scan">Example</span>
}

function placeLine(result: DishResult): string {
  const parts: string[] = []
  if (result.place.cuisine) parts.push(result.place.cuisine)
  if (result.distance !== null) parts.push(formatDistance(result.distance))
  return parts.join(' · ')
}

function Stats({ result }: { result: DishResult }) {
  const d = result.dish
  return (
    <span className="rank-stats">
      <span className="rank-stat rank-stat--protein"><b>{n0(d.protein)} g</b> protein</span>
      <span className="rank-stat"><b>~{n0(d.kcal.mid)}</b> kcal</span>
      {d.price && <span className="rank-stat"><b>{d.price}</b></span>}
    </span>
  )
}

/** Big dish card. `rank` adds the place number. */
export function RankCard({ result, rank, className, active = false, onOpen }: { result: DishResult; rank?: number; className?: string; active?: boolean; onOpen: () => void }) {
  const { dish, place } = result
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`rank-card ${active ? 'is-active' : ''} ${className ?? ''}`}
      aria-label={`${rank ? `Number ${rank}: ` : ''}${dish.name} at ${place.name}${result.example ? ', example data' : ''}`}
    >
      <span className="rank-card__media">
        <DishArt name={dish.name} className="rank-card__thumb" />
        {rank !== undefined && <span className="rank-card__rank">{rank}</span>}
        {result.example && <span className="rank-card__example"><ExampleBadge /></span>}
        <span className="rank-card__score"><ScoreRing score={dish.score} size={36} /></span>
      </span>
      <span className="rank-card__body">
        <span className="rank-card__head">
          <span className="rank-card__name">{dish.name}</span>
        </span>
        <span className="rank-card__place">
          <b>{place.name}</b>
          {placeLine(result) && <span className="rank-card__where">{placeLine(result)}</span>}
        </span>
        <Stats result={result} />
        <span className="rank-card__foot">
          <span className="rank-card__range">{kcalRange(dish.kcal)} kcal range</span>
          {result.dishes > 1 && <span className="rank-card__range">{result.dishes} dishes scanned</span>}
        </span>
      </span>
    </button>
  )
}

/** Compact ranked row for long lists. */
export function RankRow({ result, rank, onOpen }: { result: DishResult; rank: number; onOpen: () => void }) {
  const { dish, place } = result
  return (
    <button type="button" onClick={onOpen} className="rank-row" aria-label={`Number ${rank}: ${dish.name} at ${place.name}${result.example ? ', example data' : ''}`}>
      <span className="rank-row__rank" aria-hidden="true">{rank}</span>
      <DishArt name={dish.name} className="rank-row__thumb" />
      <span className="rank-row__body">
        <span className="rank-row__head">
          <span className="rank-row__name">{dish.name}</span>
          <ScoreRing score={dish.score} size={30} />
        </span>
        <span className="rank-row__place">
          <b>{place.name}</b>
          {placeLine(result) && <span className="rank-card__where">{placeLine(result)}</span>}
          {result.example && <ExampleBadge />}
        </span>
        <Stats result={result} />
      </span>
    </button>
  )
}

/** Placeholder with the same footprint as RankCard while results load. */
export function RankCardSkeleton({ className }: { className?: string }) {
  return (
    <span className={`rank-card rank-card--skeleton ${className ?? ''}`} aria-hidden="true">
      <span className="rank-card__media skeleton" />
      <span className="rank-card__body">
        <span className="skeleton rank-skel rank-skel--title" />
        <span className="skeleton rank-skel rank-skel--line" />
        <span className="skeleton rank-skel rank-skel--chips" />
      </span>
    </span>
  )
}
