/**
 * Tables of the discover feature. Created on first use, like the map and community tables, so a fresh
 * local D1 works without a migration step. The same statements are in migrations/0120_discover.sql.
 */
import type { D1Like } from '../d1-adapter.js'

export const DISCOVER_SCHEMA = [
  // One-tap community reports: "seed-oil free? yes / no", one per device and restaurant, with an optional source link.
  `CREATE TABLE IF NOT EXISTS seed_oil_reports (place_id TEXT NOT NULL, device TEXT NOT NULL, value INTEGER NOT NULL, source_url TEXT,
    lat REAL NOT NULL, lng REAL NOT NULL, ts INTEGER NOT NULL, team INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (place_id, device))`,
  `CREATE INDEX IF NOT EXISTS idx_sor_geo ON seed_oil_reports(lat, lng)`,
  // What a restaurant's own website says about seed oils, when we fetched it. ok = 0: the page could not be read.
  `CREATE TABLE IF NOT EXISTS seed_oil_web (place_id TEXT PRIMARY KEY, url TEXT NOT NULL, ts INTEGER NOT NULL, ok INTEGER NOT NULL DEFAULT 1,
    claim TEXT, quote TEXT, lat REAL NOT NULL, lng REAL NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_sow_geo ON seed_oil_web(lat, lng)`,
  // Nominatim answers, kept so a place name is looked up once.
  `CREATE TABLE IF NOT EXISTS geocode_cache (key TEXT PRIMARY KEY, ts INTEGER NOT NULL, body TEXT NOT NULL)`,
  // One restaurant's tags from a Nominatim lookup, for places whose cached list copy has no hours.
  `CREATE TABLE IF NOT EXISTS osm_element_cache (id TEXT PRIMARY KEY, ts INTEGER NOT NULL, body TEXT NOT NULL)`,
  // When the last request to a rate-limited open service went out (one row per service).
  `CREATE TABLE IF NOT EXISTS discover_throttle (name TEXT PRIMARY KEY, ts INTEGER NOT NULL)`,
]

const ready = new WeakMap<object, Promise<void>>()

export function ensureDiscoverSchema(db: D1Like): Promise<void> {
  let p = ready.get(db)
  if (!p) {
    p = (async () => { for (const sql of DISCOVER_SCHEMA) await db.prepare(sql).run() })()
    p.catch(() => ready.delete(db))
    ready.set(db, p)
  }
  return p
}
