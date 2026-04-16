import { request } from 'undici';
import type { AbuseCheck, CheckResult } from '@faucet/core';

export interface HCaptchaCheckConfig {
  secret: string;
  verifyUrl?: string;
}

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
      const res = await request(verifyUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
      const body = (await res.body.json()) as HCaptchaResponse;
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
