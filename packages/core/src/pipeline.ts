import type { AbuseCheck, ClaimRequest, Decision, PipelineResult } from './abuse.js';

export interface PipelineConfig {
  /** Score at which the pipeline escalates to `challenge`. */
  challengeThreshold: number;
  /** Score at which the pipeline denies. */
  denyThreshold: number;
  /** Score at which the pipeline routes to manual review. */
  reviewThreshold: number;
}

const DEFAULT_CONFIG: PipelineConfig = {
  challengeThreshold: 0.4,
  reviewThreshold: 0.7,
  denyThreshold: 0.85,
};

export class AbusePipeline {
  private readonly checks: AbuseCheck[];
  private readonly config: PipelineConfig;

  constructor(checks: AbuseCheck[], config: Partial<PipelineConfig> = {}) {
    this.checks = checks;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async evaluate(req: ClaimRequest): Promise<PipelineResult> {
    const perCheck: PipelineResult['perCheck'] = [];
    const signals: Record<string, unknown> = {};
    const reasons: string[] = [];

    let weightedScoreSum = 0;
    let weightSum = 0;
    let hardDecision: Decision | undefined;

    for (const c of this.checks) {
      const result = await c.check(req);
      const entry: PipelineResult['perCheck'][number] = {
        id: c.id,
        score: result.score,
        signals: result.signals,
      };
      if (result.decision) entry.decision = result.decision;
      perCheck.push(entry);
      signals[c.id] = result.signals;
      if (result.reason) reasons.push(`${c.id}: ${result.reason}`);

      const w = c.weight ?? 1;
      weightedScoreSum += result.score * w;
      weightSum += w;

      if (result.decision === 'deny') {
        hardDecision = 'deny';
        break;
      }
      if (result.decision && !hardDecision) {
        hardDecision = result.decision;
      }
    }

    const score = weightSum === 0 ? 0 : weightedScoreSum / weightSum;
    const decision: Decision = hardDecision ?? this.decisionFromScore(score);

    return { decision, score, signals, reasons, perCheck };
  }

  private decisionFromScore(score: number): Decision {
    if (score >= this.config.denyThreshold) return 'deny';
    if (score >= this.config.reviewThreshold) return 'review';
    if (score >= this.config.challengeThreshold) return 'challenge';
    return 'allow';
  }
}
