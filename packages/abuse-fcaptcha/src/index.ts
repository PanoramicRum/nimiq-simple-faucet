import { request } from 'undici';
import type { AbuseCheck, CheckResult } from '@faucet/core';

export interface FCaptchaCheckConfig {
  /** Server-side secret used with FCaptcha's /api/token/verify. */
  secret: string;
  /** Base URL of the FCaptcha service (e.g. http://fcaptcha:3000). */
  serverUrl: string;
  /** Per-call timeout in ms (default 3000). */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 3000;

interface FCaptchaVerifyResponse {
  valid: boolean;
  site_key?: string;
  score?: number;
  timestamp?: number;
  error?: string;
}

export function fcaptchaCheck(config: FCaptchaCheckConfig): AbuseCheck {
  const verifyUrl = `${config.serverUrl.replace(/\/$/, '')}/api/token/verify`;
  return {
    id: 'fcaptcha',
    description: 'FCaptcha token verification (self-hosted)',
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
      const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      let body: FCaptchaVerifyResponse;
      try {
        const res = await request(verifyUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token: req.captchaToken, secret: config.secret }),
          headersTimeout: timeoutMs,
          bodyTimeout: timeoutMs,
        });
        body = (await res.body.json()) as FCaptchaVerifyResponse;
      } catch (err) {
        // Fail closed on provider timeout/network/parse errors (#91).
        const message = err instanceof Error ? err.message : String(err);
        return {
          score: 1,
          decision: 'deny',
          reason: 'captcha provider error',
          signals: { provided: true, error: message },
        };
      }
      if (!body.valid) {
        return {
          score: 1,
          decision: 'deny',
          reason: 'captcha rejected',
          signals: { provided: true, error: body.error ?? null },
        };
      }
      const score = typeof body.score === 'number' ? Math.max(0, Math.min(1, body.score)) : 0;
      return {
        score,
        signals: {
          provided: true,
          site_key: body.site_key ?? null,
          timestamp: body.timestamp ?? null,
          score: body.score ?? null,
        },
      };
    },
  };
}
