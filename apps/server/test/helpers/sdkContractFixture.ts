import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TxId } from '@faucet/core';
import { buildApp } from '../../src/app.js';
import { ServerConfigSchema } from '../../src/config.js';
import { BaseTestDriver, TEST_FAUCET_ADDRESS } from './testDriver.js';

/**
 * Fake driver for the SDK contract harness: every `send()` returns a fresh
 * txId and `waitForConfirmation()` resolves instantly, so the server's claim
 * flow converges to `confirmed` deterministically without touching a chain.
 */
class ContractTestDriver extends BaseTestDriver {
  #n = 0;
  override async getBalance(): Promise<bigint> {
    return 10_000_000n;
  }
  override async send(): Promise<TxId> {
    this.#n += 1;
    return `tx_${this.#n}` as TxId;
  }
  override async waitForConfirmation(): Promise<void> {}
}

export interface ContractFixture {
  /** Base URL the SDK clients point at, e.g. `http://127.0.0.1:54321`. */
  readonly url: string;
  /** Hashcash difficulty when this fixture has hashcash enabled (low → instant to solve). */
  readonly hashcashDifficulty: number;
  close(): Promise<void>;
}

const HASHCASH_DIFFICULTY = 8;

/**
 * Boot a reference faucet server on a random localhost port for the SDK
 * contract suite. Pass `{ hashcash: true }` to enable the hashcash layer
 * (so `requestChallenge` / `solveAndClaim` work); the plain fixture leaves it
 * off so a bare `claim()` returns `broadcast` rather than `challenged`.
 */
export async function startContractFixture(opts: { hashcash?: boolean } = {}): Promise<ContractFixture> {
  const hashcash = opts.hashcash ?? false;
  const tmp = mkdtempSync(join(tmpdir(), 'faucet-sdk-contract-'));
  const config = ServerConfigSchema.parse({
    geoipBackend: 'none',
    network: 'test',
    dataDir: tmp,
    signerDriver: 'rpc',
    rpcUrl: 'http://unused',
    walletAddress: TEST_FAUCET_ADDRESS,
    claimAmountLuna: '100000',
    // Generous limits — the contract suite makes many claims from 127.0.0.1.
    rateLimitPerIpPerDay: '1000',
    rateLimitPerMinute: '1000',
    adminPassword: 'sdk-contract-test-password-123',
    dev: 'true',
    rejectDelayMsMin: '0',
    ...(hashcash
      ? { hashcashSecret: 'sdk-contract-test-hashcash-secret', hashcashDifficulty: String(HASHCASH_DIFFICULTY) }
      : {}),
  });
  const { app } = await buildApp(config, { driverOverride: new ContractTestDriver(), quietLogs: true });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    hashcashDifficulty: HASHCASH_DIFFICULTY,
    async close() {
      await app.close();
      rmSync(tmp, { recursive: true, force: true });
    },
  };
}
