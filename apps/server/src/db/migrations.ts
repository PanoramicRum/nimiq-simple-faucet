/**
 * Shared migration statements for both SQLite and Postgres.
 *
 * Parameterized by dialect so the ~200 lines of near-identical CREATE
 * TABLE statements don't need to be maintained twice. The only
 * differences are timestamp column types (INTEGER vs BIGINT) and
 * default expressions (unixepoch vs extract(epoch)).
 */

export type Dialect = 'sqlite' | 'pg';

export function migrationStatements(dialect: Dialect): string[] {
  const ts = dialect === 'sqlite' ? 'INTEGER' : 'BIGINT';
  const tsDefault =
    dialect === 'sqlite'
      ? 'DEFAULT (unixepoch() * 1000)'
      : 'DEFAULT (extract(epoch from now()) * 1000)::bigint';

  return [
    // --- claims ---
    `CREATE TABLE IF NOT EXISTS claims (
      id TEXT PRIMARY KEY,
      created_at ${ts} NOT NULL ${tsDefault},
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
      rejection_reason TEXT,
      idempotency_key TEXT
    )`,
    'CREATE INDEX IF NOT EXISTS idx_claims_created_at ON claims(created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_claims_address ON claims(address)',
    'CREATE INDEX IF NOT EXISTS idx_claims_ip ON claims(ip)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_claims_idempotency ON claims(idempotency_key) WHERE idempotency_key IS NOT NULL',

    // --- blocklist ---
    `CREATE TABLE IF NOT EXISTS blocklist (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      value TEXT NOT NULL,
      reason TEXT,
      created_at ${ts} NOT NULL ${tsDefault},
      expires_at ${ts}
    )`,
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_blocklist_kv ON blocklist(kind, value)',

    // --- ip_counters ---
    `CREATE TABLE IF NOT EXISTS ip_counters (
      ip TEXT NOT NULL,
      day TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (ip, day)
    )`,

    // --- nonces ---
    `CREATE TABLE IF NOT EXISTS nonces (
      nonce TEXT PRIMARY KEY,
      integrator_id TEXT NOT NULL,
      expires_at ${ts} NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_nonces_expires ON nonces(expires_at)',

    // --- fingerprint_links ---
    `CREATE TABLE IF NOT EXISTS fingerprint_links (
      visitor_id TEXT NOT NULL,
      uid TEXT,
      cookie_hash TEXT,
      seen_at ${ts} NOT NULL,
      PRIMARY KEY (visitor_id, uid, cookie_hash)
    )`,
    'CREATE INDEX IF NOT EXISTS idx_fp_uid_seen ON fingerprint_links (uid, seen_at)',
    'CREATE INDEX IF NOT EXISTS idx_fp_visitor_seen ON fingerprint_links (visitor_id, seen_at)',

    // --- admin_users ---
    `CREATE TABLE IF NOT EXISTS admin_users (
      id TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      totp_secret TEXT,
      created_at ${ts} NOT NULL ${tsDefault}
    )`,

    // --- admin_sessions ---
    `CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      issued_at ${ts} NOT NULL,
      expires_at ${ts} NOT NULL,
      last_used_at ${ts} NOT NULL,
      totp_step_up_at ${ts}
    )`,
    'CREATE INDEX IF NOT EXISTS idx_admin_sessions_user ON admin_sessions(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expires_at)',

    // --- audit_log ---
    `CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      ts ${ts} NOT NULL ${tsDefault},
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT,
      signals_json TEXT NOT NULL DEFAULT '{}'
    )`,
    'CREATE INDEX IF NOT EXISTS idx_audit_log_ts ON audit_log(ts DESC)',

    // --- runtime_config ---
    `CREATE TABLE IF NOT EXISTS runtime_config (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL
    )`,

    // --- integrator_keys ---
    `CREATE TABLE IF NOT EXISTS integrator_keys (
      id TEXT PRIMARY KEY,
      api_key_hash TEXT NOT NULL,
      hmac_secret TEXT NOT NULL,
      created_at ${ts} NOT NULL ${tsDefault},
      last_used_at ${ts},
      revoked_at ${ts}
    )`,
    'CREATE INDEX IF NOT EXISTS idx_integrator_keys_hash ON integrator_keys(api_key_hash)',
  ];
}

/**
 * SQLite-specific migration steps that can't be parameterized:
 * - DROP + CREATE for ip_counters (PK migration from v1.2.2)
 * - ALTER TABLE for idempotency_key (v1.7.0 migration)
 */
export function sqliteExtraMigrations(): string[] {
  return [
    'DROP TABLE IF EXISTS ip_counters',
  ];
}
