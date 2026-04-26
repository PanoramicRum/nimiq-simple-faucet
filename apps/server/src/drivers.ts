import type { CurrencyDriver } from '@faucet/core';
import { NimiqRpcDriver } from '@faucet/driver-nimiq-rpc';
import { NimiqWasmDriver } from '@faucet/driver-nimiq-wasm';
import type { ServerConfig } from './config.js';

/**
 * Audit finding #022 / issue #102: refuse FAUCET_RPC_URL values that
 * point at internal infrastructure unless the operator explicitly opted
 * in via dev mode. The RPC URL is read by the JSON-RPC client and is
 * the natural SSRF surface — left unconstrained, an attacker who can
 * influence the env (config-management mistake, leaked secrets) could
 * point the faucet at, e.g., the cloud metadata endpoint or an internal
 * service. We block:
 *   - non-http(s) schemes (file:, gopher:, ftp:, …)
 *   - any host that resolves to a literal in a private/loopback/
 *     link-local/unspecified IP range
 *
 * The check is intentionally cheap — it runs once at boot. Hostnames
 * are *not* DNS-resolved here (could itself be DNS-rebinding); we
 * reject only literal IPs in unsafe ranges. Operators wiring up an
 * RPC node by hostname should put that hostname behind a network
 * boundary (egress firewall, VPC peering) and trust their DNS.
 */
function assertSafeRpcUrl(rawUrl: string, dev: boolean): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`FAUCET_RPC_URL is not a valid URL: ${rawUrl}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(
      `FAUCET_RPC_URL must use http(s); refused scheme '${url.protocol}'`,
    );
  }
  if (dev) return;
  // Node's URL parser preserves brackets around IPv6 literals in
  // `hostname`, so '[::1]' shows up as '[::1]'. Strip them once for
  // the IPv4-string regex and the IPv6-prefix matchers below.
  const host = url.hostname.replace(/^\[/, '').replace(/\]$/, '');
  const v4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4Match) {
    const [a, b] = v4Match.slice(1).map((n) => Number.parseInt(n, 10));
    const isPrivate =
      a === 127 || // loopback
      a === 0 || // unspecified
      a === 10 || // private
      (a === 169 && b === 254) || // link-local + cloud metadata
      (a === 172 && b! >= 16 && b! <= 31) || // private
      (a === 192 && b === 168) || // private
      (a === 100 && b! >= 64 && b! <= 127); // CGNAT
    if (isPrivate) {
      throw new Error(
        `FAUCET_RPC_URL host ${host} is in a private/loopback/link-local range; ` +
          'refusing to talk to internal infrastructure. ' +
          'Set FAUCET_DEV=1 for local development.',
      );
    }
  }
  // IPv6 literals: reject loopback, unspecified, link-local, ULA.
  const lowerHost = host.toLowerCase();
  const v6Unsafe =
    lowerHost === '::1' ||
    lowerHost === '::' ||
    lowerHost.startsWith('fe80:') || // link-local
    lowerHost.startsWith('fc') || // ULA
    lowerHost.startsWith('fd') || // ULA
    lowerHost.startsWith('::ffff:7f') || // IPv4-mapped 127.0.0.0/8
    lowerHost.startsWith('::ffff:0a') || // IPv4-mapped 10.0.0.0/8
    lowerHost.startsWith('::ffff:c0a8') || // IPv4-mapped 192.168.0.0/16
    lowerHost.startsWith('::ffff:a9fe'); // IPv4-mapped 169.254.0.0/16
  if (v6Unsafe) {
    throw new Error(
      `FAUCET_RPC_URL host ${host} is in a private/loopback IPv6 range; ` +
        'refusing to talk to internal infrastructure. ' +
        'Set FAUCET_DEV=1 for local development.',
    );
  }
}

export async function buildDriver(config: ServerConfig): Promise<CurrencyDriver> {
  if (config.signerDriver === 'rpc') {
    if (!config.rpcUrl || !config.walletAddress) {
      throw new Error('FAUCET_SIGNER_DRIVER=rpc requires FAUCET_RPC_URL and FAUCET_WALLET_ADDRESS');
    }
    assertSafeRpcUrl(config.rpcUrl, config.dev);
    const driver = new NimiqRpcDriver({
      network: config.network,
      rpcUrl: config.rpcUrl,
      auth:
        config.rpcUsername && config.rpcPassword
          ? { username: config.rpcUsername, password: config.rpcPassword }
          : undefined,
      walletAddress: config.walletAddress,
      walletPassphrase: config.walletPassphrase,
      privateKey: config.privateKey,
    });
    await driver.init();
    return driver;
  }
  if (!config.privateKey) {
    throw new Error('FAUCET_SIGNER_DRIVER=wasm requires FAUCET_PRIVATE_KEY');
  }
  const driver = new NimiqWasmDriver({
    network: config.network,
    privateKey: config.privateKey,
  });
  await driver.init();
  return driver;
}
