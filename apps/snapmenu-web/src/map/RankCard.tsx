// Map adapted from the team's wohin app (apps/web/src/components/RankCard.tsx), restyled to Snapmenu.
// One compact layout for a ranked dish: goal fit, dish, restaurant, numbers. RankCard is the floating card
// in the map carousel; RankRow is the same content as a numbered row in the list.
import type { DishLite } from '../../../snapmenu-api/src/types'
import { kcalRange, n0 } from '../lib/format'
import { formatDistance } from '../lib/position'
import type { DishResult } from './ranking'

export function GoalFit({ score }: { score: number }) {
  return <span className="map-goal-fit" aria-label={`Dish goal fit ${score} out of 100`}>
    <span>Goal fit</span><strong>{score}/100</strong>
  </span>
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

const spoken = (result: DishResult) => `${result.dish.name} at ${result.place.name}, goal fit ${result.dish.score} out of 100${result.example ? ', example data' : ''}`

/** Floating dish card: the whole card opens its restaurant. */
export function RankCard({ result, className, active = false, onOpen }: { result: DishResult; className?: string; active?: boolean; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className={`rank-card ${active ? 'is-active' : ''} ${className ?? ''}`} aria-label={spoken(result)}>
      <GoalFit score={result.dish.score} />
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
      <GoalFit score={result.dish.score} />
    </button>
  )
}

/** Placeholder with the same footprint as RankCard while results load. */
export function RankCardSkeleton({ className }: { className?: string }) {
  return (
    <span className={`rank-card rank-card--skeleton ${className ?? ''}`} aria-hidden="true">
      <span className="skeleton rank-skel rank-skel--fit" />
      <span className="rank-card__body">
        <span className="skeleton rank-skel rank-skel--title" />
        <span className="skeleton rank-skel rank-skel--line" />
        <span className="skeleton rank-skel rank-skel--nums" />
      </span>
    </span>
  )
}
