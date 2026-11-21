export const n0 = (v: number) => Math.round(v).toLocaleString('en-US')
export const kcalRange = (r: { low: number; high: number }) => `${n0(r.low)}–${n0(r.high)}`

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

export const LANGUAGES: Array<{ id: string; label: string; native: string }> = [
  { id: 'English', label: 'English', native: 'English' },
  { id: 'German', label: 'German', native: 'Deutsch' },
  { id: 'Spanish', label: 'Spanish', native: 'Español' },
  { id: 'French', label: 'French', native: 'Français' },
  { id: 'Italian', label: 'Italian', native: 'Italiano' },
  { id: 'Portuguese', label: 'Portuguese', native: 'Português' },
  { id: 'Turkish', label: 'Turkish', native: 'Türkçe' },
  { id: 'Polish', label: 'Polish', native: 'Polski' },
  { id: 'Dutch', label: 'Dutch', native: 'Nederlands' },
  { id: 'Arabic', label: 'Arabic', native: 'العربية' },
]
