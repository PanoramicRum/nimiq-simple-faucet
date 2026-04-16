import type { ClaimRequest } from '@faucet/core';

export interface RecentClaimsQuery {
  /** Number of claims from this IP within window. */
  byIp(ip: string, windowMs: number): Promise<number>;
  /** Number of claims to this address within window. */
  byAddress(address: string, windowMs: number): Promise<number>;
  /** Number of claims from this uid within window. */
  byUid(uid: string, windowMs: number): Promise<number>;
}

export interface FeatureBundle {
  claimsByIp1h: number;
  claimsByIp24h: number;
  claimsByAddress1h: number;
  claimsByAddress24h: number;
  claimsByUid24h: number;
  fingerprintEntropy: number;
  hostContextVerified: number;
  addressIsFresh: number;
  hourOfDayUtc: number;
}

export interface AiScoreContribution {
  feature: keyof FeatureBundle;
  weight: number;
  contribution: number;
}

export interface AiCheckResult {
  score: number;
  contributions: AiScoreContribution[];
  notes: string[];
}

export interface AiModel {
  readonly id: string;
  score(features: FeatureBundle): AiScoreContribution[];
}

export interface AiCheckConfig {
  query: RecentClaimsQuery;
  /** Override the default rules model or plug a future ONNX-backed one. */
  model?: AiModel | undefined;
  /** Weight in the aggregate pipeline. Default 1.5. */
  weight?: number | undefined;
  /** Deny threshold (0..1). Default 0.85. */
  denyThreshold?: number | undefined;
  /** Review threshold. Default 0.65. */
  reviewThreshold?: number | undefined;
}

export interface BuildFeaturesArgs {
  req: ClaimRequest;
  query: RecentClaimsQuery;
}
