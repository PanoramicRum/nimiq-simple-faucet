/**
 * Generate a fresh Nimiq testnet keypair and save it locally for use with the
 * faucet in `wasm` signer mode.
 *
 * Usage:
 *   pnpm generate:wallet          # writes .wallet.local.json in the repo root
 *   pnpm generate:wallet --print  # also prints the private key (careful!)
 *
 * The generated file is gitignored. Use its values to fill `.env`:
 *   FAUCET_WALLET_ADDRESS=<address>
 *   FAUCET_PRIVATE_KEY=<privateKey>
 *
 * Then fund the address from a public testnet faucet, e.g.
 *   https://faucet.pos.nimiq-testnet.com
 */
import { writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT_PATH = resolve(import.meta.dirname, '..', '.wallet.local.json');

async function main(): Promise<void> {
  const printPrivate = process.argv.includes('--print');

  if (existsSync(OUT_PATH) && !process.argv.includes('--force')) {
    console.error(`Refusing to overwrite existing ${OUT_PATH}.`);
    console.error('Pass --force to regenerate (the old key will be lost).');
    process.exit(1);
  }

  const nimiq = (await import('@nimiq/core')) as typeof import('@nimiq/core');
  const keyPair = nimiq.KeyPair.generate();
  const address = keyPair.toAddress().toUserFriendlyAddress();
  const privateKey = keyPair.privateKey.toHex();

  const payload = {
    network: 'test',
    address,
    privateKey,
    generatedAt: new Date().toISOString(),
  };

  writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2) + '\n', { mode: 0o600 });

  console.log('');
  console.log('  Generated fresh Nimiq testnet wallet.');
  console.log('');
  console.log(`  Address: ${address}`);
  if (printPrivate) {
    console.log(`  Private key (hex): ${privateKey}`);
  } else {
    console.log(`  Private key: saved to ${OUT_PATH} (gitignored)`);
    console.log('  Use --print to echo the private key to the terminal.');
  }
  console.log('');
  console.log('  Next steps:');
  console.log('    1. Fund the address at https://faucet.pos.nimiq-testnet.com');
  console.log('    2. Copy the values into your .env:');
  console.log('         FAUCET_SIGNER_DRIVER=wasm');
  console.log(`         FAUCET_WALLET_ADDRESS="${address}"`);
  console.log('         FAUCET_PRIVATE_KEY=<see .wallet.local.json>');
  console.log('    3. Start the faucet and run `pnpm smoke:testnet`.');
  console.log('');
}

main().catch((err) => {
  console.error(`Failed: ${(err as Error).message}`);
  process.exit(1);
});
