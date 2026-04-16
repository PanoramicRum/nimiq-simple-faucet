import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, eq, lt } from 'drizzle-orm';
import type { Db } from './db/index.js';
import { nonces } from './db/schema.js';

export interface IntegratorKey {
  id: string;
  key: string;
  secret: string;
}

export interface HmacHeaders {
  apiKey?: string | undefined;
  timestamp?: string | undefined;
  nonce?: string | undefined;
  signature?: string | undefined;
}

const MAX_SKEW_MS = 5 * 60 * 1000;

export function canonicalString(
  method: string,
  path: string,
  timestamp: string,
  nonce: string,
  body: string,
): string {
  return [method.toUpperCase(), path, timestamp, nonce, body].join('\n');
}

export function signRequest(secret: string, canonical: string): string {
  return createHmac('sha256', secret).update(canonical).digest('hex');
}

export async function verifyIntegratorRequest(opts: {
  db: Db;
  keys: IntegratorKey[];
  method: string;
  path: string;
  body: string;
  headers: HmacHeaders;
  now: number;
  /**
   * Optional DB-backed integrator lookup. Invoked when the env-configured
   * `keys` array does not contain a match for the presented api key. Return
   * `null` when no match exists. Implementations are expected to check
   * sha256(apiKey) against their own store and to ignore revoked rows.
   */
  lookupByKey?: ((apiKey: string) => Promise<IntegratorKey | null>) | undefined;
}): Promise<{ ok: true; integratorId: string } | { ok: false; reason: string }> {
  const { apiKey, timestamp, nonce, signature } = opts.headers;
  if (!apiKey || !timestamp || !nonce || !signature) {
    return { ok: false, reason: 'missing hmac headers' };
  }
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(opts.now - ts) > MAX_SKEW_MS) {
    return { ok: false, reason: 'timestamp outside 5-minute window' };
  }
  let entry: IntegratorKey | undefined | null = opts.keys.find((k) => k.key === apiKey);
  if (!entry && opts.lookupByKey) {
    entry = await opts.lookupByKey(apiKey);
  }
  if (!entry) return { ok: false, reason: 'unknown api key' };

  const expectedHex = signRequest(entry.secret, canonicalString(opts.method, opts.path, timestamp, nonce, opts.body));
  const a = Buffer.from(expectedHex, 'hex');
  const b = Buffer.from(signature, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad signature' };
  }

  // Garbage-collect expired nonces occasionally (lazy).
  await opts.db.delete(nonces).where(lt(nonces.expiresAt, new Date(opts.now)));

  const [existing] = await opts.db
    .select()
    .from(nonces)
    .where(and(eq(nonces.nonce, nonce), eq(nonces.integratorId, entry.id)))
    .limit(1);
  if (existing) return { ok: false, reason: 'nonce replayed' };

  await opts.db
    .insert(nonces)
    .values({ nonce, integratorId: entry.id, expiresAt: new Date(opts.now + MAX_SKEW_MS) });

  return { ok: true, integratorId: entry.id };
}
