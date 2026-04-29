import { computed, reactive, ref, shallowRef, type Ref } from 'vue';
import { FaucetClient } from '@nimiq-faucet/sdk';
import {
  connectMiniApp,
  getUserAddress,
  type MiniAppConnectionState,
} from '@nimiq-faucet/mini-app-claim-shared';

export type Phase =
  | 'connecting'
  | 'outside-nimiq-pay'
  | 'ready'
  | 'awaiting-address'
  | 'awaiting-captcha'
  | 'submitting'
  | 'broadcast'
  | 'confirmed'
  | 'rejected'
  | 'challenged'
  | 'error';

export interface CaptchaPrompt {
  serverUrl: string;
  siteKey: string;
  resolve: (token: string) => void;
  reject: (err: Error) => void;
}

export interface MiniAppFaucetState {
  phase: Phase;
  address: string | null;
  txId: string | null;
  errorMessage: string | null;
  outsideReason: string | null;
}

export function useMiniAppFaucet(faucetUrl: string) {
  const state = reactive<MiniAppFaucetState>({
    phase: 'connecting',
    address: null,
    txId: null,
    errorMessage: null,
    outsideReason: null,
  });

  const conn = shallowRef<MiniAppConnectionState | null>(null);
  const captchaPrompt: Ref<CaptchaPrompt | null> = ref(null);
  const client = new FaucetClient({ url: faucetUrl });
  // In-flight guard: a fast double-tap on the claim button can fire two
  // parallel `claim()` calls before the phase transitions disable the
  // button (Vue's reactive flush is async). The second call would prompt
  // the wallet for the address a second time and confuse the user. Lock
  // here in addition to the UI-level disable.
  let inFlight = false;

  void connectMiniApp().then((next) => {
    conn.value = next;
    if (next.status === 'ready') {
      state.phase = 'ready';
    } else if (next.status === 'outside-nimiq-pay') {
      state.phase = 'outside-nimiq-pay';
      state.outsideReason = next.reason;
    }
  });

  async function fetchCaptchaToken(): Promise<string | undefined> {
    const config = await client.config();
    if (!config.captcha) return undefined;
    if (config.captcha.provider !== 'fcaptcha') {
      throw new Error(
        `This example only renders fcaptcha; faucet is configured for ${config.captcha.provider}.`,
      );
    }
    if (!config.captcha.serverUrl) {
      throw new Error('faucet returned fcaptcha provider without serverUrl');
    }
    state.phase = 'awaiting-captcha';
    return new Promise<string>((resolve, reject) => {
      captchaPrompt.value = {
        serverUrl: config.captcha!.serverUrl!,
        siteKey: config.captcha!.siteKey,
        resolve: (token) => {
          captchaPrompt.value = null;
          resolve(token);
        },
        reject: (err) => {
          captchaPrompt.value = null;
          reject(err);
        },
      };
    });
  }

  async function claim(): Promise<void> {
    if (inFlight) return;
    if (!conn.value || conn.value.status !== 'ready') return;
    inFlight = true;
    state.errorMessage = null;
    state.txId = null;
    try {
      state.phase = 'awaiting-address';
      const address = await getUserAddress(conn.value.provider);
      state.address = address;
      const captchaToken = await fetchCaptchaToken();
      state.phase = 'submitting';
      const initialOpts: { captchaToken?: string } = captchaToken ? { captchaToken } : {};
      const initial = await client.claim(address, initialOpts);
      state.txId = initial.txId ?? null;
      if (initial.status === 'rejected') {
        state.phase = 'rejected';
        state.errorMessage = initial.reason ?? 'Claim rejected';
        return;
      }
      if (initial.status === 'challenged') {
        state.phase = 'challenged';
        state.errorMessage = initial.reason ?? 'Captcha required';
        return;
      }
      state.phase = 'broadcast';
      const final = await client.waitForConfirmation(initial.id);
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
    state.phase = conn.value?.status === 'ready' ? 'ready' : 'connecting';
    state.address = null;
    state.txId = null;
    state.errorMessage = null;
    captchaPrompt.value = null;
  }

  const canClaim = computed(
    () => state.phase === 'ready' || state.phase === 'rejected' || state.phase === 'error' || state.phase === 'confirmed',
  );

  return { state, captchaPrompt, claim, reset, canClaim };
}
