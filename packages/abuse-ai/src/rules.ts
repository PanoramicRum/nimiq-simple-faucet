import type { AiModel, AiScoreContribution, FeatureBundle } from './types.js';

// A smooth ramp: maps excess above `threshold` through `perUnit` weight, clamped to `cap`.
// Using min(cap, ...) rather than a hard step keeps contributions monotone and explainable.
function ramp(value: number, threshold: number, perUnit: number, cap: number): number {
  const excess = value - threshold;
  if (excess <= 0) return 0;
  return Math.min(cap, excess * perUnit);
}

export function defaultRulesModel(): AiModel {
  return {
    id: 'rules-v0',
    score(f: FeatureBundle): AiScoreContribution[] {
      const raw: AiScoreContribution[] = [];

      const ip1h = ramp(f.claimsByIp1h, 3, 0.25, 0.5);
      if (ip1h > 0) raw.push({ feature: 'claimsByIp1h', weight: 0.25, contribution: ip1h });

      const ip24h = ramp(f.claimsByIp24h, 10, 0.15, 0.4);
      if (ip24h > 0) raw.push({ feature: 'claimsByIp24h', weight: 0.15, contribution: ip24h });

      if (f.claimsByAddress1h > 1) {
        raw.push({ feature: 'claimsByAddress1h', weight: 0.3, contribution: 0.3 });
      }

      if (f.claimsByAddress24h > 5) {
        raw.push({ feature: 'claimsByAddress24h', weight: 0.2, contribution: 0.2 });
      }

      if (f.claimsByUid24h > 10) {
        raw.push({ feature: 'claimsByUid24h', weight: 0.15, contribution: 0.15 });
      }

      if (f.fingerprintEntropy < 0.3) {
        raw.push({ feature: 'fingerprintEntropy', weight: 0.2, contribution: 0.2 });
      }

      if (f.hostContextVerified === 0) {
        raw.push({ feature: 'hostContextVerified', weight: 0.1, contribution: 0.1 });
      }

      if (f.addressIsFresh === 1) {
        raw.push({ feature: 'addressIsFresh', weight: 0.1, contribution: 0.1 });
      }

      if (f.hourOfDayUtc === 2 || f.hourOfDayUtc === 3 || f.hourOfDayUtc === 4) {
        raw.push({ feature: 'hourOfDayUtc', weight: 0.05, contribution: 0.05 });
      }

      return raw;
    },
  };
}

export function sumAndClamp(contribs: AiScoreContribution[]): number {
  let total = 0;
  for (const c of contribs) total += c.contribution;
  if (total < 0) return 0;
  if (total > 1) return 1;
  return total;
}

export function topContributions(contribs: AiScoreContribution[], n = 3): AiScoreContribution[] {
  return [...contribs]
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, n);
}
