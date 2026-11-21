#!/usr/bin/env node
/**
 * Builds src/sources/ciqual/table.generated.ts from the official CIQUAL 2025 XML files.
 *
 *   node apps/snapmenu-api/src/sources/ciqual/build.mjs
 *
 * Source: Anses. 2025. Ciqual French food composition table.
 *         https://doi.org/10.5281/zenodo.17550133 (CC BY 4.0)
 *
 * Run it again after a change to tokenize.mjs (the search keys are stored in the table).
 *
 * No dependencies. The four XML files are downloaded once from the Zenodo record
 * into data/sources/ciqual/raw (git-ignored, about 71 MB) and checked against the
 * md5 that Zenodo publishes, so the same input always gives the same table.
 * Set CIQUAL_RAW to read the XML from another directory.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { nameFlags, nameKey } from './tokenize.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const RAW = process.env.CIQUAL_RAW ?? join(HERE, '../../../data/sources/ciqual/raw')
const OUT = join(HERE, 'table.generated.ts')

const RECORD = '17550133'
const DOI = '10.5281/zenodo.17550133'
const FILES = {
  alim: { name: 'alim_2025_11_03.xml', md5: '8e1171d63cee4b6010cfce25dd29243d' },
  groups: { name: 'alim_grp_2025_11_03.xml', md5: 'c31aeea90349c3aab86f98ef5f4f10da' },
  constituents: { name: 'const_2025_11_03.xml', md5: 'd8f2f25fdacb887bc993a6eeaf80f203' },
  compo: { name: 'compo_2025_11_03.xml', md5: '2da725585946434df320d8041631998b' },
}

/** CIQUAL constituent codes we keep (const_2025_11_03.xml). */
const C = {
  kcal: 328, // Energy, Regulation EU No 1169/2011 (kcal/100 g)
  kcalJones: 333, // fallback: Energy, N x Jones' factor, with fibres
  protein: 25000, // Protein, N x Jones' factor
  proteinCrude: 25003, // fallback: N x 6.25
  carbs: 31000,
  sugar: 32000,
  fiber: 34100,
  fat: 40000,
  salt: 10004, // g/100 g
  sodium: 10110, // mg/100 g
  alcohol: 60000,
}
const WANTED = new Set(Object.values(C))

/** Baby food is never a restaurant component. */
const SKIP_GROUPS = new Set(['11'])

async function ensure(file) {
  const path = join(RAW, file.name)
  if (!existsSync(path)) {
    mkdirSync(RAW, { recursive: true })
    const url = `https://zenodo.org/api/records/${RECORD}/files/${file.name}/content`
    console.log(`downloading ${file.name} ...`)
    const res = await fetch(url, { headers: { 'User-Agent': 'ciqual-table-build/1.0' } })
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
    writeFileSync(path, Buffer.from(await res.arrayBuffer()))
  }
  const buf = readFileSync(path)
  const md5 = createHash('md5').update(buf).digest('hex')
  if (md5 !== file.md5) throw new Error(`${file.name}: md5 ${md5}, expected ${file.md5}. Delete the file and run again.`)
  return buf.toString('utf8').replace(/^﻿/, '')
}

const unescapeXml = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

const field = (block, name) => {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(block)
  return m ? unescapeXml(m[1]).replace(/\s+/g, ' ').trim() : null
}

/**
 * A CIQUAL content cell: "12,5" is 12.5, "traces" is 0, "< 0,5" is half the
 * bound (0.25), "-" or an absent cell is unknown (null).
 */
export function parseValue(raw) {
  if (raw == null) return null
  const v = raw.trim().toLowerCase()
  if (v === '' || v === '-') return null
  if (v === 'traces') return 0
  const lt = /^<\s*([\d.,]+)$/.exec(v)
  const num = Number((lt ? lt[1] : v).replace(',', '.'))
  if (!Number.isFinite(num)) return null
  return lt ? Math.round((num / 2) * 1000) / 1000 : num
}

const RANK = { A: 0, B: 1, C: 2, D: 3 }

async function main() {
  const groupsXml = await ensure(FILES.groups)
  const alimXml = await ensure(FILES.alim)
  await ensure(FILES.constituents)
  const compoXml = await ensure(FILES.compo)

  const groups = {}
  for (const m of groupsXml.matchAll(/<ALIM_GRP>([\s\S]*?)<\/ALIM_GRP>/g)) {
    const code = field(m[1], 'alim_ssgrp_code')
    if (code && !groups[code]) groups[code] = [field(m[1], 'alim_grp_nom_eng'), field(m[1], 'alim_ssgrp_nom_eng')]
  }

  /** code -> { constituent code -> [value, confidence] } */
  const compo = new Map()
  for (const m of compoXml.matchAll(/<COMPO>([\s\S]*?)<\/COMPO>/g)) {
    const constCode = Number(/<const_code>\s*(\d+)\s*<\/const_code>/.exec(m[1])?.[1])
    if (!WANTED.has(constCode)) continue
    const alimCode = Number(/<alim_code>\s*(\d+)\s*<\/alim_code>/.exec(m[1])?.[1])
    const value = parseValue(field(m[1], 'teneur'))
    if (value == null) continue
    let row = compo.get(alimCode)
    if (!row) compo.set(alimCode, (row = {}))
    row[constCode] = [value, field(m[1], 'code_confiance') || null]
  }

  const rows = []
  const dropped = { babyFood: 0, noEnergyOrMacros: 0 }
  for (const m of alimXml.matchAll(/<ALIM>([\s\S]*?)<\/ALIM>/g)) {
    const code = Number(field(m[1], 'alim_code'))
    if (SKIP_GROUPS.has(field(m[1], 'alim_grp_code') ?? '')) { dropped.babyFood++; continue }
    const c = compo.get(code) ?? {}
    const get = (k) => c[k]?.[0] ?? null
    const kcal = get(C.kcal) ?? get(C.kcalJones)
    const proteinCell = c[C.protein] ?? c[C.proteinCrude]
    const protein = proteinCell?.[0] ?? null
    const carbs = get(C.carbs)
    const fat = get(C.fat)
    if (kcal == null || protein == null || carbs == null || fat == null) { dropped.noEnergyOrMacros++; continue }
    const salt = get(C.salt)
    const sodium = get(C.sodium) ?? (salt == null ? null : Math.round(salt * 400))
    // The table's own reliability code, worst of the three macros (A best, D worst).
    const codes = [proteinCell?.[1], c[C.carbs]?.[1], c[C.fat]?.[1]].filter((x) => x && x in RANK)
    const confidence = codes.length ? codes.reduce((a, b) => (RANK[b] > RANK[a] ? b : a)) : null
    const nameFr = field(m[1], 'alim_nom_fr')
    const nameEn = field(m[1], 'alim_nom_eng')
    rows.push([
      code, nameFr, nameEn, field(m[1], 'alim_ssgrp_code'),
      kcal, protein, carbs, fat, get(C.fiber), get(C.sugar), sodium, get(C.alcohol), confidence,
      // Search keys, made here so the Worker never tokenises 3,000 names at run time.
      nameKey(nameFr), nameKey(nameEn), nameFlags(nameFr, nameEn),
    ])
  }
  rows.sort((a, b) => a[0] - b[0])

  const usedGroups = Object.fromEntries(Object.entries(groups).filter(([k]) => rows.some((r) => r[3] === k)).sort())
  const meta = {
    table: 'Ciqual French food composition table 2025',
    publisher: 'Anses (French Agency for Food, Environmental and Occupational Health & Safety)',
    citation: 'Anses. 2025. Ciqual French food composition table.',
    doi: DOI,
    url: `https://doi.org/${DOI}`,
    licence: 'CC BY 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
    files: Object.fromEntries(Object.values(FILES).map((f) => [f.name, f.md5])),
    foods: rows.length,
    dropped,
  }

  const out = `/* eslint-disable */
// GENERATED by build.mjs. Do not edit by hand; run \`node apps/snapmenu-api/src/sources/ciqual/build.mjs\`.
//
// Data: ${meta.citation} ${meta.url}
// Licence: Creative Commons Attribution 4.0 (CC BY 4.0). Snapmenu changed the format only:
// 11 of the 74 components, per 100 g, baby food and rows without energy or macros left out.
import type { CiqualRow } from './types.js'

export const CIQUAL_META = ${JSON.stringify(meta, null, 2)} as const

/** Subgroup code -> [group, subgroup] (English). */
export const CIQUAL_GROUPS: Record<string, readonly [string, string]> = ${JSON.stringify(usedGroups, null, 1)}

/**
 * [code, French name, English name, subgroup, kcal, protein, carbs, fat, fibre, sugars, sodium mg, alcohol, confidence,
 *  French search key, English search key, flags]. Nutrients per 100 g.
 */
export const CIQUAL_ROWS: readonly CiqualRow[] = [
${rows.map((r) => JSON.stringify(r)).join(',\n')},
]
`
  writeFileSync(OUT, out)
  console.log(`wrote ${OUT}: ${rows.length} foods, ${(out.length / 1024).toFixed(0)} KB (dropped ${JSON.stringify(dropped)})`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main()
