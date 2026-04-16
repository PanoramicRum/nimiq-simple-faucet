import { request } from 'undici';
import type { AbuseCheck, CheckResult } from '@faucet/core';

export interface TurnstileCheckConfig {
  secret: string;
  verifyUrl?: string;
}

export function turnstileCheck(config: TurnstileCheckConfig): AbuseCheck {
  const verifyUrl = config.verifyUrl ?? 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
  return {
    id: 'turnstile',
    description: 'Cloudflare Turnstile token verification',
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
      const body = (await res.body.json()) as {
        success: boolean;
        'error-codes'?: string[];
        action?: string;
        cdata?: string;
      };
      if (!body.success) {
        return {
          score: 1,
          decision: 'deny',
          reason: 'captcha rejected',
          signals: { provided: true, errors: body['error-codes'] ?? [] },
        };
      }
      return { score: 0, signals: { provided: true, action: body.action ?? null } };
    },
  };
}
