import { describe, expect, it } from 'vitest'
import type { ComponentRow } from '../../types.js'
import { parseValue } from './build.mjs'
import {
  CIQUAL_ALIASES, CIQUAL_ATTRIBUTION, CIQUAL_META, ciqualByCode, ciqualDishReference, lookupCiqual, normalize, searchCiqual, warmCiqual,
} from './index.js'
import { CIQUAL_GROUPS, CIQUAL_ROWS } from './table.generated.js'
import { nameFlags, nameKey } from './tokenize.mjs'

describe('CIQUAL build: cell parsing', () => {
  it('reads French decimals, traces, below-limit and missing cells', () => {
    expect(parseValue('12,5')).toBe(12.5)
    expect(parseValue(' 274 ')).toBe(274)
    expect(parseValue('traces')).toBe(0)
    expect(parseValue('< 0,5')).toBe(0.25)
    expect(parseValue('-')).toBeNull()
    expect(parseValue('')).toBeNull()
    expect(parseValue(null)).toBeNull()
  })
})

describe('CIQUAL table', () => {
  it('is the pinned 2025 release with its licence and citation', () => {
    expect(CIQUAL_META.doi).toBe('10.5281/zenodo.17550133')
    expect(CIQUAL_META.licence).toBe('CC BY 4.0')
    expect(CIQUAL_META.foods).toBe(CIQUAL_ROWS.length)
    expect(CIQUAL_ROWS.length).toBeGreaterThan(3000)
    expect(CIQUAL_ATTRIBUTION).toContain('Anses. 2025. Ciqual')
    expect(CIQUAL_ATTRIBUTION).toContain('https://doi.org/10.5281/zenodo.17550133')
  })

  // One assertion per test: 3,000 rows times a dozen expect() calls is slow.
  it('has unique, sorted codes, names in both languages and a known group', () => {
    const bad: string[] = []
    let last = -1
    for (const r of CIQUAL_ROWS) {
      if (r[0] <= last) bad.push(`${r[0]}: code out of order or repeated`)
      last = r[0]
      if (r[1].length < 2 || r[2].length < 2) bad.push(`${r[0]}: name missing`)
      if (!CIQUAL_GROUPS[r[3]]) bad.push(`${r[0]}: unknown group ${r[3]}`)
      if (r[3].startsWith('11')) bad.push(`${r[0]}: baby food`)
    }
    expect(bad).toEqual([])
  })

  it('keeps every number inside physical limits', () => {
    const bad: string[] = []
    for (const r of CIQUAL_ROWS) {
      if (!(r[4] >= 0 && r[4] <= 902)) bad.push(`${r[0]}: ${r[4]} kcal`)
      for (const g of [r[5], r[6], r[7], r[8] ?? 0, r[9] ?? 0, r[11] ?? 0]) {
        if (!(g >= 0 && g <= 100.5)) bad.push(`${r[0]}: ${g} g per 100 g`)
      }
      if (r[10] != null && !(r[10] >= 0 && r[10] <= 40000)) bad.push(`${r[0]}: ${r[10]} mg sodium`)
    }
    expect(bad).toEqual([])
  })

  it('stored search keys match the tokenizer (rebuild the table after changing tokenize.mjs)', () => {
    const stale: number[] = []
    for (const r of CIQUAL_ROWS) {
      if (r[13] !== nameKey(r[1]) || r[14] !== nameKey(r[2]) || r[15] !== nameFlags(r[1], r[2])) stale.push(r[0])
    }
    expect(stale).toEqual([])
  })

  it('agrees with its own energy: macros add up to the stated kcal for nearly every row', () => {
    let off = 0
    for (const r of CIQUAL_ROWS) {
      const computed = 4 * r[5] + 4 * r[6] + 9 * r[7] + 2 * (r[8] ?? 0) + 7 * (r[11] ?? 0)
      if (Math.abs(computed - r[4]) > Math.max(15, r[4] * 0.12)) off++
    }
    // Polyols and organic acids (not kept) explain the few that differ: chewing gum, vinegar.
    expect(off / CIQUAL_ROWS.length).toBeLessThan(0.02)
  })
})

describe('CIQUAL aliases', () => {
  it('every alias is pinned to an existing row whose French name still matches', () => {
    for (const a of CIQUAL_ALIASES) {
      const food = ciqualByCode(a.code)
      expect(food, `code ${a.code}`).not.toBeNull()
      expect(normalize(food!.nameFr), `code ${a.code}: ${food!.nameFr}`).toContain(normalize(a.pin))
    }
  })

  it('no spelling points at two different rows', () => {
    const seen = new Map<string, number>()
    for (const a of CIQUAL_ALIASES) {
      for (const k of a.keys) {
        const key = normalize(k)
        expect(seen.has(key) && seen.get(key) !== a.code, `"${k}" maps to ${seen.get(key)} and ${a.code}`).toBe(false)
        seen.set(key, a.code)
      }
    }
  })

  it('every spelling resolves to its own row', () => {
    for (const a of CIQUAL_ALIASES) {
      for (const k of a.keys) expect(lookupCiqual(k)?.food.code, k).toBe(a.code)
    }
  })
})

describe('CIQUAL lookup', () => {
  it('returns the table values with the source to show', () => {
    const hit = lookupCiqual('Tzatziki')
    expect(hit).not.toBeNull()
    expect(hit!.food.code).toBe(19863)
    expect(hit!.via).toBe('alias')
    expect(hit!.per100).toEqual({ kcal: 138, protein_g: 6.19, carbs_g: 3.8, fat_g: 10.9, fiber_g: hit!.per100.fiber_g, sugar_g: hit!.per100.sugar_g, sodium_mg: hit!.per100.sodium_mg })
    expect(hit!.food.confidence).toBe('A')
    expect(hit!.source).toEqual({
      kind: 'ciqual', code: '19863', name: 'Tzatziki, with yogurt, prepacked',
      url: 'https://doi.org/10.5281/zenodo.17550133', attribution: CIQUAL_ATTRIBUTION,
    })
    // Same shape the engine stores per component.
    const per100: ComponentRow['per100'] = hit!.per100
    expect(per100.kcal).toBe(138)
  })

  it('reads German, Italian, Spanish and Turkish menu words through the aliases', () => {
    expect(lookupCiqual('Laugenbrezel')?.food.code).toBe(7263)
    expect(lookupCiqual('Pommes frites')?.food.code).toBe(4032)
    expect(lookupCiqual('Schafskäse')?.food.code).toBe(12066)
    expect(lookupCiqual('Kartoffelpüree')?.food.code).toBe(4018)
    expect(lookupCiqual('Parmigiano Reggiano')?.food.code).toBe(12120)
    expect(lookupCiqual('Patatas fritas')?.food.code).toBe(4032)
    expect(lookupCiqual('Cacık')?.food.code).toBe(19863)
    expect(lookupCiqual('Rotwein')?.food.alcohol_g).toBeGreaterThan(5)
  })

  it('resolves the components the dish table estimates by hand today', () => {
    // dishes.ts keys with a hand-written per100 and no database row.
    expect(lookupCiqual('doner sauce yogurt garlic')?.food.code).toBe(11166)
    expect(lookupCiqual('yogurt garlic sauce')?.food.code).toBe(11166)
    expect(lookupCiqual('mascarpone cream')?.food.code).toBe(19584)
  })

  it('finds French and English names without an alias', () => {
    expect(lookupCiqual('Camembert')?.via).toBe('search')
    expect(lookupCiqual('Camembert')?.food.nameFr.toLowerCase()).toContain('camembert')
    expect(searchCiqual('moussaka')[0]?.food.code).toBe(25123)
    expect(searchCiqual('saucisse de Francfort')[0]?.food.code).toBe(30134)
  })

  it('keeps pasta and pâté apart', () => {
    for (const m of searchCiqual('pâtes cuites', { limit: 10 })) expect(m.food.nameFr.toLowerCase()).toContain('pâtes')
    for (const m of searchCiqual('pâté', { limit: 10 })) expect(m.food.nameFr.toLowerCase()).not.toContain('pâtes')
  })

  it('prefers the cooked form over raw, frozen or powdered', () => {
    const top = searchCiqual('gnocchi')[0]
    expect(top?.food.nameEn.toLowerCase()).toContain('cooked')
  })

  it('gives the same answers warmed or cold', () => {
    const cold = lookupCiqual('Oeuf dur')?.food.code
    warmCiqual()
    warmCiqual()
    expect(lookupCiqual('Oeuf dur')?.food.code).toBe(cold)
    expect(cold).toBe(22010)
  })

  it('can be limited to the hand-checked aliases', () => {
    expect(lookupCiqual('Camembert', { aliasOnly: true })).toBeNull()
    expect(lookupCiqual('Tzatziki', { aliasOnly: true })?.food.code).toBe(19863)
    expect(lookupCiqual('Camembert')?.via).toBe('search')
  })

  it('ignores sizes on a menu line', () => {
    expect(lookupCiqual('Bier vom Fass 0,5l')?.food.code).toBe(5001)
    expect(lookupCiqual('Cola 0,33')?.food.nameEn).toContain('Cola')
    expect(lookupCiqual('Rotwein 0,2 l')?.food.code).toBe(5214)
  })

  it('settles ties with an exact name or the table\'s own average row', () => {
    expect(lookupCiqual('smoked salmon')?.food.nameEn).toBe('Salmon, smoked')
    expect(lookupCiqual('butter')?.food.nameEn).toContain('(average)')
    expect(lookupCiqual('pizza')?.food.nameEn).toBe('Pizza (average)')
    // Chicken rows run from 107 to 247 kcal: too far apart to pick one.
    expect(lookupCiqual('chicken')).toBeNull()
  })

  it('declines words that mean different foods in different languages', () => {
    expect(lookupCiqual('Pommes')).toBeNull() // fries in German, apples in French
    expect(lookupCiqual('Chips')).toBeNull() // fries in English, crisps in French and German
    expect(lookupCiqual('Tortilla')).toBeNull() // omelette in Spain, wrap elsewhere
    expect(lookupCiqual('Pommes frites')?.food.code).toBe(4032)
  })

  it('returns nothing rather than a weak guess', () => {
    expect(lookupCiqual('salad')).toBeNull()
    expect(lookupCiqual('mozzarella pizza')?.food.code).not.toBe(19590)
    expect(lookupCiqual('Wiener Schnitzel mit Pommes')).toBeNull()
    expect(lookupCiqual('')).toBeNull()
    expect(lookupCiqual('white wine butter sauce')).toBeNull()
    expect(lookupCiqual('Adana Kebab Teller')).toBeNull()
    expect(lookupCiqual('chicken curry with rice')).toBeNull()
    expect(lookupCiqual('xyzzy')).toBeNull()
    expect(searchCiqual('white wine butter sauce')).toEqual([])
  })
})

describe('CIQUAL whole-dish reference', () => {
  it('gives a per-100 g second opinion for common European dishes', () => {
    const doner = ciqualDishReference('Döner Kebab im Brot')
    expect(doner?.food.code).toBe(25428)
    expect(doner?.food.isDish).toBe(true)
    expect(doner?.per100.kcal).toBe(232)
    expect(ciqualDishReference('Spaghetti alla Carbonara')?.food.code).toBe(25135)
    expect(ciqualDishReference('Pizza Margherita')?.food.code).toBe(25404)
    expect(ciqualDishReference('Moussaka')?.food.code).toBe(25123)
    expect(ciqualDishReference('Flammkuchen Elsässer Art')?.food.code).toBe(25550)
    // Desserts sit outside CIQUAL's "dishes" group; the alias list flags them as menu items.
    expect(ciqualDishReference('Tiramisù')?.food.code).toBe(19698)
    expect(ciqualDishReference('Baklava')?.per100.kcal).toBe(459)
  })

  it('never answers a dish question with a single ingredient', () => {
    expect(ciqualDishReference('Mozzarella')).toBeNull()
    expect(ciqualDishReference('Reis')).toBeNull()
  })
})
