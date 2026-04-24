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
import FCaptchaWidget from '../components/FCaptchaWidget.vue';
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

// Which challenge layers are active (multiple can be enabled simultaneously).
const needsCaptcha = computed(() => !!config.value?.captcha);
const captchaProvider = computed(() => config.value?.captcha?.provider ?? null);
const needsHashcash = computed(() => !!config.value?.hashcash);

const addressValid = computed(() => isValidNimiqAddress(address.value));
const addressTouched = computed(() => address.value.trim().length > 0);
const showAddressError = computed(() => addressTouched.value && !addressValid.value);

const challengeSatisfied = computed(() => {
  // Wait for config to load before allowing submission.
  if (!config.value) return false;
  // ALL enabled challenges must be satisfied.
  if (needsCaptcha.value && captchaToken.value.length === 0) return false;
  if (needsHashcash.value && hashcashSolution.value.length === 0) return false;
  return true;
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
        aria-label="Claim NIM"
        class="cat-btn rounded-full ring-4 overflow-hidden transition-all duration-300"
        :class="[
          submitting ? 'cat-btn--loading' : '',
          canSubmit
            ? 'ring-primary-container cursor-pointer hover:ring-primary'
            : 'ring-surface-container-low grayscale opacity-60 cursor-not-allowed',
        ]"
        @click="submit"
      >
        <img
          src="/cat.png"
          alt="Maneki-Neko"
          class="w-40 h-40 md:w-48 md:h-48 object-cover pointer-events-none select-none"
          draggable="false"
        />
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
            class="block w-full px-6 py-6 rounded-2xl font-mono text-base tracking-widest text-center transition-all duration-300 bg-surface-container-lowest focus:outline-none focus:ring-1 focus:ring-primary-container placeholder:text-on-surface-variant/60"
            :class="showAddressError ? 'ring-2 ring-error' : ''"
          />
          <p v-if="showAddressError" id="nq-address-error" class="text-xs text-error font-body ml-1">
            {{ t('addressInvalid') }}
          </p>
          <p v-else class="text-xs text-on-surface-variant font-body">
            Enter a valid Nimiq {{ config?.network === 'main' ? '' : 'Testnet ' }}address to receive funds.
          </p>
        </div>

        <!-- Challenge widgets — render ALL active layers after valid address -->
        <template v-if="addressValid">
          <TurnstileWidget
            v-if="captchaProvider === 'turnstile' && config?.captcha"
            :site-key="config.captcha.siteKey"
            v-model="captchaToken"
          />
          <HCaptchaWidget
            v-else-if="captchaProvider === 'hcaptcha' && config?.captcha"
            :site-key="config.captcha.siteKey"
            v-model="captchaToken"
          />
          <FCaptchaWidget
            v-else-if="captchaProvider === 'fcaptcha' && config?.captcha?.serverUrl"
            :site-key="config.captcha.siteKey"
            :server-url="config.captcha.serverUrl"
            v-model="captchaToken"
          />
          <HashcashRunner
            v-if="needsHashcash && config?.hashcash"
            :difficulty="config.hashcash.difficulty"
            @solved="(s: string) => (hashcashSolution = s)"
          />
        </template>

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

<style scoped>
.cat-btn {
  transition: transform 0.3s, filter 0.3s, box-shadow 0.3s;
}

/* Idle hover: gentle float up */
.cat-btn:not(:disabled):hover {
  transform: scale(1.06);
  box-shadow: 0 10px 40px rgba(233, 178, 19, 0.15);
}

/* Click: press down */
.cat-btn:not(:disabled):active {
  transform: scale(0.94);
}

/* Loading: slow pulse while claim is in flight */
.cat-btn--loading {
  animation: cat-pulse 1.2s ease-in-out infinite;
}

@keyframes cat-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.04); opacity: 0.85; }
}
</style>
