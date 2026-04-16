<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  FaucetError,
  type ClaimResponse,
  type FaucetConfig,
} from '@nimiq-faucet/sdk';
import { useClient } from './lib/client';
import { isValidNimiqAddress, normalizeNimiqAddress } from './lib/validate';
import { t } from './i18n/en';
import TurnstileWidget from './components/TurnstileWidget.vue';
import HCaptchaWidget from './components/HCaptchaWidget.vue';
import HashcashRunner from './components/HashcashRunner.vue';
import ClaimStatus from './components/ClaimStatus.vue';

const client = useClient();

const config = ref<FaucetConfig | null>(null);
const configError = ref<string | null>(null);
const address = ref('');
const captchaToken = ref('');
const hashcashSolution = ref('');
const submitting = ref(false);
const claimResponse = ref<ClaimResponse | null>(null);
const claimError = ref<FaucetError | Error | null>(null);

// Prefer the strongest challenge the server advertises. This mirrors the
// priority documented in M4.2: turnstile > hcaptcha > hashcash.
const challengeKind = computed<'turnstile' | 'hcaptcha' | 'hashcash' | null>(() => {
  const c = config.value;
  if (!c) return null;
  if (c.captcha?.provider === 'turnstile') return 'turnstile';
  if (c.captcha?.provider === 'hcaptcha') return 'hcaptcha';
  if (c.hashcash) return 'hashcash';
  return null;
});

const addressValid = computed(() => isValidNimiqAddress(address.value));
const addressTouched = computed(() => address.value.trim().length > 0);
const showAddressError = computed(() => addressTouched.value && !addressValid.value);

const challengeSatisfied = computed(() => {
  switch (challengeKind.value) {
    case 'turnstile':
    case 'hcaptcha':
      return captchaToken.value.length > 0;
    case 'hashcash':
      return hashcashSolution.value.length > 0;
    default:
      return true;
  }
});

const canSubmit = computed(
  () => addressValid.value && challengeSatisfied.value && !submitting.value,
);

onMounted(async () => {
  try {
    config.value = await client.config();
  } catch (err) {
    configError.value = (err as Error).message;
  }
});

function resetChallenge() {
  captchaToken.value = '';
  hashcashSolution.value = '';
}

function reset() {
  claimResponse.value = null;
  claimError.value = null;
  resetChallenge();
}

async function submit() {
  if (!canSubmit.value) return;
  submitting.value = true;
  claimResponse.value = null;
  claimError.value = null;
  try {
    const opts: Parameters<typeof client.claim>[1] = {};
    if (captchaToken.value) opts.captchaToken = captchaToken.value;
    if (hashcashSolution.value) opts.hashcashSolution = hashcashSolution.value;
    const res = await client.claim(normalizeNimiqAddress(address.value), opts);
    claimResponse.value = res;
    if (res.status === 'rejected' || res.status === 'challenged') {
      resetChallenge();
    }
  } catch (err) {
    claimError.value = err as FaucetError | Error;
    resetChallenge();
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="mx-auto flex min-h-full max-w-xl flex-col gap-6 px-4 py-10 sm:py-16">
    <header class="space-y-1">
      <h1 class="text-2xl font-semibold tracking-tight">{{ t('title') }}</h1>
      <p class="text-sm text-[color:var(--color-muted)]">
        <span v-if="config">{{ t('subtitleNetwork', { network: config.network }) }}</span>
        <span v-else-if="configError" class="text-[color:var(--color-danger)]">{{ configError }}</span>
        <span v-else>&nbsp;</span>
      </p>
    </header>

    <main
      class="rounded-2xl border border-[color:var(--color-card-border)] bg-[color:var(--color-card-bg)] p-5 shadow-sm sm:p-6"
    >
      <form class="space-y-4" @submit.prevent="submit">
        <div class="space-y-1">
          <label for="nq-address" class="block text-sm font-medium">
            {{ t('addressLabel') }}
          </label>
          <input
            id="nq-address"
            v-model="address"
            type="text"
            autocomplete="off"
            autocapitalize="characters"
            spellcheck="false"
            inputmode="text"
            :placeholder="t('addressPlaceholder')"
            :aria-invalid="showAddressError"
            :aria-describedby="showAddressError ? 'nq-address-error' : undefined"
            class="focus-ring w-full rounded-lg border bg-[color:var(--color-input-bg)] px-3 py-2 text-sm font-mono"
            :class="showAddressError
              ? 'border-[color:var(--color-danger)]'
              : 'border-[color:var(--color-input-border)]'"
          />
          <p
            v-if="showAddressError"
            id="nq-address-error"
            class="text-xs text-[color:var(--color-danger)]"
          >
            {{ t('addressInvalid') }}
          </p>
        </div>

        <TurnstileWidget
          v-if="challengeKind === 'turnstile' && config?.captcha"
          :site-key="config.captcha.siteKey"
          v-model="captchaToken"
        />
        <HCaptchaWidget
          v-else-if="challengeKind === 'hcaptcha' && config?.captcha"
          :site-key="config.captcha.siteKey"
          v-model="captchaToken"
        />
        <HashcashRunner
          v-else-if="challengeKind === 'hashcash' && config?.hashcash"
          :difficulty="config.hashcash.difficulty"
          @solved="(s) => (hashcashSolution = s)"
        />

        <button
          type="submit"
          :disabled="!canSubmit"
          :aria-busy="submitting"
          class="focus-ring inline-flex w-full items-center justify-center rounded-lg bg-nimiq-500 px-4 py-2 text-sm font-semibold text-black shadow-sm hover:bg-nimiq-400 disabled:cursor-not-allowed disabled:bg-nimiq-500/40 disabled:text-black/60"
        >
          {{ submitting ? t('claiming') : t('claim') }}
        </button>

        <ClaimStatus
          v-if="config"
          :network="config.network"
          :claim-id="claimResponse?.id ?? null"
          :initial="claimResponse"
          :error="claimError"
          @retry="reset"
        />
      </form>
    </main>

    <footer class="flex items-center justify-between text-xs text-[color:var(--color-muted)]">
      <span>{{ t('footer.poweredBy') }}</span>
      <a
        href="#"
        class="focus-ring underline underline-offset-2"
        :aria-label="t('footer.repo')"
      >
        {{ t('footer.repo') }}
      </a>
    </footer>
  </div>
</template>
