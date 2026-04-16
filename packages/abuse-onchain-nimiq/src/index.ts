import type { AbuseCheck, CheckResult, CurrencyDriver } from '@faucet/core';

export interface OnchainCheckConfig {
  driver: CurrencyDriver;
  denyIfSweeper?: boolean | undefined;
  denyIfRecentDust?: boolean | undefined;
  softScoreFreshAddress?: boolean | undefined;
  freshAddressBoostScore?: number | undefined;
  claimHistorySourceAddresses?: readonly string[] | undefined;
  weight?: number | undefined;
}

export function onchainNimiqCheck(config: OnchainCheckConfig): AbuseCheck {
  const denyIfSweeper = config.denyIfSweeper ?? true;
  const denyIfRecentDust = config.denyIfRecentDust ?? true;
  const softScoreFreshAddress = config.softScoreFreshAddress ?? true;
  const freshBoost = config.freshAddressBoostScore ?? 0.3;
  const siblings = config.claimHistorySourceAddresses ?? [];

  return {
    id: 'onchain-nimiq',
    description: 'On-chain destination heuristics (sweeper / fresh / sibling-faucet cross-funding)',
    weight: config.weight ?? 2,
    async check(req): Promise<CheckResult> {
      if (typeof config.driver.addressHistory !== 'function') {
        return { score: 0, signals: { skipped: 'no-history' } };
      }

      let history;
      try {
        history = await config.driver.addressHistory(req.address);
      } catch (err) {
        return {
          score: 0,
          signals: { error: (err as Error).message },
          reason: 'onchain lookup failed (soft-skip)',
        };
      }

      // bigint → string so signals stay JSON-serialisable for the audit log.
      const baseSignals = {
        firstSeenAt: history.firstSeenAt,
        incomingCount: history.incomingCount,
        outgoingCount: history.outgoingCount,
        totalReceived: history.totalReceived.toString(),
        totalSent: history.totalSent.toString(),
        isSweeper: history.isSweeper,
      };

      if (history.isSweeper && denyIfSweeper) {
        return {
          score: 1,
          decision: 'deny',
          reason: 'destination looks like a sweeper address',
          signals: baseSignals,
        };
      }

      if (denyIfRecentDust && history.incomingCount > 10 && history.outgoingCount >= history.incomingCount) {
        return {
          score: 1,
          decision: 'deny',
          reason: 'destination shows dust-in / sweep-out pattern',
          signals: baseSignals,
        };
      }

      if (siblings.length > 0 && history.incomingCount > 0) {
        return {
          score: 0.7,
          decision: 'deny',
          reason: 'destination previously funded by sibling faucet',
          signals: { ...baseSignals, siblingFaucets: siblings.length },
        };
      }

      let score = 0;
      let reason: string | undefined;
      if (history.firstSeenAt === null && softScoreFreshAddress) {
        score = Math.max(score, freshBoost);
        reason = 'destination has no prior activity';
      }

      const result: CheckResult = { score, signals: baseSignals };
      if (reason) result.reason = reason;
      return result;
    },
  };
}
