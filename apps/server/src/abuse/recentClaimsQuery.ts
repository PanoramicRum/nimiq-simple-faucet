import { and, eq, gte, sql } from 'drizzle-orm';
import type { RecentClaimsQuery } from '@faucet/abuse-ai';
import type { Db } from '../db/index.js';
import { claims } from '../db/schema.js';

export class DrizzleRecentClaimsQuery implements RecentClaimsQuery {
  constructor(private readonly db: Db) {}

  async byIp(ip: string, windowMs: number): Promise<number> {
    return this.#count(eq(claims.ip, ip), windowMs);
  }

  async byAddress(address: string, windowMs: number): Promise<number> {
    return this.#count(eq(claims.address, address), windowMs);
  }

  async byUid(uid: string, windowMs: number): Promise<number> {
    return this.#count(eq(claims.integratorId, uid), windowMs);
  }

  async #count(
    predicate: ReturnType<typeof eq>,
    windowMs: number,
  ): Promise<number> {
    const since = new Date(Date.now() - windowMs);
    const [row] = await this.db
      .select({ n: sql<number>`COUNT(*)` })
      .from(claims)
      .where(and(predicate, gte(claims.createdAt, since)));
    return row?.n ?? 0;
  }
}
