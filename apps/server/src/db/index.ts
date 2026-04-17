import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import * as sqliteSchema from './schema.sqlite.js';
import * as pgSchema from './schema.pg.js';

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
    migratePg(pgDb);
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
  migrateSqlite(db);
  return db;
}

// ---------------------------------------------------------------------------
// SQLite migrations (existing, unchanged)
// ---------------------------------------------------------------------------

function migrateSqlite(db: Db): void {
  db.run(sql`CREATE TABLE IF NOT EXISTS claims (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    address TEXT NOT NULL,
    amount_luna TEXT NOT NULL,
    status TEXT NOT NULL,
    tx_id TEXT,
    ip TEXT NOT NULL,
    user_agent TEXT,
    integrator_id TEXT,
    abuse_score INTEGER NOT NULL DEFAULT 0,
    decision TEXT NOT NULL,
    signals_json TEXT NOT NULL DEFAULT '{}',
    rejection_reason TEXT
  )`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_claims_created_at ON claims(created_at DESC)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_claims_address ON claims(address)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_claims_ip ON claims(ip)`);
  // v1.7.0: idempotency key column + unique partial index
  try { db.run(sql`ALTER TABLE claims ADD COLUMN idempotency_key TEXT`); } catch { /* column already exists */ }
  db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_claims_idempotency ON claims(idempotency_key) WHERE idempotency_key IS NOT NULL`);

  db.run(sql`CREATE TABLE IF NOT EXISTS blocklist (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    value TEXT NOT NULL,
    reason TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    expires_at INTEGER
  )`);
  db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_blocklist_kv ON blocklist(kind, value)`);

  db.run(sql`DROP TABLE IF EXISTS ip_counters`);
  db.run(sql`CREATE TABLE ip_counters (
    ip TEXT NOT NULL,
    day TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (ip, day)
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS nonces (
    nonce TEXT PRIMARY KEY,
    integrator_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_nonces_expires ON nonces(expires_at)`);

  db.run(sql`CREATE TABLE IF NOT EXISTS fingerprint_links (
    visitor_id TEXT NOT NULL,
    uid TEXT,
    cookie_hash TEXT,
    seen_at INTEGER NOT NULL,
    PRIMARY KEY (visitor_id, uid, cookie_hash)
  )`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_fp_uid_seen ON fingerprint_links (uid, seen_at)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_fp_visitor_seen ON fingerprint_links (visitor_id, seen_at)`);

  db.run(sql`CREATE TABLE IF NOT EXISTS admin_users (
    id TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    totp_secret TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    issued_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    last_used_at INTEGER NOT NULL,
    totp_step_up_at INTEGER
  )`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_admin_sessions_user ON admin_sessions(user_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expires_at)`);

  db.run(sql`CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    ts INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT,
    signals_json TEXT NOT NULL DEFAULT '{}'
  )`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_audit_log_ts ON audit_log(ts DESC)`);

  db.run(sql`CREATE TABLE IF NOT EXISTS runtime_config (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS integrator_keys (
    id TEXT PRIMARY KEY,
    api_key_hash TEXT NOT NULL,
    hmac_secret TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    last_used_at INTEGER,
    revoked_at INTEGER
  )`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_integrator_keys_hash ON integrator_keys(api_key_hash)`);
}

// ---------------------------------------------------------------------------
// Postgres migrations
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function migratePg(db: any): void {
  const epochMs = `(extract(epoch from now()) * 1000)::bigint`;

  db.execute(sql`CREATE TABLE IF NOT EXISTS claims (
    id TEXT PRIMARY KEY,
    created_at BIGINT NOT NULL DEFAULT ${sql.raw(epochMs)},
    address TEXT NOT NULL,
    amount_luna TEXT NOT NULL,
    status TEXT NOT NULL,
    tx_id TEXT,
    ip TEXT NOT NULL,
    user_agent TEXT,
    integrator_id TEXT,
    abuse_score INTEGER NOT NULL DEFAULT 0,
    decision TEXT NOT NULL,
    signals_json TEXT NOT NULL DEFAULT '{}',
    rejection_reason TEXT
  )`);
  db.execute(sql`CREATE INDEX IF NOT EXISTS idx_claims_created_at ON claims(created_at DESC)`);
  db.execute(sql`CREATE INDEX IF NOT EXISTS idx_claims_address ON claims(address)`);
  db.execute(sql`CREATE INDEX IF NOT EXISTS idx_claims_ip ON claims(ip)`);
  db.execute(sql`ALTER TABLE claims ADD COLUMN IF NOT EXISTS idempotency_key TEXT`);
  db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_claims_idempotency ON claims(idempotency_key) WHERE idempotency_key IS NOT NULL`);

  db.execute(sql`CREATE TABLE IF NOT EXISTS blocklist (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    value TEXT NOT NULL,
    reason TEXT,
    created_at BIGINT NOT NULL DEFAULT ${sql.raw(epochMs)},
    expires_at BIGINT
  )`);
  db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_blocklist_kv ON blocklist(kind, value)`);

  db.execute(sql`CREATE TABLE IF NOT EXISTS ip_counters (
    ip TEXT NOT NULL,
    day TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (ip, day)
  )`);

  db.execute(sql`CREATE TABLE IF NOT EXISTS nonces (
    nonce TEXT PRIMARY KEY,
    integrator_id TEXT NOT NULL,
    expires_at BIGINT NOT NULL
  )`);
  db.execute(sql`CREATE INDEX IF NOT EXISTS idx_nonces_expires ON nonces(expires_at)`);

  db.execute(sql`CREATE TABLE IF NOT EXISTS fingerprint_links (
    visitor_id TEXT NOT NULL,
    uid TEXT,
    cookie_hash TEXT,
    seen_at BIGINT NOT NULL,
    PRIMARY KEY (visitor_id, uid, cookie_hash)
  )`);
  db.execute(sql`CREATE INDEX IF NOT EXISTS idx_fp_uid_seen ON fingerprint_links (uid, seen_at)`);
  db.execute(sql`CREATE INDEX IF NOT EXISTS idx_fp_visitor_seen ON fingerprint_links (visitor_id, seen_at)`);

  db.execute(sql`CREATE TABLE IF NOT EXISTS admin_users (
    id TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    totp_secret TEXT,
    created_at BIGINT NOT NULL DEFAULT ${sql.raw(epochMs)}
  )`);

  db.execute(sql`CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    issued_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL,
    last_used_at BIGINT NOT NULL,
    totp_step_up_at BIGINT
  )`);
  db.execute(sql`CREATE INDEX IF NOT EXISTS idx_admin_sessions_user ON admin_sessions(user_id)`);
  db.execute(sql`CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expires_at)`);

  db.execute(sql`CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    ts BIGINT NOT NULL DEFAULT ${sql.raw(epochMs)},
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT,
    signals_json TEXT NOT NULL DEFAULT '{}'
  )`);
  db.execute(sql`CREATE INDEX IF NOT EXISTS idx_audit_log_ts ON audit_log(ts DESC)`);

  db.execute(sql`CREATE TABLE IF NOT EXISTS runtime_config (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL
  )`);

  db.execute(sql`CREATE TABLE IF NOT EXISTS integrator_keys (
    id TEXT PRIMARY KEY,
    api_key_hash TEXT NOT NULL,
    hmac_secret TEXT NOT NULL,
    created_at BIGINT NOT NULL DEFAULT ${sql.raw(epochMs)},
    last_used_at BIGINT,
    revoked_at BIGINT
  )`);
  db.execute(sql`CREATE INDEX IF NOT EXISTS idx_integrator_keys_hash ON integrator_keys(api_key_hash)`);
}
