/**
 * Unit tests for the Drizzle fingerprint store. Exercises the post-#105
 * COALESCE behaviour on `countUidsForVisitor` directly against a fresh
 * SQLite DB rather than going through the full claim route.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/db/index.js';
import { DrizzleFingerprintStore } from '../src/abuse/fingerprintStore.js';

describe('DrizzleFingerprintStore (#105)', () => {
  let tmp: string;
  let db: Db;
  let store: DrizzleFingerprintStore;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'faucet-fp-store-'));
    db = openDb({ dataDir: tmp });
    store = new DrizzleFingerprintStore(db);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('counts a pool of anonymous claims as one bucket (was zero pre-fix)', async () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      await store.record({
        visitorId: 'visitor-X',
        uid: null,
        cookieHash: `cookie-${i}`,
        seenAt: now,
      });
    }
    const n = await store.countUidsForVisitor('visitor-X', 60_000);
    // Pre-fix: 0 (NULLs ignored by COUNT(DISTINCT)).
    // Post-fix: 1 (all NULLs collapse into the '__anon__' synthetic bucket).
    expect(n).toBe(1);
  });

  it('counts mixed anonymous + named claims correctly', async () => {
    const now = Date.now();
    await store.record({ visitorId: 'visitor-Y', uid: null, cookieHash: 'c-a', seenAt: now });
    await store.record({ visitorId: 'visitor-Y', uid: null, cookieHash: 'c-b', seenAt: now });
    await store.record({ visitorId: 'visitor-Y', uid: 'real-uid-1', cookieHash: 'c-c', seenAt: now });
    await store.record({ visitorId: 'visitor-Y', uid: 'real-uid-2', cookieHash: 'c-d', seenAt: now });
    const n = await store.countUidsForVisitor('visitor-Y', 60_000);
    // 1 anon bucket + 2 distinct real uids = 3.
    expect(n).toBe(3);
  });

  it('counts two distinct named uids as two (regression: no double-counting)', async () => {
    const now = Date.now();
    await store.record({ visitorId: 'visitor-Z', uid: 'a', cookieHash: 'c-a', seenAt: now });
    await store.record({ visitorId: 'visitor-Z', uid: 'b', cookieHash: 'c-b', seenAt: now });
    const n = await store.countUidsForVisitor('visitor-Z', 60_000);
    expect(n).toBe(2);
  });

  it('respects the time window — old rows do not contribute', async () => {
    const now = Date.now();
    await store.record({ visitorId: 'visitor-W', uid: null, cookieHash: 'old', seenAt: now - 120_000 });
    await store.record({ visitorId: 'visitor-W', uid: 'fresh', cookieHash: 'new', seenAt: now });
    const n = await store.countUidsForVisitor('visitor-W', 60_000);
    // Only the fresh row falls inside the 60s window.
    expect(n).toBe(1);
  });
});
