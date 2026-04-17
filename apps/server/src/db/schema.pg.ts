/**
 * Postgres schema — mirrors schema.sqlite.ts with pgTable + Postgres types.
 *
 * Timestamps are stored as bigint (epoch ms) for application-layer parity
 * with SQLite, so no caller code needs to branch on timestamp handling.
 */
import { sql } from 'drizzle-orm';
import { bigint, integer, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';

const epochMs = sql`(extract(epoch from now()) * 1000)::bigint`;

export const claims = pgTable('claims', {
  id: text('id').primaryKey(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull().default(epochMs),
  address: text('address').notNull(),
  amountLuna: text('amount_luna').notNull(),
  status: text('status').notNull(),
  txId: text('tx_id'),
  ip: text('ip').notNull(),
  userAgent: text('user_agent'),
  integratorId: text('integrator_id'),
  abuseScore: integer('abuse_score').notNull().default(0),
  decision: text('decision').notNull(),
  signalsJson: text('signals_json').notNull().default('{}'),
  rejectionReason: text('rejection_reason'),
});

export const blocklist = pgTable('blocklist', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  value: text('value').notNull(),
  reason: text('reason'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull().default(epochMs),
  expiresAt: bigint('expires_at', { mode: 'number' }),
});

export const ipCounters = pgTable('ip_counters', {
  ip: text('ip').notNull(),
  day: text('day').notNull(),
  count: integer('count').notNull().default(0),
}, (table) => ({
  pk: primaryKey({ columns: [table.ip, table.day] }),
}));

export const nonces = pgTable('nonces', {
  nonce: text('nonce').primaryKey(),
  integratorId: text('integrator_id').notNull(),
  expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
});

export const fingerprintLinks = pgTable('fingerprint_links', {
  visitorId: text('visitor_id').notNull(),
  uid: text('uid'),
  cookieHash: text('cookie_hash'),
  seenAt: bigint('seen_at', { mode: 'number' }).notNull(),
});

export const adminUsers = pgTable('admin_users', {
  id: text('id').primaryKey(),
  passwordHash: text('password_hash').notNull(),
  passwordSalt: text('password_salt').notNull(),
  totpSecret: text('totp_secret'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull().default(epochMs),
});

export const adminSessions = pgTable('admin_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: text('user_id').notNull(),
  issuedAt: bigint('issued_at', { mode: 'number' }).notNull(),
  expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
  lastUsedAt: bigint('last_used_at', { mode: 'number' }).notNull(),
  totpStepUpAt: bigint('totp_step_up_at', { mode: 'number' }),
});

export const auditLog = pgTable('audit_log', {
  id: text('id').primaryKey(),
  ts: bigint('ts', { mode: 'number' }).notNull().default(epochMs),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  target: text('target'),
  signalsJson: text('signals_json').notNull().default('{}'),
});

export const runtimeConfig = pgTable('runtime_config', {
  key: text('key').primaryKey(),
  valueJson: text('value_json').notNull(),
});

export const integratorKeys = pgTable('integrator_keys', {
  id: text('id').primaryKey(),
  apiKeyHash: text('api_key_hash').notNull(),
  hmacSecret: text('hmac_secret').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull().default(epochMs),
  lastUsedAt: bigint('last_used_at', { mode: 'number' }),
  revokedAt: bigint('revoked_at', { mode: 'number' }),
});
