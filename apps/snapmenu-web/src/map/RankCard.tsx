// Map adapted from the team's wohin app (apps/web/src/components/RankCard.tsx), restyled to Snapmenu.
// One compact layout for a ranked dish: fit ring, dish, restaurant, numbers. RankCard is the floating card
// in the map carousel; RankRow is the same content as a numbered row in the list.
import type { CSSProperties } from 'react'
import type { DishLite } from '../../../snapmenu-api/src/types'
import { kcalRange, n0 } from '../lib/format'
import { formatDistance } from '../lib/position'
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

export function ExampleBadge() {
  return <span className="example-badge" title="Example data to show how the map works, not a real scan">Example</span>
}

/** "520–720 kcal  44 g protein  11,00 €": the honest range first. */
export function DishNums({ dish }: { dish: DishLite }) {
  return (
    <span className="dish-nums">
      <span><b>{kcalRange(dish.kcal)}</b> kcal</span>
      <span><b>{n0(dish.protein)} g</b> protein</span>
      {dish.price && <span>{dish.price}</span>}
    </span>
  )
}

function Where({ result }: { result: DishResult }) {
  return (
    <span className="rank-card__place">
      <span className="rank-card__where">{result.place.name}</span>
      {result.distance !== null && <span className="rank-card__far">{formatDistance(result.distance)}</span>}
      {result.example && <ExampleBadge />}
    </span>
  )
}

const spoken = (result: DishResult) => `${result.dish.name} at ${result.place.name}${result.example ? ', example data' : ''}`

/** Floating dish card: the whole card opens its restaurant. */
export function RankCard({ result, className, active = false, onOpen }: { result: DishResult; className?: string; active?: boolean; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className={`rank-card ${active ? 'is-active' : ''} ${className ?? ''}`} aria-label={spoken(result)}>
      <ScoreRing score={result.dish.score} size={44} />
      <span className="rank-card__body">
        <span className="rank-card__name">{result.dish.name}</span>
        <Where result={result} />
        <DishNums dish={result.dish} />
      </span>
    </button>
  )
}

/** Numbered row for the list. */
export function RankRow({ result, rank, onOpen }: { result: DishResult; rank: number; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="rank-row" aria-label={`Number ${rank}: ${spoken(result)}`}>
      <span className="rank-row__rank" aria-hidden="true">{rank}</span>
      <span className="rank-card__body">
        <span className="rank-card__name">{result.dish.name}</span>
        <Where result={result} />
        <DishNums dish={result.dish} />
      </span>
      <ScoreRing score={result.dish.score} size={38} />
    </button>
  )
}

/** Placeholder with the same footprint as RankCard while results load. */
export function RankCardSkeleton({ className }: { className?: string }) {
  return (
    <span className={`rank-card rank-card--skeleton ${className ?? ''}`} aria-hidden="true">
      <span className="skeleton rank-skel rank-skel--ring" />
      <span className="rank-card__body">
        <span className="skeleton rank-skel rank-skel--title" />
        <span className="skeleton rank-skel rank-skel--line" />
        <span className="skeleton rank-skel rank-skel--nums" />
      </span>
    </span>
  )
}
