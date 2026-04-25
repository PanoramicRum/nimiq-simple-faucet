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
      let result;
      try {
        result = await c.check(req);
      } catch (err) {
        // Per-check error boundary (#91). A check that throws (e.g. captcha
        // provider timeout, network error, JSON parse failure) must not
        // 500 the whole pipeline. Treat it as a hard `deny` keyed off the
        // check id so the calling route runs its normal deny cleanup
        // (decrement IP counter, write rejection row) instead of leaking
        // an exception out and burning IP quota.
        const message = err instanceof Error ? err.message : String(err);
        const entry: PipelineResult['perCheck'][number] = {
          id: c.id,
          score: 1,
          signals: { error: message },
          decision: 'deny',
        };
        perCheck.push(entry);
        signals[c.id] = entry.signals;
        reasons.push(`${c.id}: error`);
        hardDecision = 'deny';
        break;
      }
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
