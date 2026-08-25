/**
 * A D1-compatible database over Node's built-in SQLite.
 *
 * The Worker code in `server/` is written against `env.DB` (Cloudflare D1). To
 * run that same code on a self-hosted Node process, the cheapest correct move is
 * to implement D1's small surface on top of `node:sqlite` rather than fork every
 * query. D1 *is* SQLite, so the semantics line up exactly.
 *
 * `node:sqlite` is built into modern Node, which means the container needs no
 * native module, no build toolchain and no `better-sqlite3` compile step.
 *
 * Only the parts of D1 this application actually uses are implemented, and
 * anything unimplemented throws loudly rather than silently misbehaving.
 */

import { DatabaseSync, type StatementSync } from 'node:sqlite';

export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: true;
  meta: { changes: number; last_row_id: number; duration: number };
}

export class NodeD1Statement {
  private args: unknown[] = [];

  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
  ) {}

  bind(...args: unknown[]): NodeD1Statement {
    // D1 returns a new bound statement; callers chain `.bind(...).run()`.
    const next = new NodeD1Statement(this.db, this.sql);
    next.args = args.map(normalise);
    return next;
  }

  private prepare(): StatementSync {
    return this.db.prepare(this.sql);
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = this.prepare().get(...(this.args as never[])) as Record<string, unknown> | undefined;
    if (!row) return null;
    if (column) return (row[column] ?? null) as T;
    return row as T;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const started = performance.now();
    const rows = this.prepare().all(...(this.args as never[])) as T[];
    return {
      results: rows,
      success: true,
      meta: { changes: 0, last_row_id: 0, duration: performance.now() - started },
    };
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const started = performance.now();
    const info = this.prepare().run(...(this.args as never[]));
    return {
      results: [],
      success: true,
      meta: {
        changes: Number(info.changes ?? 0),
        last_row_id: Number(info.lastInsertRowid ?? 0),
        duration: performance.now() - started,
      },
    };
  }
}

export class NodeD1Database {
  constructor(private readonly db: DatabaseSync) {}

  prepare(sql: string): NodeD1Statement {
    return new NodeD1Statement(this.db, sql);
  }

  async batch<T = Record<string, unknown>>(
    statements: NodeD1Statement[],
  ): Promise<D1Result<T>[]> {
    // D1 batches run in an implicit transaction; mirror that.
    this.db.exec('BEGIN');
    try {
      const out: D1Result<T>[] = [];
      for (const statement of statements) out.push(await statement.run<T>());
      this.db.exec('COMMIT');
      return out;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  async exec(sql: string): Promise<{ count: number; duration: number }> {
    const started = performance.now();
    this.db.exec(sql);
    return { count: 0, duration: performance.now() - started };
  }

  /** Escape hatch for the migration runner. */
  raw(): DatabaseSync {
    return this.db;
  }
}

/**
 * `node:sqlite` accepts only null, number, bigint, string and Uint8Array.
 * Booleans and undefined arrive from application code, so they are coerced here
 * — exactly as D1 does — instead of surfacing as a confusing type error.
 */
function normalise(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

export function openDatabase(path: string): NodeD1Database {
  const db = new DatabaseSync(path);
  // WAL keeps reads from blocking writes, which matters as soon as two people
  // are browsing at once.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA foreign_keys = ON');
  return new NodeD1Database(db);
}
