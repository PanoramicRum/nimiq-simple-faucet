import type { CurrencyDriver } from '@faucet/core';
import { NimiqRpcDriver } from '@faucet/driver-nimiq-rpc';
import { NimiqWasmDriver } from '@faucet/driver-nimiq-wasm';
import type { ServerConfig } from './config.js';

export async function buildDriver(config: ServerConfig): Promise<CurrencyDriver> {
  if (config.signerDriver === 'rpc') {
    if (!config.rpcUrl || !config.walletAddress) {
      throw new Error('FAUCET_SIGNER_DRIVER=rpc requires FAUCET_RPC_URL and FAUCET_WALLET_ADDRESS');
    }
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
