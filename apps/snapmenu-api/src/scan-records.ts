import type { D1Like } from './d1-adapter.js'
import type { MenuResult } from './types.js'

const SCHEMA = 'CREATE TABLE IF NOT EXISTS scan_records (id TEXT PRIMARY KEY, device TEXT NOT NULL, ts INTEGER NOT NULL, body TEXT NOT NULL)'
export async function rememberScan(db: D1Like, result: MenuResult, device: string): Promise<void> {
  await db.prepare(SCHEMA).run()
  const dishes = result.dishes.map(d => ({ id: d.id, name: d.name, translated: d.translated, kcal: d.kcal, protein: d.protein.mid, carbs: d.carbs.mid, fat: d.fat.mid, fiber: d.fiber, price: d.price, vegetarian: d.diet.vegetarian, vegan: d.diet.vegan, course: d.course, allergens: d.allergens.map(a => a.allergen) }))
  await db.prepare('INSERT INTO scan_records (id,device,ts,body) VALUES (?,?,?,?)').bind(result.scanId, device, Date.now(), JSON.stringify({ goal: result.profile.goal, dishes })).run()
}

/** Public map and order writes copy the engine output, never client-supplied nutrition. */
export async function scanRecord(db: D1Like, id: unknown, device: unknown): Promise<{ goal: string; dishes: Array<Record<string, unknown>> } | null> {
  if (typeof id !== 'string' || typeof device !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(device)) return null
  await db.prepare(SCHEMA).run()
  const row = await db.prepare('SELECT body FROM scan_records WHERE id=? AND device=?').bind(id, device).first<{ body: string }>()
  return row ? JSON.parse(row.body) : null
}
