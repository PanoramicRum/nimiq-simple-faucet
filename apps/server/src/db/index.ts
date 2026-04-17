import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { sql } from 'drizzle-orm';
import * as schema from './schema.js';

export type Db = ReturnType<typeof drizzle<typeof schema>>;

export interface OpenDbOptions {
  dataDir: string;
  databaseUrl?: string | undefined;
}

export function openDb({ dataDir, databaseUrl }: OpenDbOptions): Db {
  if (databaseUrl && !databaseUrl.startsWith('sqlite:') && !databaseUrl.startsWith('file:')) {
    // Server-side Postgres support is on the roadmap (ROADMAP.md 1.3.x —
    // "Server-side Postgres storage backend"). For now only SQLite is wired.
    throw new Error(
      `Postgres support is planned — see ROADMAP.md. For now, unset DATABASE_URL (server uses SQLite at ${dataDir}/faucet.db) or set DATABASE_URL=sqlite:///data/faucet.db explicitly. Got: ${databaseUrl}`,
    );
  }
  const filePath =
    databaseUrl?.replace(/^sqlite:\/\/\/?/, '').replace(/^file:/, '') ??
    join(dataDir, 'faucet.db');
  mkdirSync(dirname(filePath), { recursive: true });
  const sqlite = new Database(filePath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db);
  return db;
}

function migrate(db: Db): void {
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

  db.run(sql`CREATE TABLE IF NOT EXISTS blocklist (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    value TEXT NOT NULL,
    reason TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    expires_at INTEGER
  )`);
  db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_blocklist_kv ON blocklist(kind, value)`);

  // Migration: ip_counters PK changed from (ip) to (ip, day) in v1.2.2.
  // SQLite can't ALTER a PK; drop and recreate. Rate-limit counters are
  // ephemeral per-day data — losing them on upgrade is acceptable.
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

export { schema };
