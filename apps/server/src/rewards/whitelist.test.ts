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
  bonusPercent?: number | null;
  exactAmountNim?: number | null;
}) {
  await db.insert(rewardWhitelist).values({
    id: `wl-${++seq}`,
    kind: row.kind,
    // Stored canonical, like the admin REST/MCP write paths do.
    value: row.value,
    bonusPercent: row.bonusPercent ?? null,
    exactAmountNim: row.exactAmountNim ?? null,
  });
}

describe('findWhitelistMatch', () => {
  it('returns null when nothing matches', async () => {
    await insertEntry({ kind: 'address', value: 'OTHER' });
    expect(await findWhitelistMatch(db, { address: 'A1' })).toBeNull();
  });

  it('matches an address entry, normalizing the queried address', async () => {
    await insertEntry({ kind: 'address', value: 'NQ07 0000', bonusPercent: 25 });
    // Lowercase, extra spaces — must still hit the canonical stored value.
    const m = await findWhitelistMatch(db, { address: '  nq07  0000 ' });
    expect(m).toEqual({ bonusPercent: 25, exactAmountNim: null });
  });

  it('matches a uid entry only when a (verified) hostUid is supplied', async () => {
    await insertEntry({ kind: 'uid', value: 'U1', exactAmountNim: 42 });
    expect(await findWhitelistMatch(db, { address: 'A1' })).toBeNull();
    expect(await findWhitelistMatch(db, { address: 'A1', hostUid: null })).toBeNull();
    expect(await findWhitelistMatch(db, { address: 'A1', hostUid: 'U1' })).toEqual({
      bonusPercent: null,
      exactAmountNim: 42,
    });
  });

  it('never matches a uid entry against the address dimension (or vice versa)', async () => {
    await insertEntry({ kind: 'uid', value: 'SAME' });
    await insertEntry({ kind: 'address', value: 'OTHER' });
    // address=SAME only matches kind='address' entries.
    expect(await findWhitelistMatch(db, { address: 'same' })).toBeNull();
  });

  it('most generous wins: an exact-amount entry beats a percent-only entry', async () => {
    await insertEntry({ kind: 'address', value: 'A1', bonusPercent: 400 });
    await insertEntry({ kind: 'uid', value: 'U1', exactAmountNim: 5 });
    expect(await findWhitelistMatch(db, { address: 'a1', hostUid: 'U1' })).toEqual({
      bonusPercent: null,
      exactAmountNim: 5,
    });
  });

  it('most generous wins: larger percent beats smaller, percent-less last', async () => {
    await insertEntry({ kind: 'address', value: 'A1', bonusPercent: 10 });
    await insertEntry({ kind: 'uid', value: 'U1', bonusPercent: 30 });
    expect(await findWhitelistMatch(db, { address: 'a1', hostUid: 'U1' })).toEqual({
      bonusPercent: 30,
      exactAmountNim: null,
    });

    await db.delete(rewardWhitelist);
    await insertEntry({ kind: 'address', value: 'A2' }); // percent-less
    await insertEntry({ kind: 'uid', value: 'U2', bonusPercent: 15 });
    expect(await findWhitelistMatch(db, { address: 'a2', hostUid: 'U2' })).toEqual({
      bonusPercent: 15,
      exactAmountNim: null,
    });
  });
});
