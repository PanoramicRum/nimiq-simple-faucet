import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db/index.js';
import { claims } from '../db/schema.js';
import {
  countRepeatClaims,
  effectiveRepeatReductionPercent,
  isRepeatTierConfigured,
} from './repeatUser.js';

const NOW = 1_800_000_000_000; // fixed reference time (ms) so windows are deterministic
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

let tmp: string;
let db: Db;
let seq = 0;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'faucet-repeat-'));
  db = openDb({ dataDir: tmp });
  seq = 0;
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

async function insertClaim(row: {
  ip: string;
  address: string;
  ageMs: number; // created this long before NOW
  decision?: string;
  txId?: string | null;
  fingerprintVisitorId?: string | null;
}) {
  seq += 1;
  await db.insert(claims).values({
    id: `c${seq}`,
    address: row.address,
    amountLuna: '1000000',
    status: row.txId === null ? 'rejected' : 'broadcast',
    // txId defaults to a real id (paid); pass `null` explicitly for unpaid rows.
    txId: row.txId === undefined ? `tx${seq}` : row.txId,
    ip: row.ip,
    decision: row.decision ?? 'allow',
    createdAt: new Date(NOW - row.ageMs),
    fingerprintVisitorId: row.fingerprintVisitorId ?? null,
  });
}

const allDims = { useAddress: true, useIp: true, useFingerprint: true } as const;
const allWindows = { needDay: true, needWeek: true, needMonth: true } as const;

describe('countRepeatClaims', () => {
  it('counts only paid rows (decision=allow AND txId not null)', async () => {
    await insertClaim({ ip: 'IP1', address: 'A1', ageMs: HOUR }); // paid
    await insertClaim({ ip: 'IP1', address: 'A1', ageMs: HOUR, decision: 'deny', txId: null }); // denied
    await insertClaim({ ip: 'IP1', address: 'A1', ageMs: HOUR, decision: 'allow', txId: null }); // no tx
    const counts = await countRepeatClaims(db, {
      address: 'A1',
      ip: 'IP1',
      now: NOW,
      ...allDims,
      ...allWindows,
    });
    expect(counts).toEqual({ day: 1, week: 1, month: 1 });
  });

  it('counts within each rolling window (day/week/month) independently', async () => {
    await insertClaim({ ip: 'IP1', address: 'A1', ageMs: 2 * HOUR }); // day + week + month
    await insertClaim({ ip: 'IP1', address: 'A1', ageMs: 3 * DAY }); // week + month
    await insertClaim({ ip: 'IP1', address: 'A1', ageMs: 10 * DAY }); // month only
    await insertClaim({ ip: 'IP1', address: 'A1', ageMs: 40 * DAY }); // outside all windows
    const counts = await countRepeatClaims(db, {
      address: 'A1',
      ip: 'IP1',
      now: NOW,
      ...allDims,
      ...allWindows,
    });
    expect(counts).toEqual({ day: 1, week: 2, month: 3 });
  });

  it('unions the enabled identity dimensions (OR), so a different dimension can match', async () => {
    // A paid claim sharing only the IP (different address) than the query.
    await insertClaim({ ip: 'IP1', address: 'A-other', ageMs: HOUR });
    const ipOnly = await countRepeatClaims(db, {
      address: 'A1',
      ip: 'IP1',
      now: NOW,
      useAddress: false,
      useIp: true,
      useFingerprint: false,
      ...allWindows,
    });
    expect(ipOnly.day).toBe(1);
    const addrOnly = await countRepeatClaims(db, {
      address: 'A1',
      ip: 'IP1',
      now: NOW,
      useAddress: true,
      useIp: false,
      useFingerprint: false,
      ...allWindows,
    });
    expect(addrOnly.day).toBe(0);
  });

  it('uses the fingerprint dimension only when enabled and a visitorId is present', async () => {
    await insertClaim({ ip: 'IP-x', address: 'A-x', ageMs: HOUR, fingerprintVisitorId: 'V1' });
    const base = { address: 'A1', ip: 'IP1', now: NOW, ...allWindows } as const;
    expect(
      (
        await countRepeatClaims(db, {
          ...base,
          fingerprintVisitorId: 'V1',
          useAddress: false,
          useIp: false,
          useFingerprint: true,
        })
      ).day,
    ).toBe(1);
    // disabled
    expect(
      (
        await countRepeatClaims(db, {
          ...base,
          fingerprintVisitorId: 'V1',
          useAddress: false,
          useIp: false,
          useFingerprint: false,
        })
      ).day,
    ).toBe(0);
    // enabled but no visitorId on this claim → contributes nothing
    expect(
      (
        await countRepeatClaims(db, {
          ...base,
          useAddress: false,
          useIp: false,
          useFingerprint: true,
        })
      ).day,
    ).toBe(0);
  });

  it('returns all-zero when no dimension is enabled', async () => {
    await insertClaim({ ip: 'IP1', address: 'A1', ageMs: HOUR });
    const counts = await countRepeatClaims(db, {
      address: 'A1',
      ip: 'IP1',
      now: NOW,
      useAddress: false,
      useIp: false,
      useFingerprint: false,
      ...allWindows,
    });
    expect(counts).toEqual({ day: 0, week: 0, month: 0 });
  });

  it('queries only the requested windows (others return 0 without a query)', async () => {
    await insertClaim({ ip: 'IP1', address: 'A1', ageMs: HOUR });
    const counts = await countRepeatClaims(db, {
      address: 'A1',
      ip: 'IP1',
      now: NOW,
      ...allDims,
      needDay: true,
      needWeek: false,
      needMonth: false,
    });
    expect(counts).toEqual({ day: 1, week: 0, month: 0 });
  });
});

describe('effectiveRepeatReductionPercent', () => {
  const tiers = {
    repeatReductionDailyThreshold: 3,
    repeatReductionDailyPercent: 30,
    repeatReductionWeeklyThreshold: 10,
    repeatReductionWeeklyPercent: 50,
    repeatReductionMonthlyThreshold: 20,
    repeatReductionMonthlyPercent: 70,
  };

  it('returns 0 when no tier is triggered (sub-threshold)', () => {
    expect(effectiveRepeatReductionPercent({ day: 2, week: 5, month: 10 }, tiers)).toBe(0);
  });

  it('returns the triggered tier percent when one triggers', () => {
    expect(effectiveRepeatReductionPercent({ day: 3, week: 5, month: 10 }, tiers)).toBe(30);
  });

  it('largest tier wins when several trigger', () => {
    expect(effectiveRepeatReductionPercent({ day: 5, week: 12, month: 25 }, tiers)).toBe(70);
    expect(effectiveRepeatReductionPercent({ day: 5, week: 12, month: 10 }, tiers)).toBe(50);
  });

  it('a disabled tier (threshold 0 or percent 0) never triggers', () => {
    const disabled = {
      repeatReductionDailyThreshold: 0,
      repeatReductionDailyPercent: 90,
      repeatReductionWeeklyThreshold: 5,
      repeatReductionWeeklyPercent: 0,
    };
    expect(effectiveRepeatReductionPercent({ day: 100, week: 100, month: 0 }, disabled)).toBe(0);
  });
});

describe('isRepeatTierConfigured', () => {
  it('requires a threshold ≥ 1 and a percent > 0', () => {
    expect(isRepeatTierConfigured(3, 30)).toBe(true);
    expect(isRepeatTierConfigured(0, 30)).toBe(false);
    expect(isRepeatTierConfigured(3, 0)).toBe(false);
    expect(isRepeatTierConfigured(undefined, 30)).toBe(false);
    expect(isRepeatTierConfigured(3, undefined)).toBe(false);
  });
});
