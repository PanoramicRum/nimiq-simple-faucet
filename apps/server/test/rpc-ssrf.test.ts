import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ServerConfigSchema } from '../src/config.js';
import { buildDriver } from '../src/drivers.js';
import { TEST_FAUCET_ADDRESS } from './helpers/testDriver.js';

/**
 * Audit finding #022 / issue #102: refuse FAUCET_RPC_URL values that
 * point at internal infrastructure unless dev mode is on. The check
 * runs at boot inside buildDriver(), so the assertion is "buildDriver
 * rejects/accepts the URL" rather than reaching out over the wire.
 */

const FAUCET_ADDR = TEST_FAUCET_ADDRESS;

function configWith(dir: string, overrides: Record<string, unknown>) {
  return ServerConfigSchema.parse({
    geoipBackend: 'none',
    network: 'test',
    dataDir: dir,
    signerDriver: 'rpc',
    walletAddress: FAUCET_ADDR,
    claimAmountLuna: '100000',
    adminPassword: 'test-password-123',
    privateKey: 'a'.repeat(64),
    walletPassphrase: 'test-passphrase-12',
    ...overrides,
  });
}

describe('RPC URL SSRF guard', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'faucet-rpc-ssrf-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('rejects file: scheme in non-dev mode', async () => {
    const config = configWith(tmp, {
      rpcUrl: 'file:///etc/passwd',
      dev: false,
    });
    await expect(buildDriver(config)).rejects.toThrow(/scheme/);
  });

  it('rejects loopback IPv4 (127.0.0.1) in non-dev mode', async () => {
    const config = configWith(tmp, {
      rpcUrl: 'http://127.0.0.1:8648',
      dev: false,
    });
    await expect(buildDriver(config)).rejects.toThrow(/private\/loopback/);
  });

  it('rejects 0.0.0.0 in non-dev mode', async () => {
    const config = configWith(tmp, {
      rpcUrl: 'http://0.0.0.0:8648',
      dev: false,
    });
    await expect(buildDriver(config)).rejects.toThrow(/private\/loopback/);
  });

  it('rejects RFC1918 (10.0.0.5, 172.20.1.1, 192.168.1.1) in non-dev mode', async () => {
    for (const host of ['10.0.0.5', '172.20.1.1', '192.168.1.1']) {
      const config = configWith(tmp, { rpcUrl: `http://${host}:8648`, dev: false });
      await expect(buildDriver(config)).rejects.toThrow(/private\/loopback/);
    }
  });

  it('rejects link-local 169.254.169.254 (cloud metadata) in non-dev mode', async () => {
    const config = configWith(tmp, {
      rpcUrl: 'http://169.254.169.254/latest/meta-data/',
      dev: false,
    });
    await expect(buildDriver(config)).rejects.toThrow(/private\/loopback/);
  });

  it('rejects IPv6 loopback ::1 in non-dev mode', async () => {
    const config = configWith(tmp, {
      rpcUrl: 'http://[::1]:8648',
      dev: false,
    });
    await expect(buildDriver(config)).rejects.toThrow(/private\/loopback/);
  });

  it('rejects IPv4-mapped IPv6 loopback ::ffff:127.0.0.1 in non-dev mode', async () => {
    const config = configWith(tmp, {
      rpcUrl: 'http://[::ffff:7f00:1]:8648',
      dev: false,
    });
    await expect(buildDriver(config)).rejects.toThrow(/private\/loopback/);
  });

  it('allows loopback in dev mode (so local Nimiq nodes work)', async () => {
    // We don't actually want buildDriver to reach the network — the
    // assertion is just that the SSRF guard does NOT throw. The driver
    // will fail later in init() when the connection is refused, but that
    // happens in the background readyPromise (decoupled from boot). So
    // we resolve and ignore.
    const config = configWith(tmp, {
      rpcUrl: 'http://127.0.0.1:1', // unreachable port
      dev: true,
    });
    const driver = await buildDriver(config);
    // Best-effort cleanup; init() runs in background.
    driver.readyPromise?.catch(() => {});
  });

  it('throws on a malformed URL', async () => {
    const config = configWith(tmp, {
      rpcUrl: 'not a url at all',
      dev: false,
    });
    await expect(buildDriver(config)).rejects.toThrow(/valid URL/);
  });
});
