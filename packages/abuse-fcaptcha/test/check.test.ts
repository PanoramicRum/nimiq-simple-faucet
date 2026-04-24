import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from 'undici';
import type { ClaimRequest } from '@faucet/core';
import { fcaptchaCheck } from '../src/index.js';

const SERVER_URL = 'http://fcaptcha:3000';

function req(captchaToken?: string): ClaimRequest {
  const base: ClaimRequest = {
    address: 'NQ00 0000 0000 0000 0000 0000 0000 0000 0000',
    ip: '203.0.113.7',
    requestedAt: Date.now(),
  };
  if (captchaToken !== undefined) base.captchaToken = captchaToken;
  return base;
}

describe('fcaptchaCheck', () => {
  let mockAgent: MockAgent;
  let previousDispatcher: Dispatcher;

  beforeEach(() => {
    previousDispatcher = getGlobalDispatcher();
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    setGlobalDispatcher(mockAgent);
  });

  afterEach(async () => {
    await mockAgent.close();
    setGlobalDispatcher(previousDispatcher);
  });

  it('denies when the captcha token is missing', async () => {
    const check = fcaptchaCheck({ secret: 's', serverUrl: SERVER_URL });
    const r = await check.check(req());
    expect(r.decision).toBe('deny');
    expect(r.score).toBe(1);
    expect(r.signals.provided).toBe(false);
  });

  it('denies when upstream returns valid: false', async () => {
    mockAgent
      .get(SERVER_URL)
      .intercept({ path: '/api/token/verify', method: 'POST' })
      .reply(200, { valid: false, error: 'expired' });

    const check = fcaptchaCheck({ secret: 's', serverUrl: SERVER_URL });
    const r = await check.check(req('bad-token'));
    expect(r.decision).toBe('deny');
    expect(r.score).toBe(1);
    expect(r.signals.provided).toBe(true);
    expect(r.signals.error).toBe('expired');
  });

  it('allows when upstream returns valid: true and propagates the score', async () => {
    mockAgent
      .get(SERVER_URL)
      .intercept({ path: '/api/token/verify', method: 'POST' })
      .reply(200, { valid: true, site_key: 'sk', score: 0.12, timestamp: 1_700_000_000 });

    const check = fcaptchaCheck({ secret: 's', serverUrl: SERVER_URL });
    const r = await check.check(req('good-token'));
    expect(r.decision).toBeUndefined();
    expect(r.score).toBeCloseTo(0.12);
    expect(r.signals.provided).toBe(true);
    expect(r.signals.site_key).toBe('sk');
    expect(r.signals.timestamp).toBe(1_700_000_000);
  });

  it('clamps out-of-range scores into [0, 1]', async () => {
    mockAgent
      .get(SERVER_URL)
      .intercept({ path: '/api/token/verify', method: 'POST' })
      .reply(200, { valid: true, score: 1.8 });

    const check = fcaptchaCheck({ secret: 's', serverUrl: SERVER_URL });
    const r = await check.check(req('good-token'));
    expect(r.score).toBe(1);
  });

  it('defaults the score to 0 when upstream omits it', async () => {
    mockAgent
      .get(SERVER_URL)
      .intercept({ path: '/api/token/verify', method: 'POST' })
      .reply(200, { valid: true });

    const check = fcaptchaCheck({ secret: 's', serverUrl: SERVER_URL });
    const r = await check.check(req('good-token'));
    expect(r.score).toBe(0);
  });

  it('strips a trailing slash from serverUrl when building the verify URL', async () => {
    mockAgent
      .get(SERVER_URL)
      .intercept({ path: '/api/token/verify', method: 'POST' })
      .reply(200, { valid: true });

    const check = fcaptchaCheck({ secret: 's', serverUrl: `${SERVER_URL}/` });
    const r = await check.check(req('good-token'));
    expect(r.score).toBe(0);
  });

  it('POSTs the expected JSON body', async () => {
    let captured: string | undefined;
    mockAgent
      .get(SERVER_URL)
      .intercept({ path: '/api/token/verify', method: 'POST' })
      .reply(200, (opts) => {
        captured = typeof opts.body === 'string' ? opts.body : undefined;
        return { valid: true };
      });

    const check = fcaptchaCheck({ secret: 'super-secret', serverUrl: SERVER_URL });
    await check.check(req('tok-123'));
    expect(captured).toBeDefined();
    expect(JSON.parse(captured as string)).toEqual({ token: 'tok-123', secret: 'super-secret' });
  });
});
