import { request } from 'undici';
import type { AbuseCheck, CheckResult } from '@faucet/core';

export interface HCaptchaCheckConfig {
  secret: string;
  verifyUrl?: string;
  /** Per-call timeout in ms (default 3000). Bounds the worker hold during a
   *  provider outage so a single slow upstream can't pin Fastify workers. */
  timeoutMs?: number;
}

/** Default timeout for the upstream verify call. */
const DEFAULT_TIMEOUT_MS = 3000;

interface HCaptchaResponse {
  success: boolean;
  challenge_ts?: string;
  hostname?: string;
  'error-codes'?: string[];
  score?: number;
}

export function hcaptchaCheck(config: HCaptchaCheckConfig): AbuseCheck {
  const verifyUrl = config.verifyUrl ?? 'https://api.hcaptcha.com/siteverify';
  return {
    id: 'hcaptcha',
    description: 'hCaptcha token verification',
    weight: 2,
    async check(req): Promise<CheckResult> {
      if (!req.captchaToken) {
        return {
          score: 1,
          decision: 'deny',
          reason: 'missing captcha token',
          signals: { provided: false },
        };
      }
      const form = new URLSearchParams({
        secret: config.secret,
        response: req.captchaToken,
        remoteip: req.ip,
      });
      const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      let body: HCaptchaResponse;
      try {
        const res = await request(verifyUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: form.toString(),
          headersTimeout: timeoutMs,
          bodyTimeout: timeoutMs,
        });
        body = (await res.body.json()) as HCaptchaResponse;
      } catch (err) {
        // Provider timeout, network error, or unparseable JSON. Fail closed
        // (deny) so the claim doesn't leak funds, but surface the error in
        // signals so operators can see degradation in the audit drawer.
        // Critically, deny runs the normal cleanup path (IP counter
        // decrement, rejection row) instead of throwing through to a 500
        // that would burn the caller's daily quota (#91).
        const message = err instanceof Error ? err.message : String(err);
        return {
          score: 1,
          decision: 'deny',
          reason: 'captcha provider error',
          signals: { provided: true, error: message },
        };
      }
      if (!body.success) {
        return {
          score: 1,
          decision: 'deny',
          reason: 'captcha rejected',
          signals: { provided: true, errors: body['error-codes'] ?? [] },
        };
      }
      const score = typeof body.score === 'number' ? Math.max(0, Math.min(1, body.score)) : 0;
      return {
        score,
        signals: {
          provided: true,
          challenge_ts: body.challenge_ts ?? null,
          hostname: body.hostname ?? null,
          score: body.score ?? null,
        },
      };
    },
  };
}
