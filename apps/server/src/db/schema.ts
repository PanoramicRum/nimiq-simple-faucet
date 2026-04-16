import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const claims = sqliteTable('claims', {
  id: text('id').primaryKey(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  address: text('address').notNull(),
  amountLuna: text('amount_luna').notNull(), // bigint as string
  status: text('status').notNull(),
  txId: text('tx_id'),
  ip: text('ip').notNull(),
  userAgent: text('user_agent'),
  integratorId: text('integrator_id'),
  abuseScore: integer('abuse_score').notNull().default(0), // score * 1000
  decision: text('decision').notNull(),
  signalsJson: text('signals_json').notNull().default('{}'),
  rejectionReason: text('rejection_reason'),
});

export const blocklist = sqliteTable('blocklist', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(), // ip | address | uid | asn | country
  value: text('value').notNull(),
  reason: text('reason'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
});

export const ipCounters = sqliteTable('ip_counters', {
  ip: text('ip').primaryKey(),
  day: text('day').notNull(), // YYYY-MM-DD in UTC
  count: integer('count').notNull().default(0),
});

export const nonces = sqliteTable('nonces', {
  nonce: text('nonce').primaryKey(),
  integratorId: text('integrator_id').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
});

export const fingerprintLinks = sqliteTable('fingerprint_links', {
  visitorId: text('visitor_id').notNull(),
  uid: text('uid'),
  cookieHash: text('cookie_hash'),
  seenAt: integer('seen_at').notNull(),
});

export const adminUsers = sqliteTable('admin_users', {
  id: text('id').primaryKey(),
  passwordHash: text('password_hash').notNull(),
  passwordSalt: text('password_salt').notNull(),
  totpSecret: text('totp_secret'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const adminSessions = sqliteTable('admin_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: text('user_id').notNull(),
  issuedAt: integer('issued_at', { mode: 'timestamp_ms' }).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }).notNull(),
  totpStepUpAt: integer('totp_step_up_at', { mode: 'timestamp_ms' }),
});

export const auditLog = sqliteTable('audit_log', {
  id: text('id').primaryKey(),
  ts: integer('ts', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  target: text('target'),
  signalsJson: text('signals_json').notNull().default('{}'),
});

export const runtimeConfig = sqliteTable('runtime_config', {
  key: text('key').primaryKey(),
  valueJson: text('value_json').notNull(),
});

export const integratorKeys = sqliteTable('integrator_keys', {
  id: text('id').primaryKey(),
  apiKeyHash: text('api_key_hash').notNull(),
  hmacSecret: text('hmac_secret').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
  revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
});
