import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AbuseCheck, CheckResult } from '@faucet/core';

/**
 * SHA-256 hashcash. A challenge `c` and a solution `s` are valid when
 * `SHA-256(c + ":" + s)` starts with `difficulty` zero bits.
 *
 * Server mints a challenge tied to the requesting IP + timestamp, signs it,
 * and hands it to the client. Client brute-forces a nonce. Server re-validates
 * signature, freshness, and leading-zero-bit count.
 */

export interface HashcashChallenge {
  challenge: string;
  difficulty: number;
  expiresAt: number;
}

export interface HashcashCheckConfig {
  /** Server-side HMAC-ish secret used to sign challenges. */
  secret: string;
  /** Leading zero bits required. 16 = ~65k hashes, 20 = ~1M, 24 = ~16M. */
  difficulty?: number;
  /** Challenge validity window in ms. */
  ttlMs?: number;
  /** Optional replay store (#95). Defaults to an in-memory TTL set per
   *  check instance. A Redis-backed store can be injected later when
   *  multi-replica deployments need shared state — same interface. */
  replayStore?: HashcashReplayStore;
}

/**
 * Replay-prevention contract for hashcash. The scheme is one-puzzle-one-
 * action; without this guard a valid (challenge, nonce) pair is reusable
 * for the entire challenge TTL (default 5 min), amortising one PoW across
 * many claims (#95). `markSeen` is check-and-set: returns `true` on first
 * sighting, `false` on replay.
 */
export interface HashcashReplayStore {
  markSeen(key: string, expiresAtMs: number, now?: number): boolean | Promise<boolean>;
}

/**
 * In-memory default. Adequate for single-instance deployments; resets on
 * restart (acceptable — challenge TTL is short and the worst-case
 * post-restart window is one TTL). Multi-replica setups should inject a
 * shared backend (e.g. Redis) when that ships; the interface is stable.
 */
export class MemoryHashcashReplayStore implements HashcashReplayStore {
  private readonly seen = new Map<string, number>();
  /** Cap so a flood of unique solutions can't grow the map unbounded.
   *  When the cap is reached, every expired entry is dropped first. */
  private readonly maxSize: number;

  constructor(maxSize = 4096) {
    this.maxSize = maxSize;
  }

  markSeen(key: string, expiresAtMs: number, now: number = Date.now()): boolean {
    if (this.seen.size >= this.maxSize) {
      for (const [k, exp] of this.seen) {
        if (exp <= now) this.seen.delete(k);
      }
    }
    const prior = this.seen.get(key);
    if (prior !== undefined && prior > now) return false;
    this.seen.set(key, expiresAtMs);
    return true;
  }
}

export interface MintChallengeInput {
  ip: string;
  uid?: string;
}

export function mintChallenge(config: HashcashCheckConfig, input: MintChallengeInput, now = Date.now()): HashcashChallenge {
  const difficulty = config.difficulty ?? 20;
  const ttl = config.ttlMs ?? 5 * 60_000;
  const nonce = randomBytes(12).toString('hex');
  const expiresAt = now + ttl;
  const payload = `${input.ip}|${input.uid ?? ''}|${expiresAt}|${difficulty}|${nonce}`;
  const tag = sha256Hex(`${config.secret}|${payload}`);
  return { challenge: `${payload}|${tag}`, difficulty, expiresAt };
}

function parseChallenge(challenge: string) {
  const parts = challenge.split('|');
  if (parts.length !== 6) return null;
  const [ip, uid, expiresAt, difficulty, nonce, tag] = parts;
  return {
    ip: ip ?? '',
    uid: uid ?? '',
    expiresAt: Number(expiresAt),
    difficulty: Number(difficulty),
    nonce: nonce ?? '',
    tag: tag ?? '',
  };
}

function leadingZeroBits(hexDigest: string): number {
  let bits = 0;
  for (const ch of hexDigest) {
    const v = parseInt(ch, 16);
    if (v === 0) {
      bits += 4;
      continue;
    }
    if (v < 2) return bits + 3;
    if (v < 4) return bits + 2;
    if (v < 8) return bits + 1;
    return bits;
  }
  return bits;
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function constantEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function hashcashCheck(config: HashcashCheckConfig): AbuseCheck {
  const replayStore = config.replayStore ?? new MemoryHashcashReplayStore();
  return {
    id: 'hashcash',
    description: 'SHA-256 hashcash client puzzle (anti-bot, not blockchain consensus)',
    weight: 2,
    async check(req): Promise<CheckResult> {
      if (!req.hashcashSolution) {
        return {
          score: 1,
          decision: 'challenge',
          reason: 'hashcash solution missing',
          signals: { provided: false },
        };
      }
      const [challenge, nonceSolution] = req.hashcashSolution.split('#');
      if (!challenge || !nonceSolution) {
        return { score: 1, decision: 'deny', reason: 'hashcash malformed', signals: {} };
      }
      const parsed = parseChallenge(challenge);
      if (!parsed) {
        return { score: 1, decision: 'deny', reason: 'hashcash challenge malformed', signals: {} };
      }
      if (parsed.expiresAt < req.requestedAt) {
        return { score: 1, decision: 'deny', reason: 'hashcash challenge expired', signals: {} };
      }
      if (parsed.ip !== req.ip) {
        return { score: 1, decision: 'deny', reason: 'hashcash ip mismatch', signals: {} };
      }
      const payload = `${parsed.ip}|${parsed.uid}|${parsed.expiresAt}|${parsed.difficulty}|${parsed.nonce}`;
      const expectedTag = sha256Hex(`${config.secret}|${payload}`);
      if (!constantEq(parsed.tag, expectedTag)) {
        return { score: 1, decision: 'deny', reason: 'hashcash tag invalid', signals: {} };
      }
      const digest = sha256Hex(`${challenge}:${nonceSolution}`);
      const zeros = leadingZeroBits(digest);
      if (zeros < parsed.difficulty) {
        return {
          score: 1,
          decision: 'deny',
          reason: `hashcash insufficient work (${zeros} < ${parsed.difficulty})`,
          signals: { zeros, difficulty: parsed.difficulty },
        };
      }
      // Replay-prevention (#95). All structural / cryptographic checks
      // have passed; only now consume cache space marking the solution
      // as seen. A second submission of the same valid (challenge, nonce)
      // pair within the TTL is rejected with `hashcash replayed`.
      const replayKey = `${sha256Hex(challenge).slice(0, 16)}:${nonceSolution}`;
      const fresh = await replayStore.markSeen(replayKey, parsed.expiresAt, req.requestedAt);
      if (!fresh) {
        return {
          score: 1,
          decision: 'deny',
          reason: 'hashcash replayed',
          signals: { replayed: true, zeros, difficulty: parsed.difficulty },
        };
      }
      return {
        score: 0,
        signals: { zeros, difficulty: parsed.difficulty },
      };
    },
  };
}

/** Browser / client helper: brute-force a solution. Exported for SDK use. */
export async function solveChallenge(
  challenge: string,
  difficulty: number,
  onProgress?: (attempts: number) => void,
): Promise<string> {
  let attempts = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const nonce = Math.random().toString(36).slice(2) + (attempts++).toString(36);
    const digest = sha256Hex(`${challenge}:${nonce}`);
    if (leadingZeroBits(digest) >= difficulty) return nonce;
    if (onProgress && attempts % 2048 === 0) onProgress(attempts);
  }
}
