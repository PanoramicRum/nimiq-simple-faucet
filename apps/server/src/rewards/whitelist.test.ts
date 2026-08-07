import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db/index.js';
import { rewardWhitelist } from '../db/schema.js';
import { findWhitelistMatch } from './whitelist.js';

let tmp: string;
let db: Db;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'faucet-whitelist-'));
  db = openDb({ dataDir: tmp });
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

let seq = 0;
async function insertEntry(row: {
  kind: 'address' | 'uid';
  value: string;
  integratorId?: string | null;
  bonusPercent?: number | null;
  exactAmountNim?: number | null;
}) {
  await db.insert(rewardWhitelist).values({
    id: `wl-${++seq}`,
    kind: row.kind,
    // Stored canonical, like the admin REST/MCP write paths do.
    value: row.value,
    integratorId: row.integratorId ?? null,
    bonusPercent: row.bonusPercent ?? null,
    exactAmountNim: row.exactAmountNim ?? null,
  });
}

describe('findWhitelistMatch', () => {
  it('returns null when nothing matches', async () => {
    await insertEntry({ kind: 'address', value: 'OTHER' });
    expect(await findWhitelistMatch(db, { address: 'A1' })).toBeNull();
  });

  it('matches an address entry regardless of case/spacing (canonical stored form)', async () => {
    // Write path stores the space-insensitive canonical form (uppercase, no
    // spaces); the lookup canonicalizes the same way.
    await insertEntry({ kind: 'address', value: 'NQ070000', bonusPercent: 25 });
    // Lowercase, extra spaces on the query — must still hit.
    expect(await findWhitelistMatch(db, { address: '  nq07  0000 ' })).toEqual({
      bonusPercent: 25,
      exactAmountNim: null,
    });
    // The unspaced query form also hits (no fail-open on spacing).
    expect(await findWhitelistMatch(db, { address: 'nq070000' })).toEqual({
      bonusPercent: 25,
      exactAmountNim: null,
    });
  });

  it('matches a uid entry only with BOTH a verified uid and the bound integrator', async () => {
    await insertEntry({ kind: 'uid', value: 'U1', integratorId: 'int-1', exactAmountNim: 42 });
    // No uid / no integrator context → no match.
    expect(await findWhitelistMatch(db, { address: 'A1' })).toBeNull();
    expect(await findWhitelistMatch(db, { address: 'A1', hostUid: 'U1' })).toBeNull();
    expect(await findWhitelistMatch(db, { address: 'A1', hostUid: 'U1', integratorId: null })).toBeNull();
    // A DIFFERENT integrator presenting the same uid → no match (binding).
    expect(
      await findWhitelistMatch(db, { address: 'A1', hostUid: 'U1', integratorId: 'int-2' }),
    ).toBeNull();
    // The bound integrator → match.
    expect(
      await findWhitelistMatch(db, { address: 'A1', hostUid: 'U1', integratorId: 'int-1' }),
    ).toEqual({ bonusPercent: null, exactAmountNim: 42 });
  });

  it('never matches a uid entry against the address dimension (or vice versa)', async () => {
    await insertEntry({ kind: 'uid', value: 'SAME', integratorId: 'int-1' });
    await insertEntry({ kind: 'address', value: 'OTHER' });
    // address=SAME only matches kind='address' entries.
    expect(await findWhitelistMatch(db, { address: 'same', integratorId: 'int-1' })).toBeNull();
  });

  it('exact-amount entries are an override class: any exact beats every percent', async () => {
    await insertEntry({ kind: 'address', value: 'A1', bonusPercent: 400 });
    await insertEntry({ kind: 'uid', value: 'U1', integratorId: 'int-1', exactAmountNim: 5 });
    expect(
      await findWhitelistMatch(db, { address: 'a1', hostUid: 'U1', integratorId: 'int-1' }),
    ).toEqual({ bonusPercent: null, exactAmountNim: 5 });
  });

  it('within the percent class, the largest REALIZED percent wins (global default counts)', async () => {
    // Regression: a percent-less entry realizes the global default, which can
    // exceed another entry's explicit percent — it must not lose to it.
    await insertEntry({ kind: 'address', value: 'A1', bonusPercent: 15 });
    await insertEntry({ kind: 'uid', value: 'U1', integratorId: 'int-1' }); // percent-less
    expect(
      await findWhitelistMatch(db, {
        address: 'a1',
        hostUid: 'U1',
        integratorId: 'int-1',
        globalBonusPercent: 200,
      }),
    ).toEqual({ bonusPercent: null, exactAmountNim: null }); // realizes 200% > 15%

    // With a small global default, the explicit percent wins instead.
    expect(
      await findWhitelistMatch(db, {
        address: 'a1',
        hostUid: 'U1',
        integratorId: 'int-1',
        globalBonusPercent: 5,
      }),
    ).toEqual({ bonusPercent: 15, exactAmountNim: null });
  });

  it('with no global default, a percent-less entry realizes 0 and loses to any explicit percent', async () => {
    await insertEntry({ kind: 'address', value: 'A2' }); // percent-less
    await insertEntry({ kind: 'uid', value: 'U2', integratorId: 'int-1', bonusPercent: 15 });
    expect(
      await findWhitelistMatch(db, { address: 'a2', hostUid: 'U2', integratorId: 'int-1' }),
    ).toEqual({ bonusPercent: 15, exactAmountNim: null });
  });
});
