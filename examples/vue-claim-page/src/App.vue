<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { FaucetClient, type ClaimResponse } from '@nimiq-faucet/vue';
import type { FaucetConfig } from '@nimiq-faucet/sdk';

/**
 * §3.0.7 abuse-layer demo — Vue 3.
 *
 * Demonstrates the four abuse-layer surfaces the faucet supports:
 *   1. Captcha widget (Turnstile or hCaptcha) — driven by `/v1/config`.
 *   2. Hashcash proof-of-work — `client.solveAndClaim()` does the round trip.
 *   3. `hostContext` — passed on every claim. Production frontends should
 *      send a *signed* hostContext minted by their backend (see README §
 *      "Abuse layers" — `FaucetClient.signHostContext` is the helper).
 *   4. Fingerprint — out of scope here; see the Capacitor/RN examples.
 *
 * `useFaucetClaim` from `@nimiq-faucet/vue` is the simpler shape for
 * uid-only flows; we bypass it here so we can interleave the captcha +
 * hashcash steps before calling `client.claim`. The composable's source
 * (packages/sdk-vue/src/index.ts) is a 30-line wrapper over `client.claim`,
 * so this manual path stays close in spirit and easy to compare.
 */

const faucetUrl = import.meta.env.VITE_FAUCET_URL || 'http://localhost:8080';
const integratorId = import.meta.env.VITE_INTEGRATOR_ID || 'vue-example';
const client = new FaucetClient({ url: faucetUrl });

type Phase = 'idle' | 'loading-config' | 'awaiting-captcha' | 'solving-hashcash' | 'submitting' | 'broadcast' | 'confirmed' | 'rejected' | 'error';

const phase = ref<Phase>('loading-config');
const address = ref('');
const config = ref<FaucetConfig | null>(null);
const captchaToken = ref<string | null>(null);
const hashcashAttempts = ref(0);
const txId = ref<string | null>(null);
const errorMessage = ref<string | null>(null);

const isPending = computed(() => ['loading-config', 'solving-hashcash', 'submitting', 'broadcast'].includes(phase.value));
const captchaRequired = computed(() => Boolean(config.value?.captcha));
const captchaSatisfied = computed(() => !captchaRequired.value || captchaToken.value !== null);
const canSubmit = computed(() => phase.value !== 'submitting' && phase.value !== 'broadcast' && phase.value !== 'solving-hashcash' && address.value.trim().length > 0 && captchaSatisfied.value);

const statusLabel = computed(() => {
  switch (phase.value) {
    case 'loading-config': return 'Reading server config…';
    case 'awaiting-captcha': return captchaRequired.value && !captchaToken.value ? 'Solve the captcha to continue.' : '';
    case 'solving-hashcash': return `Proof-of-work: ${hashcashAttempts.value.toLocaleString()} attempts…`;
    case 'submitting': return 'Submitting claim…';
    case 'broadcast': return 'Broadcast — waiting for confirmation…';
    case 'confirmed': return 'Confirmed!';
    case 'rejected': return 'Rejected';
    case 'error': return 'Something went wrong.';
    default: return '';
  }
});

onMounted(async () => {
  try {
    const cfg = await client.config();
    config.value = cfg;
    phase.value = cfg.captcha ? 'awaiting-captcha' : 'idle';
    if (cfg.captcha) await loadCaptchaWidget(cfg);
  } catch (err) {
    phase.value = 'error';
    errorMessage.value = err instanceof Error ? err.message : String(err);
  }
});

type CaptchaProvider = 'turnstile' | 'hcaptcha';

interface CaptchaLib {
  render: (el: HTMLElement, opts: Record<string, unknown>) => unknown;
}
type CaptchaWindow = Window & { turnstile?: CaptchaLib; hcaptcha?: CaptchaLib };

async function loadCaptchaWidget(cfg: FaucetConfig) {
  if (!cfg.captcha) return;
  const provider = cfg.captcha.provider;
  if (provider === 'fcaptcha') {
    // FCaptcha is the WebView/mini-app path; the standalone web example
    // doesn't render its widget — see examples/mini-app-claim-* for that.
    errorMessage.value = 'This example renders Turnstile/hCaptcha; the faucet returned fcaptcha. See examples/mini-app-claim-* instead.';
    return;
  }
  const src = provider === 'turnstile'
    ? 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    : 'https://js.hcaptcha.com/1/api.js?render=explicit';
  await injectScript(src, `data-${provider}`);
  renderCaptchaWidget(provider, cfg.captcha.siteKey);
}

function renderCaptchaWidget(provider: CaptchaProvider, siteKey: string) {
  const host = document.getElementById('captcha-host');
  if (!host) return;
  const w = window as CaptchaWindow;
  const lib = provider === 'turnstile' ? w.turnstile : w.hcaptcha;
  if (!lib) return;
  lib.render(host, {
    sitekey: siteKey,
    callback: (token: string) => { captchaToken.value = token; },
    'error-callback': () => { captchaToken.value = null; errorMessage.value = 'Captcha widget reported an error'; },
    'expired-callback': () => { captchaToken.value = null; },
  });
}

function injectScript(src: string, marker: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[${marker}]`);
    if (existing) { resolve(); return; }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    script.setAttribute(marker, 'true');
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
    document.head.appendChild(script);
  });
}

async function handleSubmit() {
  if (!canSubmit.value) return;
  errorMessage.value = null;
  txId.value = null;

  // hostContext: production frontends should send a SIGNED context minted
  // by their backend (FaucetClient.signHostContext + integrator HMAC secret).
  // The example sends a plain uid to keep the demo runnable without a backend.
  const hostContext = { uid: integratorId };

  try {
    let result: ClaimResponse;
    if (config.value?.hashcash) {
      phase.value = 'solving-hashcash';
      hashcashAttempts.value = 0;
      result = await client.solveAndClaim(address.value.trim(), {
        uid: integratorId,
        hostContext,
        captchaToken: captchaToken.value ?? undefined,
        onProgress: (n) => { hashcashAttempts.value = n; },
      });
    } else {
      phase.value = 'submitting';
      result = await client.claim(address.value.trim(), {
        hostContext,
        captchaToken: captchaToken.value ?? undefined,
      });
    }
    phase.value = 'submitting';
    txId.value = result.txId ?? null;
    if (result.status === 'rejected') {
      phase.value = 'rejected';
      errorMessage.value = result.reason ?? 'Claim rejected';
      return;
    }
    if (result.status === 'challenged') {
      phase.value = 'rejected';
      errorMessage.value = result.reason ?? 'Captcha challenge required';
      return;
    }
    phase.value = 'broadcast';
    const final = await client.waitForConfirmation(result.id);
    txId.value = final.txId ?? txId.value;
    phase.value = final.status === 'confirmed' ? 'confirmed' : 'rejected';
    if (final.status === 'rejected' && final.reason) errorMessage.value = final.reason;
  } catch (err) {
    phase.value = 'error';
    errorMessage.value = err instanceof Error ? err.message : String(err);
  }
}

function reset() {
  phase.value = config.value?.captcha ? 'awaiting-captcha' : 'idle';
  txId.value = null;
  errorMessage.value = null;
  hashcashAttempts.value = 0;
  // Captcha tokens are single-shot — clearing forces re-solve on retry.
  captchaToken.value = null;
}
</script>

<template>
  <main class="container">
    <h1>Nimiq Faucet</h1>
    <p class="subtitle">Claim free NIM on testnet (with abuse-layer demo)</p>

    <form @submit.prevent="handleSubmit" class="claim-form">
      <label for="address">Nimiq Address</label>
      <input
        id="address"
        v-model="address"
        type="text"
        placeholder="NQ00 0000 0000 0000 0000 0000 0000 0000 0000"
        :disabled="isPending"
        autocomplete="off"
        spellcheck="false"
      />

      <div v-if="config?.captcha && config.captcha.provider !== 'fcaptcha'" class="captcha-block">
        <p class="captcha-label">{{ config.captcha.provider === 'turnstile' ? 'Cloudflare Turnstile' : 'hCaptcha' }}</p>
        <div id="captcha-host" />
      </div>

      <p v-if="config?.hashcash" class="hashcash-note">
        Hashcash difficulty {{ config.hashcash.difficulty }} bits — solved in your browser.
      </p>

      <button type="submit" :disabled="!canSubmit">
        {{ isPending ? 'Claiming…' : 'Claim NIM' }}
      </button>
    </form>

    <div v-if="statusLabel" class="status" :class="phase">
      <p>{{ statusLabel }}</p>
      <p v-if="txId" class="tx">TX: <code>{{ txId }}</code></p>
    </div>

    <div v-if="errorMessage" class="error">
      <p>{{ errorMessage }}</p>
      <button @click="reset" class="retry">Try again</button>
    </div>
  </main>
</template>

<style>
* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: system-ui, -apple-system, sans-serif;
  background: #f5f6fa;
  color: #1f2348;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}

.container { max-width: 480px; width: 100%; padding: 2rem; }

h1 { font-size: 1.75rem; margin-bottom: 0.25rem; }

.subtitle { color: #6b7280; margin-bottom: 2rem; }

.claim-form { display: flex; flex-direction: column; gap: 0.75rem; }

label { font-weight: 600; font-size: 0.875rem; }

input {
  padding: 0.75rem;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  font-size: 0.875rem;
  font-family: monospace;
  outline: none;
  transition: border-color 0.15s;
}

input:focus { border-color: #1f2348; }

button {
  padding: 0.75rem;
  border: none;
  border-radius: 8px;
  background: #1f2348;
  color: #fff;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
}

button:disabled { opacity: 0.5; cursor: not-allowed; }
button:not(:disabled):hover { opacity: 0.85; }

.captcha-block {
  margin-top: 0.5rem;
  padding: 0.75rem;
  background: #f0f1f9;
  border-radius: 8px;
}

.captcha-label { font-size: 0.75rem; color: #6b7280; margin-bottom: 0.5rem; }

.hashcash-note {
  font-size: 0.75rem;
  color: #6b7280;
  margin-top: -0.25rem;
  font-style: italic;
}

.status { margin-top: 1.5rem; padding: 1rem; border-radius: 8px; background: #e8eaf6; }
.status.confirmed { background: #d1fae5; color: #065f46; }
.status.rejected { background: #fee2e2; color: #991b1b; }
.status.solving-hashcash { background: #fef3c7; color: #78350f; }

.tx { margin-top: 0.5rem; font-size: 0.8rem; word-break: break-all; }

.error {
  margin-top: 1.5rem;
  padding: 1rem;
  border-radius: 8px;
  background: #fee2e2;
  color: #991b1b;
}

.retry { margin-top: 0.75rem; background: #991b1b; font-size: 0.875rem; padding: 0.5rem 1rem; }
</style>
