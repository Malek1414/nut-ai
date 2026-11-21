/**
 * The sentences of "eating together", in the ten languages the app talks in.
 * Same rules as ../voice/copy.ts: short everyday words, no number typed in here
 * (a number enters through a {placeholder} only), and a {placeholder} stands
 * where a plain noun fits, so the same words work in every language.
 *
 * {needs} is a list of short labels built from the need.* lines:
 * "No place nearby fits Sara: no nuts, max 10 €."
 */
import { DEFAULT_LANGUAGE, toLang, type Lang } from '../voice/index.js'

const en = {
  // Nothing fits one person: said out loud, never averaged away.
  'conflict.nearby': 'No place nearby fits {name}: {needs}.',
  'conflict.place': 'Nothing here for {name}: {needs}.',
  'conflict.menu': 'Nothing on this menu fits {name}: {needs}.',
  // A need as a short label.
  'need.vegan': 'vegan',
  'need.vegetarian': 'vegetarian',
  'need.allergy': 'no {allergen}',
  'need.budget': 'max {budget} €',
  // What was checked for a pick. An allergy check reads the dish's words only: it is a hint, never a promise.
  'check.allergen': 'no {allergen} named',
  'check.budget': 'within budget',
  'allergen.shellfish': 'shellfish',
} as const

export type GroupCopyKey = keyof typeof en
type Copy = Record<GroupCopyKey, string>

const de: Copy = {
  'conflict.nearby': 'In der Nähe passt nichts für {name}: {needs}.',
  'conflict.place': 'Hier gibt es nichts für {name}: {needs}.',
  'conflict.menu': 'Auf dieser Karte passt nichts für {name}: {needs}.',
  'need.vegan': 'vegan',
  'need.vegetarian': 'vegetarisch',
  'need.allergy': 'ohne {allergen}',
  'need.budget': 'max. {budget} €',
  'check.allergen': '{allergen} nicht genannt',
  'check.budget': 'im Budget',
  'allergen.shellfish': 'Meeresfrüchte',
}

const es: Copy = {
  'conflict.nearby': 'Cerca no hay nada para {name}: {needs}.',
  'conflict.place': 'Aquí no hay nada para {name}: {needs}.',
  'conflict.menu': 'En esta carta no hay nada para {name}: {needs}.',
  'need.vegan': 'vegano',
  'need.vegetarian': 'vegetariano',
  'need.allergy': 'sin {allergen}',
  'need.budget': 'máx. {budget} €',
  'check.allergen': 'no se menciona {allergen}',
  'check.budget': 'dentro del presupuesto',
  'allergen.shellfish': 'marisco',
}

const fr: Copy = {
  'conflict.nearby': 'Rien à proximité pour {name} : {needs}.',
  'conflict.place': 'Rien ici pour {name} : {needs}.',
  'conflict.menu': 'Rien sur cette carte pour {name} : {needs}.',
  'need.vegan': 'végan',
  'need.vegetarian': 'végétarien',
  'need.allergy': 'sans {allergen}',
  'need.budget': 'max. {budget} €',
  'check.allergen': '{allergen} non mentionné',
  'check.budget': 'dans le budget',
  'allergen.shellfish': 'fruits de mer',
}

const it: Copy = {
  'conflict.nearby': 'Niente nei dintorni per {name}: {needs}.',
  'conflict.place': 'Qui niente per {name}: {needs}.',
  'conflict.menu': 'Niente in questo menu per {name}: {needs}.',
  'need.vegan': 'vegano',
  'need.vegetarian': 'vegetariano',
  'need.allergy': 'senza {allergen}',
  'need.budget': 'max {budget} €',
  'check.allergen': '{allergen} non indicato',
  'check.budget': 'nel budget',
  'allergen.shellfish': 'frutti di mare',
}

const pt: Copy = {
  'conflict.nearby': 'Nada por perto para {name}: {needs}.',
  'conflict.place': 'Nada aqui para {name}: {needs}.',
  'conflict.menu': 'Nada neste menu para {name}: {needs}.',
  'need.vegan': 'vegano',
  'need.vegetarian': 'vegetariano',
  'need.allergy': 'sem {allergen}',
  'need.budget': 'máx. {budget} €',
  'check.allergen': '{allergen} não mencionado',
  'check.budget': 'dentro do orçamento',
  'allergen.shellfish': 'marisco',
}

const tr: Copy = {
  'conflict.nearby': 'Yakında {name} için uygun yer yok: {needs}.',
  'conflict.place': 'Burada {name} için bir şey yok: {needs}.',
  'conflict.menu': 'Bu menüde {name} için bir şey yok: {needs}.',
  'need.vegan': 'vegan',
  'need.vegetarian': 'vejetaryen',
  'need.allergy': '{allergen} yok',
  'need.budget': 'en fazla {budget} €',
  'check.allergen': '{allergen} belirtilmemiş',
  'check.budget': 'bütçeye uygun',
  'allergen.shellfish': 'kabuklu deniz ürünleri',
}

const pl: Copy = {
  'conflict.nearby': 'W pobliżu nic dla {name}: {needs}.',
  'conflict.place': 'Tutaj nic dla {name}: {needs}.',
  'conflict.menu': 'W tym menu nic dla {name}: {needs}.',
  'need.vegan': 'wegańskie',
  'need.vegetarian': 'wegetariańskie',
  'need.allergy': 'bez: {allergen}',
  'need.budget': 'maks. {budget} €',
  'check.allergen': 'nie podano: {allergen}',
  'check.budget': 'w budżecie',
  'allergen.shellfish': 'owoce morza',
}

const nl: Copy = {
  'conflict.nearby': 'Niets in de buurt voor {name}: {needs}.',
  'conflict.place': 'Hier is niets voor {name}: {needs}.',
  'conflict.menu': 'Niets op deze kaart voor {name}: {needs}.',
  'need.vegan': 'vegan',
  'need.vegetarian': 'vegetarisch',
  'need.allergy': 'zonder {allergen}',
  'need.budget': 'max. {budget} €',
  'check.allergen': '{allergen} niet genoemd',
  'check.budget': 'binnen budget',
  'allergen.shellfish': 'schaaldieren',
}

const ar: Copy = {
  'conflict.nearby': 'لا يوجد مكان قريب يناسب {name}: {needs}.',
  'conflict.place': 'لا شيء هنا يناسب {name}: {needs}.',
  'conflict.menu': 'لا شيء في هذه القائمة يناسب {name}: {needs}.',
  'need.vegan': 'نباتي صرف',
  'need.vegetarian': 'نباتي',
  'need.allergy': 'بدون {allergen}',
  'need.budget': 'بحد أقصى {budget} €',
  'check.allergen': '{allergen} غير مذكور',
  'check.budget': 'ضمن الميزانية',
  'allergen.shellfish': 'مأكولات بحرية',
}

export const GROUP_COPY: Record<Lang, Copy> = { English: en, German: de, Spanish: es, French: fr, Italian: it, Portuguese: pt, Turkish: tr, Polish: pl, Dutch: nl, Arabic: ar }

const NUMBER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

/** A fixed sentence of this module in the person's language (English when we do not talk theirs). */
export function gsay(lang: unknown, key: GroupCopyKey, vars: Record<string, string | number> = {}): string {
  return GROUP_COPY[toLang(lang) ?? DEFAULT_LANGUAGE][key].replace(/\{(\w+)\}/g, (_m, name: string) => {
    const v = vars[name]
    return typeof v === 'number' ? NUMBER.format(v) : v ?? ''
  })
}
