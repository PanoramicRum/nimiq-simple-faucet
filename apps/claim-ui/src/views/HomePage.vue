<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  FaucetError,
  type ClaimResponse,
  type FaucetConfig,
} from '@nimiq-faucet/sdk';
import { useClient } from '../lib/client';
import { isValidNimiqAddress, normalizeNimiqAddress } from '../lib/validate';
import { t } from '../i18n/en';
import TurnstileWidget from '../components/TurnstileWidget.vue';
import HCaptchaWidget from '../components/HCaptchaWidget.vue';
import HashcashRunner from '../components/HashcashRunner.vue';
import ClaimStatus from '../components/ClaimStatus.vue';

const client = useClient();

const config = ref<FaucetConfig | null>(null);
const configError = ref<string | null>(null);
const address = ref('');
const captchaToken = ref('');
const hashcashSolution = ref('');
const submitting = ref(false);
const claimResponse = ref<ClaimResponse | null>(null);
const claimError = ref<FaucetError | Error | null>(null);

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
  <main class="flex-grow flex flex-col items-center justify-center px-6 py-24 md:py-32 w-full max-w-3xl mx-auto">
    <!-- Mascot / Claim Button -->
    <div class="mb-10">
      <button
        type="button"
        data-testid="claim-cat"
        :disabled="!canSubmit"
        :aria-busy="submitting"
        class="w-40 h-40 md:w-48 md:h-48 rounded-full ring-4 flex items-center justify-center text-6xl transition-all duration-300"
        :class="canSubmit
          ? 'bg-surface-container-high ring-primary-container cursor-pointer hover:scale-105 active:scale-95 hover:ring-primary'
          : 'bg-surface-container-high ring-surface-container-low opacity-50 cursor-not-allowed'"
        @click="submit"
      >
        🐱
      </button>
    </div>

    <!-- Hero Typography -->
    <div class="text-center mb-12 space-y-6 max-w-xl">
      <h1 class="text-5xl md:text-6xl font-extrabold text-on-surface font-headline tracking-tight leading-tight">
        Nimiq Faucet
      </h1>
      <p class="text-xl md:text-2xl text-on-surface-variant font-body font-light leading-relaxed">
        <span v-if="config">Click The Cat to Receive 1 {{ config.network === 'main' ? '' : 'Testnet ' }}NIM</span>
        <span v-else-if="configError" class="text-error">{{ configError }}</span>
        <span v-else>&nbsp;</span>
      </p>
    </div>

    <!-- Claim Form -->
    <div class="w-full max-w-2xl mx-auto">
      <form class="flex flex-col gap-8 w-full" @submit.prevent="submit">
        <div class="space-y-4 w-full text-center">
          <input
            id="nq-address"
            v-model="address"
            type="text"
            autocomplete="off"
            autocapitalize="characters"
            spellcheck="false"
            inputmode="text"
            placeholder="NQXX  XXXX  XXXX  XXXX  XXXX  XXXX  XXXX  XXXX  XXXX"
            :aria-invalid="showAddressError"
            :aria-describedby="showAddressError ? 'nq-address-error' : undefined"
            class="block w-full px-6 py-6 rounded-2xl font-mono text-base tracking-widest text-center transition-all duration-300 bg-surface-container-lowest focus:outline-none focus:ring-1 focus:ring-primary-container placeholder:text-on-surface-variant/40"
            :class="showAddressError ? 'ring-2 ring-error' : ''"
          />
          <p v-if="showAddressError" id="nq-address-error" class="text-xs text-error font-body ml-1">
            {{ t('addressInvalid') }}
          </p>
          <p v-else class="text-xs text-on-surface-variant/60 font-body">
            Enter a valid Nimiq {{ config?.network === 'main' ? '' : 'Testnet ' }}address to receive funds.
          </p>
        </div>

        <!-- Challenge widgets -->
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
          @solved="(s: string) => (hashcashSolution = s)"
        />

        <ClaimStatus
          v-if="config"
          :network="config.network"
          :claim-id="claimResponse?.id ?? null"
          :initial="claimResponse"
          :error="claimError"
          @retry="reset"
        />
      </form>
    </div>
  </main>
</template>
