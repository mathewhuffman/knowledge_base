import fs from 'node:fs';
import path from 'node:path';
import BetterSqlite3, { type Database as BetterSqlite3Db } from 'better-sqlite3';
import { inspect } from 'node:util';

export interface SQLite {
  all<T>(sql: string, params?: Record<string, unknown>): T[];
  get<T>(sql: string, params?: Record<string, unknown>): T | undefined;
  run(sql: string, params?: Record<string, unknown>): { changes: number; lastInsertRowid: unknown };
  exec(sql: string): void;
  prepare(sql: string): { all: <T>(params?: Record<string, unknown>) => T[]; get: <T>(params?: Record<string, unknown>) => T | undefined; run: (params?: Record<string, unknown>) => { changes: number; lastInsertRowid: unknown } };
  close(): void;
}

export interface OpenOptions {
  dbPath: string;
}

function safePragma(db: BetterSqlite3Db, pragma: string) {
  try {
    db.pragma(pragma);
  } catch (error) {
    console.error('[sqlite-pragma]', {
      pragma,
      errorName: (error as { name?: string })?.name,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
      errorDetails: inspect(error, { depth: 3, compact: false })
    });
  }
}

export function openDatabase({ dbPath }: OpenOptions): SQLite {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  console.error('[sqlite-open] new BetterSqlite3 start', { dbPath });
  const db = new BetterSqlite3(dbPath);
  console.error('[sqlite-open] new BetterSqlite3 created', { dbPath, hasRun: true });
  safePragma(db, 'journal_mode = WAL');
  safePragma(db, 'foreign_keys = ON');
  console.error('[sqlite-open] better-sqlite3 init complete', { dbPath });
  return wrapDatabase(db);
}

function wrapDatabase(db: BetterSqlite3Db): SQLite {
  return {
    all<T>(sql: string, params: Record<string, unknown> = {}) {
      return db.prepare(sql).all(params) as T[];
    },
    get<T>(sql: string, params: Record<string, unknown> = {}) {
      return db.prepare(sql).get(params) as T | undefined;
    },
    run(sql: string, params: Record<string, unknown> = {}) {
      const result = db.prepare(sql).run(params);
      return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
    },
    exec(sql: string) {
      db.exec(sql);
    },
    prepare(sql: string) {
      const stmt = db.prepare(sql);
      return {
        all<T>(params: Record<string, unknown> = {}) {
          return stmt.all(params) as T[];
        },
        get<T>(params: Record<string, unknown> = {}) {
          return stmt.get(params) as T | undefined;
        },
        run(params: Record<string, unknown> = {}) {
          const result = stmt.run(params);
          return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
        }
      };
    },
    close() {
      db.close();
    }
  };
}
