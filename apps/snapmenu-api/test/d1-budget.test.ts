import { describe, expect, it, vi } from 'vitest'
import { memoryD1 } from './d1-shim.js'
import type { D1Like } from '../src/d1-adapter.js'
import { PLACES_SCHEMA } from '../src/places.js'
import { COMMUNITY_SCHEMA } from '../src/community-api.js'

async function setup(legacy = false) {
  vi.resetModules()
  const worker = (await import('../src/index.js')).default
  const db = memoryD1()
  db.raw.exec('CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, type TEXT NOT NULL, device TEXT, team INTEGER NOT NULL DEFAULT 0, props TEXT)')
  if (legacy) {
    const beforeVerification = (sql: string) => sql.replace(', osm_verified INTEGER NOT NULL DEFAULT 0', '')
    db.raw.exec(beforeVerification(COMMUNITY_SCHEMA[0]!).replace(', via TEXT', ''))
    db.raw.exec(beforeVerification(PLACES_SCHEMA.find(sql => sql.includes('CREATE TABLE IF NOT EXISTS place_dishes'))!))
  }
  let queries = 0, batching = false
  const wrap = (s: ReturnType<D1Like['prepare']>): ReturnType<D1Like['prepare']> => ({
    bind: (...values) => wrap(s.bind(...values)),
    all: async <T>() => { if (!batching) queries++; return s.all<T>() },
    first: async <T>() => { if (!batching) queries++; return s.first<T>() },
    run: async () => { if (!batching) queries++; return s.run() },
  })
  const DB: D1Like = { ...db, prepare: sql => wrap(db.prepare(sql)), batch: async statements => {
    queries++; batching = true
    try { return await db.batch(statements) } finally { batching = false }
  } }
  const call = async (path: string) => {
    queries = 0
    const res = await worker.fetch(new Request('http://x' + path), { DB })
    return { res, queries }
  }
  return { db, call }
}

describe('free-plan D1 request budgets', () => {
  it('keeps a cold numbers request under fifty calls and serves the cached answer without more reads', async () => {
    const { call } = await setup()
    const cold = await call('/api/numbers')
    expect(cold.res.status).toBe(200)
    expect(cold.queries).toBeLessThan(50)
    const warm = await call('/api/numbers')
    expect(warm.res.status).toBe(200)
    expect(warm.queries).toBe(0)
    console.log(`D1 numbers: cold ${cold.queries}, cached ${warm.queries} calls`)
  })

  it('upgrades a pre-via posts table before seeding and bounds feed queries across uncached restaurants', async () => {
    const { db, call } = await setup(true)
    expect((await call('/api/communities')).res.status).toBe(200)
    for (const table of ['posts', 'place_dishes']) {
      expect(db.raw.prepare(`SELECT name FROM pragma_table_info('${table}') WHERE name='osm_verified'`).get()).toBeDefined()
    }
    for (let i = 0; i < 40; i++) db.raw.prepare("INSERT INTO posts (id,ts,device,nickname,community,kind,title,place_id,place_name,place_lat,place_lng,hot) VALUES (?,?,'test','test','Mitte','text','Lunch at a place',?,'Place',?,?,?)").run(`budget-${i}`, Date.now(), `n9000${i}`, 52.4 + i * 0.011, 13.3 + i * 0.016, 1e9 + i)
    const feed = await call('/api/feed')
    expect(feed.res.status).toBe(200)
    expect(feed.queries).toBeLessThan(20)
    console.log(`D1 feed with forty uncached restaurants: ${feed.queries} calls`)
  })
})
