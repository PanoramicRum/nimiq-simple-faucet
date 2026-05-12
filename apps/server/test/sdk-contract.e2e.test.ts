/**
 * Cross-SDK contract tests (ROADMAP §2.3.3).
 *
 * Boots a reference faucet server (fake instant-confirm driver) and runs the
 * same behavioural assertions against each first-party client SDK, so they
 * can't drift apart silently. Today: `@nimiq-faucet/sdk` (`FaucetClient`) —
 * already a workspace dep of the bundled UIs, so it's safe to add as a
 * devDep of `@faucet/server` without expanding the narrower Docker workspace
 * (`deploy/docker/pnpm-workspace.docker.yaml`).
 *
 * Follow-ups (§2.3.3): the React-Native + Capacitor clients and the
 * React / Vue hooks; the Python / Go / Dart SDKs (cross-language
 * orchestration — boot this fixture, point each SDK's own test runner at it
 * via an env var). Adding those is cleanest from a dedicated
 * `tests/sdk-contract/` package, which the Docker workspace doesn't include.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FaucetClient } from '@nimiq-faucet/sdk';
import { type ContractFixture, startContractFixture } from './helpers/sdkContractFixture.js';

// Same valid testnet address shape used by claim.e2e.test.ts /
// idempotency-scoping.e2e.test.ts. Repeated claims to it are fine — the
// faucet rate-limits per IP, not per address.
const ADDR = 'NQ00 1111 1111 1111 1111 1111 1111 1111 1111';

let plainFx: ContractFixture;
let hashcashFx: ContractFixture;

beforeAll(async () => {
  plainFx = await startContractFixture({ hashcash: false });
  hashcashFx = await startContractFixture({ hashcash: true });
}, 30_000);

afterAll(async () => {
  await plainFx?.close();
  await hashcashFx?.close();
});

/**
 * Behavioural surface every primary SDK client must satisfy. Structural
 * typing keeps it framework-agnostic — `FaucetClient` and its subclasses match
 * without an explicit `implements`.
 */
interface ContractClient {
  config(): Promise<{ network: string; claimAmountLuna: string }>;
  claim(
    address: string,
    options?: { idempotencyKey?: string },
  ): Promise<{ id: string; status: string; txId?: string | undefined }>;
  status(id: string): Promise<{ id: string; status: string; txId?: string | undefined }>;
  waitForConfirmation(id: string, timeoutMs?: number): Promise<{ id: string; status: string; txId?: string | undefined }>;
  requestChallenge(uid?: string): Promise<{ challenge: string; difficulty: number }>;
  solveAndClaim(
    address: string,
    options?: { idempotencyKey?: string },
  ): Promise<{ id: string; status: string; txId?: string | undefined }>;
}

const BROADCAST_OR_CONFIRMED = ['broadcast', 'confirmed'];

function runSdkContract(name: string, make: (url: string) => ContractClient): void {
  describe(`SDK contract — ${name}`, () => {
    it('config() returns the faucet config', async () => {
      const cfg = await make(plainFx.url).config();
      expect(cfg.network).toBe('test');
      expect(typeof cfg.claimAmountLuna).toBe('string');
    });

    it('claim() returns a broadcast claim with a txId', async () => {
      const r = await make(plainFx.url).claim(ADDR);
      expect(r.id).toBeTruthy();
      expect(BROADCAST_OR_CONFIRMED).toContain(r.status);
      expect(r.txId).toBeTruthy();
    });

    it('status() reflects the submitted claim', async () => {
      const c = make(plainFx.url);
      const r = await c.claim(ADDR);
      const s = await c.status(r.id);
      expect(s.id).toBe(r.id);
      expect(BROADCAST_OR_CONFIRMED).toContain(s.status);
    });

    it('waitForConfirmation() converges to confirmed', async () => {
      const c = make(plainFx.url);
      const r = await c.claim(ADDR);
      const s = await c.waitForConfirmation(r.id, 10_000);
      expect(s.status).toBe('confirmed');
      expect(s.txId).toBeTruthy();
    });

    it('idempotencyKey: same key + address replays the original claim', async () => {
      const c = make(plainFx.url);
      const key = `contract-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const r1 = await c.claim(ADDR, { idempotencyKey: key });
      const r2 = await c.claim(ADDR, { idempotencyKey: key });
      expect(r2.id).toBe(r1.id);
      const r3 = await c.claim(ADDR, { idempotencyKey: `${key}-other` });
      expect(r3.id).not.toBe(r1.id);
    });

    it('requestChallenge() + solveAndClaim() works when hashcash is enabled', async () => {
      const c = make(hashcashFx.url);
      const ch = await c.requestChallenge();
      expect(typeof ch.challenge).toBe('string');
      expect(ch.difficulty).toBe(hashcashFx.hashcashDifficulty);
      const r = await c.solveAndClaim(ADDR);
      expect(BROADCAST_OR_CONFIRMED).toContain(r.status);
      expect(r.txId).toBeTruthy();
    });
  });
}

runSdkContract('@nimiq-faucet/sdk (FaucetClient)', (url) => new FaucetClient({ url }));
