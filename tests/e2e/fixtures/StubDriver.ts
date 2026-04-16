import type { CurrencyDriver } from '@faucet/core';

const FAUCET_ADDR = 'NQ00 0000 0000 0000 0000 0000 0000 0000 0000';

interface HistorySummary {
  firstSeenAt: number | null;
  incomingCount: number;
  outgoingCount: number;
  totalReceived: bigint;
  totalSent: bigint;
  isSweeper: boolean;
}

/**
 * Stand-in `CurrencyDriver` for Playwright E2E: mirrors the pattern used in
 * `apps/server/test/claim.e2e.test.ts`. Every `send` succeeds immediately,
 * `waitForConfirmation` resolves right away, and `addressHistory` reports a
 * pristine (non-sweeper) summary so the abuse pipeline never flags on-chain.
 */
export class StubDriver implements CurrencyDriver {
  readonly id = 'nimiq';
  readonly networks = ['test'] as const;
  public sends: Array<{ to: string; amount: bigint; memo?: string }> = [];
  public balance = 10_000_000_000n;

  async init(): Promise<void> {}

  parseAddress(s: string): string {
    const normalized = s.trim().toUpperCase().replace(/\s+/g, ' ');
    if (!/^NQ[0-9]{2}(?: ?[0-9A-Z]{4}){8}$/.test(normalized)) {
      throw new Error(`bad address: ${s}`);
    }
    return normalized;
  }

  async getFaucetAddress(): Promise<string> {
    return FAUCET_ADDR;
  }

  async getBalance(): Promise<bigint> {
    return this.balance;
  }

  async send(to: string, amount: bigint, memo?: string): Promise<string> {
    const entry: { to: string; amount: bigint; memo?: string } = { to, amount };
    if (memo !== undefined) entry.memo = memo;
    this.sends.push(entry);
    this.balance -= amount;
    return `tx_e2e_${this.sends.length}_${Date.now().toString(36)}`;
  }

  async waitForConfirmation(): Promise<void> {
    // Resolves immediately — tests don't need real block confirmation.
  }

  async addressHistory(_address: string): Promise<HistorySummary> {
    return {
      firstSeenAt: null,
      incomingCount: 0,
      outgoingCount: 0,
      totalReceived: 0n,
      totalSent: 0n,
      isSweeper: false,
    };
  }
}
