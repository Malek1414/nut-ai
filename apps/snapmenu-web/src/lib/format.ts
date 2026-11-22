import { LANGUAGES, userLanguage, type Lang } from '../../../snapmenu-api/src/voice/index'

export const n0 = (v: number) => Math.round(v).toLocaleString('en-US')
export const kcalRange = (r: { low: number; high: number }) => `${n0(r.low)}–${n0(r.high)}`
export const sameWords = (a: string, b: string) => a.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '') === b.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

export const GOAL_LABEL: Record<string, string> = {
  lose_fat: 'Lose fat',
  build_muscle: 'Build muscle',
  balanced: 'Eat balanced',
  plant_based: 'Plant-based',
}

export const ALLERGY_OPTIONS: Array<{ id: string; label: string; hint: string }> = [
  { id: 'gluten', label: 'Gluten', hint: 'wheat, bread, pasta' },
  { id: 'milk', label: 'Milk / lactose', hint: 'cheese, cream, yogurt' },
  { id: 'eggs', label: 'Eggs', hint: 'mayo, carbonara' },
  { id: 'peanuts', label: 'Peanuts', hint: 'satay, pad thai' },
  { id: 'tree_nuts', label: 'Tree nuts', hint: 'pesto, almonds' },
  { id: 'sesame', label: 'Sesame', hint: 'tahini, hummus' },
  { id: 'soy', label: 'Soy', hint: 'tofu, soy sauce' },
  { id: 'fish', label: 'Fish', hint: 'anchovies, fish sauce' },
  { id: 'shellfish', label: 'Shellfish', hint: 'shrimp, mussels' },
  { id: 'celery', label: 'Celery', hint: 'broths, soups' },
  { id: 'mustard', label: 'Mustard', hint: 'dressings, sausages' },
  { id: 'sulphites', label: 'Sulphites', hint: 'wine, vinegar' },
]

/** The languages the app talks in: one list, shared with the API (snapmenu-api/src/voice). */
export { LANGUAGES }

/** Show an independent diet alongside the goal, without changing old profiles. */
export const goalLabel = (p: { goal: string; plantStyle?: string | undefined; diet?: string | undefined }) => {
  const diet = p.diet ?? (p.goal === 'plant_based' ? p.plantStyle ?? 'vegan' : 'any')
  const label = diet === 'vegetarian' ? 'Vegetarian' : diet === 'vegan' ? 'Vegan' : null
  return [p.goal !== 'plant_based' || !label ? GOAL_LABEL[p.goal] ?? 'Eat balanced' : null, label].filter(Boolean).join(' · ')
}

/** Short allergy name: "milk", "tree nuts". */
export const allergyName = (id: string) => (ALLERGY_OPTIONS.find((a) => a.id === id)?.label.split(' /')[0] ?? id.replace(/_/g, ' ')).toLowerCase()

/** "no sesame", "no milk, eggs", "3 allergies". */
export const allergySummary = (ids: string[]) => (ids.length === 0 ? '' : ids.length <= 2 ? `no ${ids.map(allergyName).join(', ')}` : `${ids.length} allergies`)

/** The phone's own language tag ("de-DE"), sent along so the API can answer in it. */
export function phoneLocale(): string {
  try {
    return navigator.language || 'en'
  } catch {
    return 'en'
  }
}

/** The phone's language when we talk it, else English. */
export const guessLanguage = (): Lang => userLanguage({ locale: phoneLocale() })
