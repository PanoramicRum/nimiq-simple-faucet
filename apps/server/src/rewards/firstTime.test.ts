import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db/index.js';
import { claims } from '../db/schema.js';
import { isFirstTimeClaimant } from './firstTime.js';

let tmp: string;
let db: Db;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'faucet-firsttime-'));
  db = openDb({ dataDir: tmp });
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

async function insertClaim(row: {
  id: string;
  ip: string;
  address: string;
  decision: string;
  txId: string | null;
  fingerprintVisitorId?: string | null;
  hostUid?: string | null;
}) {
  await db.insert(claims).values({
    id: row.id,
    address: row.address,
    amountLuna: '1000000',
    status: row.txId ? 'broadcast' : 'rejected',
    txId: row.txId,
    ip: row.ip,
    decision: row.decision,
    fingerprintVisitorId: row.fingerprintVisitorId ?? null,
    hostUid: row.hostUid ?? null,
  });
}

const base = { useFingerprint: false, useUid: false } as const;

describe('isFirstTimeClaimant', () => {
  it('is true when there is no prior paid claim on any dimension', async () => {
    expect(await isFirstTimeClaimant(db, { ip: 'IP1', address: 'A1', ...base })).toBe(true);
  });

  it('is false when a prior PAID claim shares the IP or the address', async () => {
    await insertClaim({ id: '1', ip: 'IP1', address: 'A1', decision: 'allow', txId: 'tx1' });
    expect(await isFirstTimeClaimant(db, { ip: 'IP1', address: 'A-new', ...base })).toBe(false); // IP match
    expect(await isFirstTimeClaimant(db, { ip: 'IP-new', address: 'A1', ...base })).toBe(false); // address match
    expect(await isFirstTimeClaimant(db, { ip: 'IP-new', address: 'A-new', ...base })).toBe(true);
  });

  it('only counts PAID claims (decision=allow AND txId not null)', async () => {
    await insertClaim({ id: 'd', ip: 'IP2', address: 'A2', decision: 'deny', txId: null });
    await insertClaim({ id: 't', ip: 'IP3', address: 'A3', decision: 'allow', txId: null }); // timeout
    expect(await isFirstTimeClaimant(db, { ip: 'IP2', address: 'A2', ...base })).toBe(true);
    expect(await isFirstTimeClaimant(db, { ip: 'IP3', address: 'A3', ...base })).toBe(true);
  });

  it('uses the fingerprint dimension only when enabled', async () => {
    await insertClaim({ id: '1', ip: 'IP1', address: 'A1', decision: 'allow', txId: 'tx1', fingerprintVisitorId: 'V1' });
    const q = { ip: 'IP-new', address: 'A-new', fingerprintVisitorId: 'V1' };
    expect(await isFirstTimeClaimant(db, { ...q, useFingerprint: false, useUid: false })).toBe(true);
    expect(await isFirstTimeClaimant(db, { ...q, useFingerprint: true, useUid: false })).toBe(false);
  });

  it('uses the uid dimension only when enabled', async () => {
    await insertClaim({ id: '1', ip: 'IP1', address: 'A1', decision: 'allow', txId: 'tx1', hostUid: 'U1' });
    const q = { ip: 'IP-new', address: 'A-new', hostUid: 'U1' };
    expect(await isFirstTimeClaimant(db, { ...q, useFingerprint: false, useUid: false })).toBe(true);
    expect(await isFirstTimeClaimant(db, { ...q, useFingerprint: false, useUid: true })).toBe(false);
  });

  it('ignores a null/absent optional signal even when the dimension is enabled', async () => {
    await insertClaim({ id: '1', ip: 'IP1', address: 'A1', decision: 'allow', txId: 'tx1' });
    // No visitorId on the query → fingerprint dimension contributes nothing; falls back to IP/address.
    expect(
      await isFirstTimeClaimant(db, { ip: 'IP-new', address: 'A-new', useFingerprint: true, useUid: true }),
    ).toBe(true);
  });
});
