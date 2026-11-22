/** A tiny D1 stand-in over node:sqlite, so handlers run against real SQL in tests. */
import { DatabaseSync } from 'node:sqlite'
import type { D1Like } from '../src/d1-adapter.js'

export function memoryD1(): D1Like & { raw: DatabaseSync } {
  const db = new DatabaseSync(':memory:')
  const stmt = (sql: string, params: unknown[] = []) => {
    const conv = () => params.map((p) => (typeof p === 'boolean' ? (p ? 1 : 0) : p instanceof ArrayBuffer ? new Uint8Array(p) : p === undefined ? null : p)) as Array<string | number | null>
    const self = {
      sql,
      bind: (...v: unknown[]) => stmt(sql, v),
      all: async <T>() => ({ results: db.prepare(sql).all(...conv()) as T[], meta: {} }),
      first: async <T>() => (db.prepare(sql).get(...conv()) as T | undefined) ?? null,
      run: async () => {
        const r = db.prepare(sql).run(...conv())
        return { results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }
      },
    }
    return self
  }
  return {
    raw: db,
    prepare: (sql: string) => stmt(sql),
    exec: async (sql: string) => db.exec(sql),
    // Like D1: a batch returns one result per statement, rows included for reads.
    batch: async (stmts: Array<{ run: () => Promise<unknown>; all: () => Promise<unknown>; sql: string }>) => {
      const out = []
      for (const s of stmts) out.push(/^\s*(select|with)\b/i.test(s.sql) ? await s.all() : await s.run())
      return out
    },
  } as unknown as D1Like & { raw: DatabaseSync }
}
