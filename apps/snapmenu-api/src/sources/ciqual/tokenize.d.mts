/** Words that name a family, not a food: "Emmental cheese" is found by "emmental". */
export const GENERIC: Set<string>
/** Lowercase ASCII words; keeps pâté, pâtes (pasta) and pâte apart. */
export function normalize(s: string): string
/** Meaningful words of a name or query: no filler words, numbers or sizes; plurals folded. */
export function tokens(s: string): string[]
/** True for raw, dried, frozen or powdered forms. */
export function isOffPlate(s: string): boolean
/** Search key of one name: "core words;other words". */
export function nameKey(name: string): string
/** Bit 1: French name off-plate. Bit 2: English name off-plate. Bit 4: a CIQUAL "average" row. */
export function nameFlags(nameFr: string, nameEn: string): number
