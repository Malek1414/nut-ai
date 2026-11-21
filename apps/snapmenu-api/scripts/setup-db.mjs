#!/usr/bin/env node
/**
 * Loads the local D1 database for `wrangler dev --local`:
 *   1. the events table (migrations/0001_events.sql)
 *   2. the USDA nutrition corpus built by `npm run data:build` (Nut AI's tool),
 *      dumped from data/nutrition.db into SQL, with the FTS5 indexes rebuilt.
 *
 * Build the corpus first if missing:
 *   OUT=$PWD/apps/snapmenu-api/data/nutrition.db npm run data:build
 */
import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const HERE = dirname(fileURLToPath(import.meta.url))
const APP = join(HERE, '..')
const REPO = join(APP, '../..')
const DB_FILE = join(APP, 'data/nutrition.db')

if (!existsSync(DB_FILE)) {
  console.log('data/nutrition.db missing, building it with Nut AI\'s data tool...')
  execFileSync('npm', ['run', 'data:build'], { cwd: REPO, stdio: 'inherit', env: { ...process.env, OUT: DB_FILE } })
}

const src = new DatabaseSync(DB_FILE, { readOnly: true })
const lit = (v) => (v == null ? 'NULL' : typeof v === 'number' || typeof v === 'bigint' ? String(v) : `'${String(v).replace(/'/g, "''")}'`)

const schemaSrc = await import('node:fs/promises').then((fs) => fs.readFile(join(REPO, 'packages/db-adapter/src/schema.ts'), 'utf8'))
const grab = (name) => new RegExp(`export const ${name} = \`([\\s\\S]*?)\``).exec(schemaSrc)[1]

let sql = 'DROP TABLE IF EXISTS food_fts;\nDROP TABLE IF EXISTS food_fts_trigram;\nDROP TABLE IF EXISTS food_portions;\nDROP TABLE IF EXISTS foods;\nDROP TABLE IF EXISTS brands;\nDROP TABLE IF EXISTS build_manifest;\n'
// Only the tables the resolver reads; skip food_micros / food_synonyms when empty.
sql += grab('NUTRITION_SCHEMA') + '\n' + grab('NUTRITION_FTS_SCHEMA') + '\n'

for (const table of ['brands', 'foods', 'food_portions', 'build_manifest']) {
  const rows = src.prepare(`SELECT * FROM ${table}`).all()
  if (rows.length === 0) continue
  const cols = Object.keys(rows[0])
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200)
    sql += `INSERT INTO ${table} (${cols.join(',')}) VALUES ${chunk.map((r) => `(${cols.map((c) => lit(r[c])).join(',')})`).join(',')};\n`
  }
}
sql += "INSERT INTO food_fts (rowid, name, brand, synonyms) SELECT id, name, '', '' FROM foods;\n"
sql += 'INSERT INTO food_fts_trigram (rowid, name) SELECT id, name FROM foods;\n'

const out = join(APP, 'data/seed.sql')
writeFileSync(out, sql)
console.log(`wrote ${out} (${(sql.length / 1024 / 1024).toFixed(1)} MB)`)

const wrangler = (args) => execFileSync('npx', ['wrangler', 'd1', 'execute', 'snapmenu', '--local', ...args], { cwd: APP, stdio: 'inherit' })
wrangler(['--file', 'migrations/0001_events.sql'])
wrangler(['--file', 'data/seed.sql'])
wrangler(['--command', "SELECT COUNT(*) AS foods FROM foods; SELECT COUNT(*) AS fts FROM food_fts WHERE food_fts MATCH '\"chicken\" \"breast\"'"])
