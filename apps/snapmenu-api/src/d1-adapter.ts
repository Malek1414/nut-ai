import type { DbAdapter, RunResult, SqlValue } from '@nutai/db-adapter'

/**
 * A third DbAdapter implementation, for Cloudflare D1 (SQLite with FTS5).
 *
 * Lives in the Worker app, not in packages/db-adapter, for the same reason the
 * expo adapter lives in apps/mobile: packages/* stay free of platform bindings.
 * The resolver's FTS5 + bm25 SQL runs on it unchanged.
 */

// Minimal structural types so this file needs no @cloudflare/workers-types import.
interface D1Result<T> { results: T[]; meta: { changes?: number; last_row_id?: number } }
interface D1Stmt {
  bind(...v: unknown[]): D1Stmt
  all<T>(): Promise<D1Result<T>>
  first<T>(): Promise<T | null>
  run(): Promise<D1Result<unknown>>
}
export interface D1Like {
  prepare(sql: string): D1Stmt
  exec(sql: string): Promise<unknown>
  batch(stmts: D1Stmt[]): Promise<unknown>
}

const conv = (params: readonly SqlValue[]) =>
  params.map((p) => (typeof p === 'bigint' ? Number(p) : p))

export class D1DbAdapter implements DbAdapter {
  constructor(private readonly db: D1Like) {}

  async all<T = Record<string, SqlValue>>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
    const r = await this.db.prepare(sql).bind(...conv(params)).all<T>()
    return r.results ?? []
  }

  async get<T = Record<string, SqlValue>>(sql: string, params: readonly SqlValue[] = []): Promise<T | null> {
    return (await this.db.prepare(sql).bind(...conv(params)).first<T>()) ?? null
  }

  async run(sql: string, params: readonly SqlValue[] = []): Promise<RunResult> {
    const r = await this.db.prepare(sql).bind(...conv(params)).run()
    return { changes: r.meta.changes ?? 0, lastInsertRowId: r.meta.last_row_id ?? 0 }
  }

  async exec(sql: string): Promise<void> {
    await this.db.exec(sql)
  }

  /** D1 has no interactive transactions; the menu path only reads. */
  async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
    return fn(this)
  }

  async close(): Promise<void> {}
}
