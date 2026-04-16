/**
 * Manual smoke test: point at a running faucet container on Nimiq testnet
 * and fund either a caller-supplied address or a freshly-generated one.
 *
 * Usage: FAUCET_BASE_URL=http://localhost:8080 pnpm smoke:testnet
 *
 * Optional env: FAUCET_RECIPIENT (skip keypair generation), FAUCET_TIMEOUT_MS.
 */
import { solveChallenge, type HashcashChallenge } from '@faucet/abuse-hashcash';

const BASE_URL = (process.env.FAUCET_BASE_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const TIMEOUT_MS = Number(process.env.FAUCET_TIMEOUT_MS ?? 120_000);

interface FaucetConfig {
  network: 'main' | 'test';
  abuseLayers: { hashcash: boolean };
  hashcash: { difficulty: number; ttlMs: number } | null;
}

interface ClaimResponse {
  id: string;
  status: string;
  txId?: string;
  decision?: string;
  reason?: string;
}

async function getConfig(): Promise<FaucetConfig> {
  const res = await fetch(`${BASE_URL}/v1/config`);
  if (!res.ok) throw new Error(`GET /v1/config → ${res.status}`);
  return (await res.json()) as FaucetConfig;
}

async function mintChallenge(): Promise<HashcashChallenge> {
  const res = await fetch(`${BASE_URL}/v1/challenge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) throw new Error(`POST /v1/challenge → ${res.status}`);
  return (await res.json()) as HashcashChallenge;
}

async function resolveRecipient(): Promise<string> {
  const fromEnv = process.env.FAUCET_RECIPIENT;
  if (fromEnv) return fromEnv;

  // Dynamic import so the script still loads if @nimiq/core isn't available
  // at the repo root (it lives in the wasm driver's node_modules).
  try {
    const nimiq = (await import('@nimiq/core')) as typeof import('@nimiq/core');
    const kp = nimiq.KeyPair.generate();
    const addr = kp.toAddress().toUserFriendlyAddress();
    console.log(`[smoke] generated fresh recipient: ${addr}`);
    return addr;
  } catch (err) {
    throw new Error(
      `No FAUCET_RECIPIENT set and @nimiq/core is not importable from the repo root. ` +
        `Set FAUCET_RECIPIENT to a testnet address or add @nimiq/core to root devDeps. ` +
        `Underlying: ${(err as Error).message}`,
    );
  }
}

async function submitClaim(address: string, hashcashSolution?: string): Promise<ClaimResponse> {
  const body: Record<string, unknown> = { address };
  if (hashcashSolution) body.hashcashSolution = hashcashSolution;
  const res = await fetch(`${BASE_URL}/v1/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as ClaimResponse;
  if (!res.ok && res.status !== 202) {
    throw new Error(`POST /v1/claim → ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

async function pollUntilConfirmed(id: string): Promise<ClaimResponse> {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await fetch(`${BASE_URL}/v1/claim/${id}`);
    if (!res.ok) throw new Error(`GET /v1/claim/${id} → ${res.status}`);
    const json = (await res.json()) as ClaimResponse;
    if (json.status === 'confirmed') return json;
    if (json.status === 'rejected') throw new Error(`claim rejected: ${json.reason ?? 'unknown'}`);
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error(`claim ${id} not confirmed within ${TIMEOUT_MS}ms`);
}

function explorerUrl(network: 'main' | 'test', txHash: string): string {
  return network === 'main'
    ? `https://nimiq.watch/#${txHash}`
    : `https://test.nimiq.watch/#${txHash}`;
}

async function main(): Promise<void> {
  console.log(`[smoke] base url: ${BASE_URL}`);
  const config = await getConfig();
  if (config.network !== 'test') {
    throw new Error(`refusing to run: server reports network=${config.network}, expected 'test'`);
  }
  console.log(`[smoke] network=test, hashcash=${config.abuseLayers.hashcash}`);

  const recipient = await resolveRecipient();

  let hashcashSolution: string | undefined;
  if (config.abuseLayers.hashcash && config.hashcash) {
    console.log(`[smoke] solving hashcash (difficulty=${config.hashcash.difficulty})…`);
    const { challenge, difficulty } = await mintChallenge();
    const nonce = await solveChallenge(challenge, difficulty);
    hashcashSolution = `${challenge}#${nonce}`;
    console.log(`[smoke] hashcash solved`);
  }

  const claim = await submitClaim(recipient, hashcashSolution);
  console.log(`[smoke] claim accepted: id=${claim.id} status=${claim.status}`);
  if (claim.status === 'rejected') {
    throw new Error(`claim rejected up front: ${claim.reason ?? 'unknown'}`);
  }
  if (claim.status === 'challenged') {
    throw new Error(`claim returned challenge decision — server wants extra work beyond hashcash`);
  }

  const final = await pollUntilConfirmed(claim.id);
  const txHash = final.txId;
  if (!txHash) throw new Error('confirmed claim has no txId');
  console.log(`[smoke] confirmed tx: ${txHash}`);
  console.log(`[smoke] explorer: ${explorerUrl(config.network, txHash)}`);
}

main().catch((err) => {
  console.error(`[smoke] FAILED: ${(err as Error).message}`);
  process.exit(1);
});
