import type { AbuseCheck, CheckResult } from '@faucet/core';
import { buildFeatures } from './features.js';
import { defaultRulesModel, sumAndClamp, topContributions } from './rules.js';
import type { AiCheckConfig } from './types.js';

export function aiCheck(config: AiCheckConfig): AbuseCheck {
  const model = config.model ?? defaultRulesModel();
  const denyThreshold = config.denyThreshold ?? 0.85;
  const reviewThreshold = config.reviewThreshold ?? 0.65;
  return {
    id: 'ai',
    description: 'Local anomaly score (rules v0; ONNX hook reserved)',
    weight: config.weight ?? 1.5,
    async check(req): Promise<CheckResult> {
      try {
        const features = await buildFeatures({ req, query: config.query });
        const contribs = model.score(features);
        const score = sumAndClamp(contribs);
        const top = topContributions(contribs, 3);

        const result: CheckResult = {
          score,
          signals: {
            model: model.id,
            score,
            top,
            features,
          },
        };
        if (score >= denyThreshold) {
          result.decision = 'deny';
          result.reason = 'AI anomaly score exceeds deny threshold';
        } else if (score >= reviewThreshold) {
          result.decision = 'review';
          result.reason = 'AI anomaly score exceeds review threshold';
        }
        return result;
      } catch (err) {
        // Soft-skip: a bad counter source must not block the whole pipeline.
        return {
          score: 0,
          signals: { model: model.id, error: (err as Error).message },
          reason: 'ai check failed (soft-skipping)',
        };
      }
    },
  };
}
