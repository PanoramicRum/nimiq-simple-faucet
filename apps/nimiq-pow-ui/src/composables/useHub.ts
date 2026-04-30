import { ref, type Ref } from 'vue';
import HubApi, { type ChooseAddressResult } from '@nimiq/hub-api';
import type { FaucetConfig } from '@nimiq-faucet/sdk';

/**
 * Nimiq Hub-API integration — ROADMAP §3.0.15.
 *
 * The faucet sends NIM **to** an address; it never asks the user to
 * sign anything. So we only need `chooseAddress()` from the Hub —
 * the user picks one of their accounts, the Hub returns the address
 * (and a friendly label), and we hand it to `client.claim()`.
 *
 * No private key ever touches this page. No transaction is ever signed
 * here. The Hub popup runs in its own origin (hub.nimiq.com /
 * hub.nimiq-testnet.com); the user authenticates there.
 *
 * Hub endpoint is selected from the faucet's `/v1/config.network`:
 *   - 'main' → https://hub.nimiq.com
 *   - 'test' → https://hub.nimiq-testnet.com
 */

export interface ConnectedAccount {
  address: string;
  label: string;
}

const APP_NAME = 'Nimiq PoW Faucet';

function endpointFor(network: FaucetConfig['network'] | undefined): string {
  return network === 'test'
    ? 'https://hub.nimiq-testnet.com'
    : 'https://hub.nimiq.com';
}

export interface UseHubResult {
  account: Ref<ConnectedAccount | null>;
  isConnecting: Ref<boolean>;
  errorMessage: Ref<string | null>;
  /** Open the Hub popup and let the user pick an address. */
  connect(): Promise<void>;
  /** Forget the chosen address (the Hub itself doesn't keep a session here). */
  disconnect(): void;
}

export function useHub(network: Ref<FaucetConfig['network'] | undefined>): UseHubResult {
  const account = ref<ConnectedAccount | null>(null);
  const isConnecting = ref(false);
  const errorMessage = ref<string | null>(null);

  async function connect(): Promise<void> {
    if (isConnecting.value) return;
    isConnecting.value = true;
    errorMessage.value = null;
    try {
      const hub = new HubApi(endpointFor(network.value));
      const result: ChooseAddressResult = await hub.chooseAddress({ appName: APP_NAME });
      account.value = {
        address: result.address,
        label: result.meta?.account?.label || result.label || 'Nimiq account',
      };
    } catch (err) {
      // Common rejections: user closed the popup, popup blocked, etc.
      // The Hub returns Error objects with descriptive messages already.
      const msg = err instanceof Error ? err.message : String(err);
      // Distinguish user cancellation (which we silence) from real errors.
      if (/cancel|reject|user.{0,12}clos/i.test(msg)) {
        errorMessage.value = null;
      } else {
        errorMessage.value = msg;
      }
    } finally {
      isConnecting.value = false;
    }
  }

  function disconnect(): void {
    account.value = null;
    errorMessage.value = null;
  }

  return { account, isConnecting, errorMessage, connect, disconnect };
}
