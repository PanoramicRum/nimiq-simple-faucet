# Vue

The `@nimiq-faucet/vue` package wraps the TypeScript SDK in a Composition API
composable. Works with Vue 3, Nuxt 3, and Vite.

## Install

```bash
pnpm add @nimiq-faucet/vue
```

## Add a claim button

```vue
<script setup lang="ts">
import { useFaucetClaim } from '@nimiq-faucet/vue';

const props = defineProps<{ address: string; uidHash?: string }>();

const { claim, status, error, result } = useFaucetClaim({
  url: import.meta.env.VITE_FAUCET_URL,
  address: () => props.address,
  hostContext: () => ({ uid: props.uidHash, kycLevel: 'email' }),
});
</script>

<template>
  <button :disabled="status === 'pending'" @click="claim">
    <span v-if="status === 'idle'">Claim free NIM</span>
    <span v-else-if="status === 'pending'">Claiming...</span>
    <span v-else-if="status === 'confirmed'">Sent: {{ result?.txId }}</span>
    <span v-if="error" role="alert">{{ error.message }}</span>
  </button>
</template>
```

The `address` and `hostContext` getters are re-evaluated reactively; changing
the prop re-arms the composable without a remount.

## Nuxt 3

Register a plugin so every page shares one client:

```ts
// plugins/faucet.client.ts
import { createFaucet } from '@nimiq-faucet/vue';

export default defineNuxtPlugin((nuxt) => {
  nuxt.vueApp.use(createFaucet({ url: useRuntimeConfig().public.faucetUrl }));
});
```

## Live snippet URL

| Version | URL | Notes |
| --- | --- | --- |
| `latest` | `/snippets/vue` | TODO: generated at release (M9). |
