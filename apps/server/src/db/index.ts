import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import * as sqliteSchema from './schema.sqlite.js';
import * as pgSchema from './schema.pg.js';
import { migrationStatements, sqliteExtraMigrations } from './migrations.js';

// Re-export the SQLite schema as the canonical schema — callers that
// import table references directly (tests, admin-cli) use SQLite.
export * as schema from './schema.js';

/**
 * Db type — typed as the SQLite Drizzle instance (which is what tests
 * and most development use). The Postgres path casts to this type at
 * runtime; both dialects expose structurally identical query builder
 * APIs so the cast is safe.
 */
export type Db = ReturnType<typeof drizzleSqlite<typeof sqliteSchema>>;

export interface OpenDbOptions {
  dataDir: string;
  databaseUrl?: string | undefined;
}

function isPostgres(url: string | undefined): boolean {
  return !!url && (url.startsWith('postgres://') || url.startsWith('postgresql://'));
}

export function openDb({ dataDir, databaseUrl }: OpenDbOptions): Db {
  if (isPostgres(databaseUrl)) {
    const pool = new pg.Pool({ connectionString: databaseUrl });
    const pgDb = drizzlePg(pool, { schema: pgSchema });
    runMigrations(pgDb, 'pg');
    return pgDb as unknown as Db;
  }

  // Default: SQLite
  const filePath =
    databaseUrl?.replace(/^sqlite:\/\/\/?/, '').replace(/^file:/, '') ??
    join(dataDir, 'faucet.db');
  mkdirSync(dirname(filePath), { recursive: true });
  const sqlite = new Database(filePath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzleSqlite(sqlite, { schema: sqliteSchema });
  runMigrations(db, 'sqlite');
  return db;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function runMigrations(db: any, dialect: 'sqlite' | 'pg'): void {
  const exec = dialect === 'sqlite'
    ? (s: string) => db.run(sql.raw(s))
    : (s: string) => db.execute(sql.raw(s));

  // SQLite-specific pre-migrations (e.g. DROP TABLE for PK changes).
  if (dialect === 'sqlite') {
    for (const stmt of sqliteExtraMigrations()) {
      try { exec(stmt); } catch { /* best-effort */ }
    }
    // v1.7.0: idempotency key column migration (ALTER TABLE).
    try { exec('ALTER TABLE claims ADD COLUMN idempotency_key TEXT'); } catch { /* already exists */ }
  }
  if (dialect === 'pg') {
    // Postgres supports IF NOT EXISTS on ALTER TABLE.
    try { exec('ALTER TABLE claims ADD COLUMN IF NOT EXISTS idempotency_key TEXT'); } catch { /* */ }
  }

  // Shared CREATE TABLE + CREATE INDEX statements.
  for (const stmt of migrationStatements(dialect)) {
    try { exec(stmt); } catch { /* IF NOT EXISTS handles most; catch others */ }
  }
}
