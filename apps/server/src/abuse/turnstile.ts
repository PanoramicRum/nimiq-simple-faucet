import { request } from 'undici';
import type { AbuseCheck, CheckResult } from '@faucet/core';

export interface TurnstileCheckConfig {
  secret: string;
  verifyUrl?: string;
  /** Per-call timeout in ms (default 3000). Bounds the worker hold during a
   *  Cloudflare-side outage so a slow upstream can't pin Fastify workers. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 3000;

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
      const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      let body: {
        success: boolean;
        'error-codes'?: string[];
        action?: string;
        cdata?: string;
      };
      try {
        const res = await request(verifyUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: form.toString(),
          headersTimeout: timeoutMs,
          bodyTimeout: timeoutMs,
        });
        body = (await res.body.json()) as {
          success: boolean;
          'error-codes'?: string[];
          action?: string;
          cdata?: string;
        };
      } catch (err) {
        // Fail closed on provider timeout / network / parse errors (#91).
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
      return { score: 0, signals: { provided: true, action: body.action ?? null } };
    },
  };
}
