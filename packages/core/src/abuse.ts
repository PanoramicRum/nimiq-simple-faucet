import type { Address } from './types.js';
import type { HostContext } from './hostContext.js';

export type Decision = 'allow' | 'challenge' | 'review' | 'deny';

export interface ClaimRequest {
  address: Address;
  ip: string;
  userAgent?: string | undefined;
  captchaToken?: string | undefined;
  hashcashSolution?: string | undefined;
  fingerprint?:
    | {
        visitorId?: string | undefined;
        components?: Record<string, unknown> | undefined;
        confidence?: number | undefined;
      }
    | undefined;
  hostContext?: HostContext | undefined;
  hostContextVerified?: boolean | undefined;
  integratorId?: string | undefined;
  requestedAt: number;
}

export interface CheckResult {
  /** 0 = clean, 1 = certain abuse. */
  score: number;
  /** Structured evidence for the dashboard and MCP `explain_decision`. */
  signals: Record<string, unknown>;
  /** Optional hard decision. When set, short-circuits the pipeline. */
  decision?: Decision;
  /** Human-readable reason shown in audit log and (sanitized) to the user. */
  reason?: string;
}

export interface AbuseCheck {
  readonly id: string;
  readonly description?: string;
  /** Higher weight contributes more to the aggregate score. Defaults to 1. */
  readonly weight?: number;
  check(req: ClaimRequest): Promise<CheckResult>;
}

export interface PipelineResult {
  decision: Decision;
  score: number;
  signals: Record<string, unknown>;
  reasons: string[];
  perCheck: Array<{ id: string; score: number; signals: Record<string, unknown>; decision?: Decision }>;
}
