/**
 * Admin session + TOTP + password-hash helpers.
 *
 * Password hashing: we prefer argon2id via `@node-rs/argon2` (OWASP 2025
 * params: 19 MiB, 2 iterations, parallelism=1). That package is an optional
 * native dep — if it isn't installable we fall back to Node's built-in
 * `scrypt` (N=2^15, r=8, p=1), which gives comparable offline-cracking cost
 * without any native build. Either way, nothing in this file logs or returns
 * raw secrets, and every comparison is timing-safe.
 */
import {
  createHash,
  randomBytes,
  scrypt as _scrypt,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { and, eq, gt } from 'drizzle-orm';
import { authenticator } from '@otplib/preset-default';
import type { Db } from '../db/index.js';
import { adminSessions } from '../db/schema.js';

const scrypt = promisify(_scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options?: { N?: number; r?: number; p?: number; maxmem?: number },
) => Promise<Buffer>;

const SCRYPT_KEYLEN = 32;
const SCRYPT_N = 1 << 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 128 * SCRYPT_N * SCRYPT_R * 2; // ~64 MiB headroom

// Attempt to load @node-rs/argon2 once. If unavailable, we stay on scrypt.
type Argon2Module = {
  hash: (pw: string, opts: { memoryCost: number; timeCost: number; parallelism: number; salt: Buffer }) => Promise<string>;
  verify: (hash: string, pw: string) => Promise<boolean>;
};
let argon2Mod: Argon2Module | null | undefined;
async function tryLoadArgon2(): Promise<Argon2Module | null> {
  if (argon2Mod !== undefined) return argon2Mod;
  try {
    // Hide the specifier from TS static resolution so the fallback path still
    // type-checks when `@node-rs/argon2` isn't installed.
    const specifier = '@node-rs/argon2';
    const dynImport = Function('s', 'return import(s)') as (s: string) => Promise<unknown>;
    const mod = (await dynImport(specifier)) as Argon2Module;
    argon2Mod = mod;
  } catch {
    argon2Mod = null;
  }
  return argon2Mod;
}

export interface PasswordHashResult {
  hash: string;
  salt: string;
}

/**
 * Hash a password with argon2id (preferred) or scrypt fallback.
 * If `saltHex` is provided we use it verbatim; otherwise we generate 16 bytes.
 * The returned `hash` is an opaque string — either an argon2 encoded string
 * (starts with `$argon2id$`) or a hex scrypt digest.
 */
export async function hashPassword(
  pw: string,
  saltHex?: string,
): Promise<PasswordHashResult> {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : randomBytes(16);
  const a2 = await tryLoadArgon2();
  if (a2) {
    const hash = await a2.hash(pw, {
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
      salt,
    });
    return { hash, salt: salt.toString('hex') };
  }
  const derived = await scrypt(pw, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
  return { hash: `scrypt$${derived.toString('hex')}`, salt: salt.toString('hex') };
}

/** Timing-safe password verification for either backend. */
export async function verifyPassword(
  pw: string,
  hash: string,
  saltHex: string,
): Promise<boolean> {
  const a2 = await tryLoadArgon2();
  if (hash.startsWith('$argon2')) {
    if (!a2) return false;
    try {
      return await a2.verify(hash, pw);
    } catch {
      return false;
    }
  }
  if (!hash.startsWith('scrypt$')) return false;
  const expected = Buffer.from(hash.slice('scrypt$'.length), 'hex');
  const salt = Buffer.from(saltHex, 'hex');
  const derived = await scrypt(pw, salt, expected.length, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

// ---- TOTP ----

// Base32 RFC 4648 alphabet (no padding), used by otplib's default authenticator.
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Fresh 32-char (160-bit) base32 TOTP secret. */
export function totpSecret(): string {
  const raw = randomBytes(20);
  let bits = '';
  for (const b of raw) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < 32; i++) {
    const chunk = bits.slice(i * 5, i * 5 + 5);
    const idx = parseInt(chunk, 2);
    out += BASE32_ALPHABET[idx]!;
  }
  return out;
}

/** Standard otpauth:// URI for provisioning in authenticator apps. */
export function totpUri(secret: string, account: string, issuer = 'NimiqFaucet'): string {
  return authenticator.keyuri(account, issuer, secret);
}

/** Timing-safe TOTP code verification via otplib (accepts prev/next window). */
export function verifyTotp(secret: string, code: string): boolean {
  const normalized = code.replace(/\s+/g, '');
  if (!/^[0-9]{6,8}$/.test(normalized)) return false;
  try {
    return authenticator.check(normalized, secret);
  } catch {
    return false;
  }
}

// ---- Sessions ----

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export interface IssuedSession {
  token: string;
  expiresAt: Date;
}

export async function issueSession(
  db: Db,
  userId: string,
  ttlMs = 8 * 60 * 60_000,
): Promise<IssuedSession> {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = sha256Hex(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);
  await db.insert(adminSessions).values({
    tokenHash,
    userId,
    issuedAt: now,
    expiresAt,
    lastUsedAt: now,
  });
  return { token, expiresAt };
}

export interface ValidatedSession {
  userId: string;
  totpStepUpAt?: Date | undefined;
}

export async function validateSession(
  db: Db,
  token: string,
): Promise<ValidatedSession | null> {
  if (!token || typeof token !== 'string') return null;
  const tokenHash = sha256Hex(token);
  const now = new Date();
  const [row] = await db
    .select()
    .from(adminSessions)
    .where(and(eq(adminSessions.tokenHash, tokenHash), gt(adminSessions.expiresAt, now)))
    .limit(1);
  if (!row) return null;
  await db
    .update(adminSessions)
    .set({ lastUsedAt: now })
    .where(eq(adminSessions.tokenHash, tokenHash));
  return {
    userId: row.userId,
    totpStepUpAt: row.totpStepUpAt ?? undefined,
  };
}

export async function revokeSession(db: Db, token: string): Promise<void> {
  if (!token) return;
  const tokenHash = sha256Hex(token);
  await db.delete(adminSessions).where(eq(adminSessions.tokenHash, tokenHash));
}

export async function markSessionTotpStepUp(
  db: Db,
  token: string,
  at: Date = new Date(),
): Promise<void> {
  const tokenHash = sha256Hex(token);
  await db
    .update(adminSessions)
    .set({ totpStepUpAt: at })
    .where(eq(adminSessions.tokenHash, tokenHash));
}

export function sessionTokenHash(token: string): string {
  return sha256Hex(token);
}
