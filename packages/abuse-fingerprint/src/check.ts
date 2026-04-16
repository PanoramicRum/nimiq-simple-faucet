import type { AbuseCheck, CheckResult, Decision } from '@faucet/core';
import type { FingerprintCheckConfig } from './types.js';

const DEFAULT_WINDOW_MS = 24 * 60 * 60_000;

export function fingerprintCheck(config: FingerprintCheckConfig): AbuseCheck {
  const windowMs = config.windowMs ?? DEFAULT_WINDOW_MS;
  const maxVisitorsPerUid = config.maxVisitorsPerUid ?? 3;
  const maxUidsPerVisitor = config.maxUidsPerVisitor ?? 3;
  const unsignedContextPenalty = config.unsignedContextPenalty ?? 0.3;

  return {
    id: 'fingerprint',
    description: 'Correlate visitor IDs with host uids / cookie hashes',
    weight: config.weight ?? 2,
    async check(req): Promise<CheckResult> {
      const visitorId = req.fingerprint?.visitorId ?? null;
      const uid = req.hostContext?.uid ?? null;
      const cookieHash = req.hostContext?.cookieHash ?? null;

      if (visitorId === null && uid === null) {
        return { score: 0, signals: { skipped: 'no-signals' } };
      }

      const signals: Record<string, unknown> = {};
      let score = 0;
      let decision: Decision | undefined;
      let reason: string | undefined;

      // Signed host contexts get full trust; unsigned are accepted but softly penalised.
      if (req.hostContext !== undefined && req.hostContextVerified !== true) {
        score = Math.max(score, unsignedContextPenalty);
        signals.contextVerified = false;
      }

      try {
        await config.store.record({
          visitorId: visitorId ?? '',
          uid,
          cookieHash,
          seenAt: req.requestedAt,
        });

        if (visitorId !== null && uid !== null) {
          const visitorCount = await config.store.countVisitorsForUid(uid, windowMs);
          const uidCount = await config.store.countUidsForVisitor(visitorId, windowMs);
          signals.visitorCount = visitorCount;
          signals.uidCount = uidCount;

          if (visitorCount > maxVisitorsPerUid) {
            decision = 'review';
            reason = `uid seen with ${visitorCount} distinct visitor IDs`;
            score = Math.max(score, 0.75);
          }
          // uid-per-visitor is strictly worse (one browser claiming many identities) so it overrides.
          if (uidCount > maxUidsPerVisitor) {
            decision = 'deny';
            reason = `visitor associated with ${uidCount} distinct uids`;
            score = 1;
          }
        }
      } catch {
        return { score: 0, signals: { skipped: 'store-error' }, reason: 'fingerprint store error (soft-skip)' };
      }

      const result: CheckResult = { score, signals };
      if (decision) result.decision = decision;
      if (reason) result.reason = reason;
      return result;
    },
  };
}
