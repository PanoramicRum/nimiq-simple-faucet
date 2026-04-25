import { and, eq, gte, sql } from 'drizzle-orm';
import type { FingerprintLink, FingerprintStore } from '@faucet/abuse-fingerprint';
import type { Db } from '../db/index.js';
import { fingerprintLinks } from '../db/schema.js';

export class DrizzleFingerprintStore implements FingerprintStore {
  constructor(private readonly db: Db) {}

  async record(link: FingerprintLink): Promise<void> {
    await this.db
      .insert(fingerprintLinks)
      .values({
        visitorId: link.visitorId,
        uid: link.uid,
        cookieHash: link.cookieHash,
        seenAt: link.seenAt,
      })
      .onConflictDoUpdate({
        target: [fingerprintLinks.visitorId, fingerprintLinks.uid, fingerprintLinks.cookieHash],
        set: { seenAt: link.seenAt },
      });
  }

  async countVisitorsForUid(uid: string, windowMs: number): Promise<number> {
    const since = Date.now() - windowMs;
    const [row] = await this.db
      .select({ n: sql<number>`COUNT(DISTINCT ${fingerprintLinks.visitorId})` })
      .from(fingerprintLinks)
      .where(and(eq(fingerprintLinks.uid, uid), gte(fingerprintLinks.seenAt, since)));
    return row?.n ?? 0;
  }

  async countUidsForVisitor(visitorId: string, windowMs: number): Promise<number> {
    const since = Date.now() - windowMs;
    // #105: SQL's `COUNT(DISTINCT col)` ignores NULLs by definition, so a
    // pool of purely-anonymous claims (uid IS NULL) under the same
    // visitor wouldn't trip `maxUidsPerVisitor` at all. Coalesce nulls
    // to one synthetic '__anon__' bucket so any anonymous traffic under
    // a visitor counts as one extra distinct identity.
    const [row] = await this.db
      .select({ n: sql<number>`COUNT(DISTINCT COALESCE(${fingerprintLinks.uid}, '__anon__'))` })
      .from(fingerprintLinks)
      .where(and(eq(fingerprintLinks.visitorId, visitorId), gte(fingerprintLinks.seenAt, since)));
    return row?.n ?? 0;
  }
}
