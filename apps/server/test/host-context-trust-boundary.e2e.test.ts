/**
 * Regression tests for #96: a forged hostContext (no integrator HMAC, no
 * per-field signature) must not contribute trust-claim fields to the
 * abuse pipeline. The route strips kycLevel / accountAgeDays /
 * emailDomainHash / tags / verifiedIdentities before the request hits
 * the pipeline; correlation hashes (uid / cookieHash / sessionHash) are
 * preserved so the fingerprint layer can still do its work.
 *
 * We assert at the seam: read back the persisted claim row's
 * `signalsJson` and confirm the AI layer's feature bundle saw an empty
 * `verifiedIdentityCount` and `hostContextVerified === 0` (unsigned-
 * present), regardless of what the request body claimed.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { ServerConfigSchema } from '../src/config.js';
import { claims } from '../src/db/schema.js';
import { BaseTestDriver, TEST_FAUCET_ADDRESS } from './helpers/testDriver.js';

const FAUCET_ADDR = TEST_FAUCET_ADDRESS;
const USER_ADDR = 'NQ00 1111 1111 1111 1111 1111 1111 1111 1111';

class FakeDriver extends BaseTestDriver {
  override async send(): Promise<string> { return 'tx_x'; }
  override async waitForConfirmation(): Promise<void> {}
}

function baseConfig(dir: string, overrides: Record<string, unknown> = {}) {
  return ServerConfigSchema.parse({
    geoipBackend: 'none',
    network: 'test',
    dataDir: dir,
    signerDriver: 'rpc',
    rpcUrl: 'http://unused',
    walletAddress: FAUCET_ADDR,
    claimAmountLuna: '100000',
    rateLimitPerIpPerDay: '100',
    adminPassword: 'test-password-123',
    aiEnabled: 'true',
    dev: 'true',
    ...overrides,
  });
}

describe('hostContext trust-boundary (#96)', () => {
  let tmp: string;
  let apps: Array<Awaited<ReturnType<typeof buildApp>>['app']> = [];

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'faucet-host-trust-'));
  });

  afterEach(async () => {
    for (const a of apps) await a.close();
    apps = [];
    rmSync(tmp, { recursive: true, force: true });
  });

  it('strips trust-claim fields from an unsigned hostContext before the AI scorer sees them', async () => {
    const built = await buildApp(baseConfig(tmp), {
      driverOverride: new FakeDriver(),
      quietLogs: true,
    });
    apps.push(built.app);
    await built.app.ready();

    // Forged context: claims maximum trust without any HMAC. Includes
    // correlation hashes that should survive (preserved for fingerprint).
    const res = await built.app.inject({
      method: 'POST',
      url: '/v1/claim',
      payload: {
        address: USER_ADDR,
        hostContext: {
          uid: 'u-forged',
          cookieHash: 'c-forged',
          kycLevel: 'id',
          accountAgeDays: 365,
          emailDomainHash: 'forged-domain',
          verifiedIdentities: ['google', 'apple', 'github'],
          tags: ['premium'],
          // No signature → request never enters the verified path.
        },
      },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(200);

    // The persisted claim's signalsJson is the per-check bundle the
    // pipeline emitted. Pull the latest row and assert the AI layer's
    // features saw zero verified identities + hostContextVerified === 0.
    const [row] = await built.ctx.db
      .select()
      .from(claims)
      .where(eq(claims.address, USER_ADDR))
      .limit(1);
    expect(row).toBeTruthy();
    const signals = JSON.parse(row!.signalsJson) as Record<string, unknown>;
    const ai = signals.ai as { features?: Record<string, number> } | undefined;
    expect(ai).toBeDefined();
    expect(ai!.features).toBeDefined();
    expect(ai!.features!.verifiedIdentityCount).toBe(0);
    // 0 = unsigned-present (because cookieHash/uid kept the object truthy);
    // 0.5 would be absent. The forged trust fields were dropped before
    // the features extractor ran.
    expect(ai!.features!.hostContextVerified).toBe(0);
  });
});
