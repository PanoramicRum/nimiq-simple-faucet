/**
 * Schema bridge — re-exports the SQLite schema as the default.
 *
 * Both schema.sqlite.ts and schema.pg.ts export identically-named table
 * objects with the same column names. The runtime `openDb()` factory picks
 * the right one; callers import table references from `ctx.tables` (set on
 * AppContext), not from this file directly.
 *
 * This file re-exports the SQLite schema so that existing test helpers and
 * the admin-cli (which always use SQLite) continue to work without changes.
 */
export {
  claims,
  blocklist,
  ipCounters,
  nonces,
  fingerprintLinks,
  adminUsers,
  adminSessions,
  auditLog,
  runtimeConfig,
  integratorKeys,
} from './schema.sqlite.js';
