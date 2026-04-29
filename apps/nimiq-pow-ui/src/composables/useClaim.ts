import { reactive, ref } from 'vue';
import { FaucetClient, type FaucetConfig, type ClaimResponse } from '@nimiq-faucet/sdk';

/**
 * NimiqPoW theme's claim composable. Bypasses `useFaucetClaim` because
 * we want to interleave hashcash + captcha prep before the actual
 * claim — same pattern used in examples/vue-claim-page after the
 * §3.0.7 abuse-layer integration. The visual peer-mining loop is
 * decorative; this is the real claim flow.
 */

export type Phase =
  | 'idle'
  | 'loading-config'
  | 'submitting'
  | 'solving-hashcash'
  | 'broadcast'
  | 'confirmed'
  | 'rejected'
  | 'error';

export interface ClaimState {
  phase: Phase;
  txId: string | null;
  errorMessage: string | null;
  hashcashAttempts: number;
}

export function useClaim() {
  const faucetUrl = import.meta.env.VITE_FAUCET_URL || window.location.origin;
  const client = new FaucetClient({ url: faucetUrl });

  const config = ref<FaucetConfig | null>(null);
  const state = reactive<ClaimState>({
    phase: 'loading-config',
    txId: null,
    errorMessage: null,
    hashcashAttempts: 0,
  });
  let inFlight = false;

  void client.config().then(
    (cfg) => {
      config.value = cfg;
      state.phase = 'idle';
    },
    (err) => {
      state.phase = 'error';
      state.errorMessage = err instanceof Error ? err.message : String(err);
    },
  );

  async function claim(address: string): Promise<void> {
    if (inFlight) return;
    if (!address.trim()) return;
    inFlight = true;
    state.errorMessage = null;
    state.txId = null;
    state.hashcashAttempts = 0;

    try {
      let result: ClaimResponse;
      if (config.value?.hashcash) {
        state.phase = 'solving-hashcash';
        result = await client.solveAndClaim(address.trim(), {
          uid: 'nimiq-pow-ui',
          hostContext: { uid: 'nimiq-pow-ui' },
          onProgress: (n) => {
            state.hashcashAttempts = n;
          },
        });
      } else {
        state.phase = 'submitting';
        result = await client.claim(address.trim(), {
          hostContext: { uid: 'nimiq-pow-ui' },
        });
      }
      state.phase = 'submitting';
      state.txId = result.txId ?? null;
      if (result.status === 'rejected' || result.status === 'challenged') {
        state.phase = 'rejected';
        state.errorMessage = result.reason ?? 'Claim rejected';
        return;
      }
      state.phase = 'broadcast';
      const final = await client.waitForConfirmation(result.id);
      state.txId = final.txId ?? state.txId;
      state.phase = final.status === 'confirmed' ? 'confirmed' : 'rejected';
      if (final.status === 'rejected' && final.reason) {
        state.errorMessage = final.reason;
      }
    } catch (err) {
      state.phase = 'error';
      state.errorMessage = err instanceof Error ? err.message : String(err);
    } finally {
      inFlight = false;
    }
  }

  function reset(): void {
    state.phase = config.value ? 'idle' : 'loading-config';
    state.txId = null;
    state.errorMessage = null;
    state.hashcashAttempts = 0;
  }

  return { config, state, claim, reset };
}
