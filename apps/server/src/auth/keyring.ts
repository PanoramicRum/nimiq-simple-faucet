/**
 * Encrypt-at-rest for the faucet private key.
 *
 * Blob format: `v1.<saltHex>.<nonceHex>.<ciphertextHex>`
 *   salt:  16 bytes for the KDF
 *   nonce: 24 bytes for XChaCha20-Poly1305
 *   ct:    ciphertext||tag (tag is appended by the AEAD)
 *
 * KDF: argon2id via `@node-rs/argon2` when available; otherwise a scrypt
 * fallback (N=2^15, r=8, p=1). Both derive a 32-byte KEK.
 *
 * NOTHING in this file logs, stringifies, or returns a decrypted plaintext
 * key via errors. Errors use generic messages so they can't leak key bits.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, scrypt as _scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';

const scrypt = promisify(_scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options?: { N?: number; r?: number; p?: number; maxmem?: number },
) => Promise<Buffer>;

type Argon2Module = {
  hashRaw: (
    pw: string | Buffer,
    opts: { memoryCost: number; timeCost: number; parallelism: number; salt: Buffer; outputLen: number },
  ) => Promise<Buffer>;
};
let argon2Mod: Argon2Module | null | undefined;
async function tryLoadArgon2(): Promise<Argon2Module | null> {
  if (argon2Mod !== undefined) return argon2Mod;
  try {
    const specifier = '@node-rs/argon2';
    const dynImport = Function('s', 'return import(s)') as (s: string) => Promise<unknown>;
    const mod = (await dynImport(specifier)) as Argon2Module;
    argon2Mod = mod;
  } catch {
    argon2Mod = null;
  }
  return argon2Mod;
}

export interface DerivedKek {
  kek: Uint8Array;
  salt: string;
}

export async function deriveKek(passphrase: string, saltHex?: string): Promise<DerivedKek> {
  if (!passphrase || passphrase.length < 8) {
    throw new Error('keyring: passphrase too short');
  }
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : randomBytes(16);
  const a2 = await tryLoadArgon2();
  if (a2 && typeof a2.hashRaw === 'function') {
    const out = await a2.hashRaw(passphrase, {
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
      salt,
      outputLen: 32,
    });
    return { kek: new Uint8Array(out), salt: salt.toString('hex') };
  }
  // Fallback: scrypt N=2^15, r=8, p=1 → 32 bytes.
  const out = await scrypt(passphrase, salt, 32, {
    N: 1 << 15,
    r: 8,
    p: 1,
    maxmem: 128 * (1 << 15) * 8 * 2,
  });
  return { kek: new Uint8Array(out), salt: salt.toString('hex') };
}

function hex(b: Uint8Array): string {
  return Buffer.from(b).toString('hex');
}
function unhex(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, 'hex'));
}

export async function encryptPrivateKey(plaintext: string, passphrase: string): Promise<string> {
  const { kek, salt } = await deriveKek(passphrase);
  const nonce = randomBytes(24);
  const cipher = xchacha20poly1305(kek, new Uint8Array(nonce));
  const pt = new TextEncoder().encode(plaintext);
  const ct = cipher.encrypt(pt);
  return `v1.${salt}.${nonce.toString('hex')}.${hex(ct)}`;
}

export async function decryptPrivateKey(blob: string, passphrase: string): Promise<string> {
  const parts = blob.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('keyring: bad blob format');
  }
  const [, saltHex, nonceHex, ctHex] = parts as [string, string, string, string];
  const { kek } = await deriveKek(passphrase, saltHex);
  try {
    const cipher = xchacha20poly1305(kek, unhex(nonceHex));
    const pt = cipher.decrypt(unhex(ctHex));
    return new TextDecoder().decode(pt);
  } catch {
    // Generic error — never echo inputs, which could include partial plaintext.
    throw new Error('keyring: decryption failed');
  }
}

/**
 * Read `<path>`, decrypt, and return the plaintext key. If the file is
 * missing, mint a fresh key via `generatorFn`, encrypt, and write it.
 * Never logs, never returns plaintext in errors.
 */
export async function loadOrInitKeyring(
  path: string,
  passphrase: string,
  generatorFn: () => string,
): Promise<string> {
  if (existsSync(path)) {
    const blob = readFileSync(path, 'utf8').trim();
    return decryptPrivateKey(blob, passphrase);
  }
  const plaintext = generatorFn();
  const blob = await encryptPrivateKey(plaintext, passphrase);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, blob, { mode: 0o600, encoding: 'utf8' });
  return plaintext;
}

/** Overwrite the keyring with a freshly-encrypted blob. */
export async function writeKeyring(path: string, plaintext: string, passphrase: string): Promise<void> {
  const blob = await encryptPrivateKey(plaintext, passphrase);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, blob, { mode: 0o600, encoding: 'utf8' });
}
