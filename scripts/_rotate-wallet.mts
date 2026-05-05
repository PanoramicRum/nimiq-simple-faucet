/**
 * Internal helper for `scripts/rotate-secrets.sh --with-wallet`.
 *
 * Two subcommands:
 *
 *   tsx scripts/_rotate-wallet.mts generate
 *     → emits a fresh Nimiq Albatross keypair (address + 64-char hex
 *       private key) on stdout, one shell-friendly export per line:
 *
 *           NEW_FAUCET_WALLET_ADDRESS=NQ.. .... ....
 *           NEW_FAUCET_PRIVATE_KEY=<64-char hex>
 *
 *   tsx scripts/_rotate-wallet.mts sweep
 *     → reads the following env vars:
 *
 *           FAUCET_RPC_URL          (e.g. http://localhost:8648)
 *           FAUCET_RPC_USERNAME     (optional)
 *           FAUCET_RPC_PASSWORD     (optional)
 *           OLD_FAUCET_WALLET_ADDRESS
 *           NEW_FAUCET_WALLET_ADDRESS
 *           FEE_LUNA                (optional, default 0)
 *
 *       Sends every available luna from OLD → NEW and waits up to
 *       ~3 minutes for confirmation. Exits non-zero on any failure
 *       (including timeout) so the bash wrapper can abort.
 *
 * Why a separate file instead of inlining in the bash script:
 * keypair generation needs `@nimiq/core`'s WASM, and the RPC sweep
 * mirrors the contract `NimiqRpcDriver` already speaks (so we keep
 * one canonical encoding of `sendBasicTransaction` + confirmation
 * polling instead of forking it into shell).
 *
 * Secrets are NEVER passed via argv — only stdin/stdout/env. argv is
 * world-readable in `ps`, so handing the private key on the command
 * line would leak it to any local user during the run.
 */
type RpcId = number;

interface RpcError {
  code: number;
  message: string;
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const url = process.env.FAUCET_RPC_URL;
  if (!url) {
    throw new Error('FAUCET_RPC_URL is required');
  }
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const user = process.env.FAUCET_RPC_USERNAME;
  const pass = process.env.FAUCET_RPC_PASSWORD;
  if (user && pass) {
    headers.authorization = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
  }
  const id: RpcId = Math.floor(Math.random() * 2 ** 32);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  const body = (await res.json()) as { result?: T; error?: RpcError };
  if (body.error) {
    throw new Error(`${method} → ${body.error.code}: ${body.error.message}`);
  }
  return body.result as T;
}

async function generate(): Promise<void> {
  const nimiq = (await import('@nimiq/core')) as typeof import('@nimiq/core');
  const keyPair = nimiq.KeyPair.generate();
  const address = keyPair.toAddress().toUserFriendlyAddress();
  const privateKey = keyPair.privateKey.toHex();
  process.stdout.write(`NEW_FAUCET_WALLET_ADDRESS=${address}\n`);
  process.stdout.write(`NEW_FAUCET_PRIVATE_KEY=${privateKey}\n`);
}

async function sweep(): Promise<void> {
  const oldAddr = process.env.OLD_FAUCET_WALLET_ADDRESS;
  const newAddr = process.env.NEW_FAUCET_WALLET_ADDRESS;
  if (!oldAddr || !newAddr) {
    throw new Error('OLD_FAUCET_WALLET_ADDRESS and NEW_FAUCET_WALLET_ADDRESS are required');
  }
  const fee = Number.parseInt(process.env.FEE_LUNA ?? '0', 10);
  if (Number.isNaN(fee) || fee < 0) {
    throw new Error(`FEE_LUNA must be a non-negative integer, got ${process.env.FEE_LUNA}`);
  }

  // Sanity: confirm the node is reachable and on the network we expect.
  const networkId = await rpc<string>('getNetworkId', []);
  process.stderr.write(`[sweep] connected to RPC; network=${networkId}\n`);

  // Read balance from the old wallet.
  const account = await rpc<{ balance: number | string }>('getAccountByAddress', [oldAddr]);
  const balance = typeof account.balance === 'string' ? Number.parseInt(account.balance, 10) : account.balance;
  if (!Number.isFinite(balance) || balance <= 0) {
    throw new Error(`old wallet has no spendable balance (got ${balance} luna)`);
  }
  const value = balance - fee;
  if (value <= 0) {
    throw new Error(`fee (${fee}) >= balance (${balance}); refusing to send a zero/negative tx`);
  }
  process.stderr.write(`[sweep] balance=${balance} luna; fee=${fee}; sending ${value} luna\n`);

  const validityStartHeight = await rpc<number>('getBlockNumber', []);
  const txHash = await rpc<string>('sendBasicTransaction', [
    oldAddr,
    newAddr,
    value,
    fee,
    validityStartHeight,
  ]);
  process.stderr.write(`[sweep] tx submitted: ${txHash}\n`);

  // Poll for confirmation. Mirrors NimiqRpcDriver#waitForConfirmation:
  // ~120-block validity window @ 1s blocks, plus a small buffer.
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try {
      const receipt = await rpc<{ confirmations?: number } | null>(
        'getTransactionByHash',
        [txHash],
      );
      if (receipt && typeof receipt.confirmations === 'number' && receipt.confirmations > 0) {
        process.stderr.write(`[sweep] confirmed (${receipt.confirmations} confirmations)\n`);
        process.stdout.write(`SWEEP_TX_HASH=${txHash}\n`);
        return;
      }
    } catch {
      // Still in mempool — retry.
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error(`tx ${txHash} not confirmed within 180s`);
}

const cmd = process.argv[2];
if (cmd === 'generate') {
  await generate();
} else if (cmd === 'sweep') {
  await sweep();
} else {
  process.stderr.write('usage: tsx _rotate-wallet.mts <generate|sweep>\n');
  process.exit(2);
}
