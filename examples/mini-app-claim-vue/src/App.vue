<script setup lang="ts">
import { computed } from 'vue';
import { translate } from '@nimiq-faucet/mini-app-claim-shared';
import { useMiniAppFaucet } from './composables/useMiniAppFaucet';
import FcaptchaWidget from './components/FcaptchaWidget.vue';

const faucetUrl = import.meta.env.VITE_FAUCET_URL ?? 'http://localhost:8080';
const explorerBase = import.meta.env.VITE_EXPLORER_URL ?? 'https://nimiq-testnet.observer/#tx/';

const { state, captchaPrompt, claim, reset, canClaim } = useMiniAppFaucet(faucetUrl);

const t = (key: Parameters<typeof translate>[0]) => translate(key);

const buttonLabel = computed(() => {
  switch (state.phase) {
    case 'awaiting-address':
    case 'awaiting-captcha':
    case 'submitting':
    case 'broadcast':
      return t('claiming');
    default:
      return t('claim');
  }
});

const explorerUrl = computed(() => (state.txId ? `${explorerBase}${state.txId}` : null));
</script>

<template>
  <h1 class="title">{{ t('title') }}</h1>
  <p class="subtitle">{{ t('subtitle') }}</p>

  <div v-if="state.phase === 'connecting'" class="card">
    <span><span class="spinner" />{{ t('connecting') }}</span>
  </div>

  <div v-else-if="state.phase === 'outside-nimiq-pay'" class="card">
    <strong>{{ t('outsidePay') }}</strong>
    <p class="subtitle">{{ t('outsidePayHint') }}</p>
    <p v-if="state.outsideReason" class="subtitle"><small>{{ state.outsideReason }}</small></p>
  </div>

  <template v-else>
    <div v-if="state.address" class="card">
      <span class="label">{{ t('addressFromWallet') }}</span>
      <span class="address">{{ state.address }}</span>
    </div>

    <FcaptchaWidget
      v-if="captchaPrompt"
      :server-url="captchaPrompt.serverUrl"
      :site-key="captchaPrompt.siteKey"
      @solved="captchaPrompt.resolve($event)"
      @failed="captchaPrompt.reject($event)"
    />

    <p v-if="state.phase === 'awaiting-captcha'" class="subtitle">
      {{ t('awaitingCaptcha') }}
    </p>

    <button
      class="btn"
      :disabled="!canClaim"
      @click="claim"
    >
      <span v-if="state.phase !== 'ready' && state.phase !== 'rejected' && state.phase !== 'error' && state.phase !== 'confirmed'" class="spinner" />
      {{ buttonLabel }}
    </button>

    <div v-if="state.phase === 'broadcast'" class="banner warn">
      <span class="spinner" />{{ t('broadcast') }}
    </div>

    <div v-else-if="state.phase === 'confirmed'" class="banner good">
      <strong>{{ t('confirmed') }}</strong>
      <p v-if="state.txId" class="tx">{{ t('txLabel') }}: {{ state.txId }}</p>
      <a v-if="explorerUrl" :href="explorerUrl" target="_blank" rel="noopener" class="link">
        {{ t('explorerLink') }} →
      </a>
    </div>

    <div v-else-if="state.phase === 'rejected' || state.phase === 'challenged'" class="banner bad">
      <strong>{{ state.phase === 'challenged' ? t('challenged') : t('rejected') }}</strong>
      <p v-if="state.errorMessage" class="tx">{{ state.errorMessage }}</p>
      <button class="btn" @click="reset">{{ t('retry') }}</button>
    </div>

    <div v-else-if="state.phase === 'error'" class="banner bad">
      <strong>{{ t('error') }}</strong>
      <p v-if="state.errorMessage" class="tx">{{ state.errorMessage }}</p>
      <button class="btn" @click="reset">{{ t('retry') }}</button>
    </div>
  </template>
</template>
