/** Types for the CIQUAL 2025 table (Anses, CC BY 4.0). */

export type CiqualConfidence = 'A' | 'B' | 'C' | 'D'

/**
 * One generated row, per 100 g:
 * [code, French name, English name, subgroup code, kcal, protein g, carbs g, fat g,
 *  fibre g, sugars g, sodium mg, alcohol g, confidence,
 *  French search key, English search key, flags]
 *
 * A search key is "core words;other words" (see tokenize.mjs). Flags: 1 French
 * name is a raw/dried/frozen form, 2 English name is, 4 a CIQUAL "average" row.
 */
export type CiqualRow = readonly [
  number, string, string, string,
  number, number, number, number,
  number | null, number | null, number | null, number | null,
  string | null,
  string, string, number,
]

/** Same shape as ComponentRow['per100'] in ../../types.ts. */
export interface CiqualPer100 {
  kcal: number
  protein_g: number
  carbs_g: number
  fat_g: number
  fiber_g: number | null
  sugar_g: number | null
  sodium_mg: number | null
}

export interface CiqualFood {
  /** CIQUAL alim_code. */
  code: number
  nameFr: string
  nameEn: string
  group: string
  subgroup: string
  /** A composite dish, sandwich, pizza, soup or salad (CIQUAL group 01), not a single ingredient. */
  isDish: boolean
  per100: CiqualPer100
  alcohol_g: number | null
  /** CIQUAL's own reliability code, worst of protein, carbohydrate and fat: A best, D weakest. */
  confidence: CiqualConfidence | null
}

/** Ready to become a NumberSource variant: { kind: 'ciqual', ... }. */
export interface CiqualSource {
  kind: 'ciqual'
  code: string
  name: string
  url: string
  /** Text to show wherever the number is shown (the licence asks for it). */
  attribution: string
}

export interface CiqualHit {
  food: CiqualFood
  per100: CiqualPer100
  source: CiqualSource
  /** 'alias' = a pinned, hand-checked mapping. 'search' = a name match, weaker. */
  via: 'alias' | 'search'
  /** 0 to 1: the share of the query that the match accounts for. */
  score: number
}
