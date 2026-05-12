<script setup lang="ts">
import { computed, ref } from 'vue';
import { useFaucetClaim } from '@nimiq-faucet/vue';

// The faucet URL the browser hits. Override with VITE_FAUCET_URL.
const FAUCET_URL = import.meta.env.VITE_FAUCET_URL ?? 'http://localhost:8080';

const address = ref('');

// `useFaucetClaim` reads `args.address` at claim time, so expose the ref
// via a getter to keep the typed-in value live.
const { status, txId, error, isPending, claim, reset } = useFaucetClaim({
  client: { url: FAUCET_URL },
  get address() {
    return address.value;
  },
});

// `status` walks: idle → pending → broadcast → confirmed (or rejected).
// `isPending` covers only the initial submit; include the polling states.
const busy = computed(() => isPending.value || status.value === 'broadcast' || status.value === 'queued');
</script>

<template>
  <main style="font-family: system-ui, sans-serif; max-width: 480px; margin: 4rem auto; padding: 0 1rem">
    <h1>Claim NIM</h1>
    <p>The smallest faucet integration: <code>useFaucetClaim</code> + a button.</p>

    <input
      v-model="address"
      placeholder="NQ00 0000 0000 0000 0000 0000 0000 0000 0000"
      spellcheck="false"
      :disabled="busy"
      style="width: 100%; padding: 0.6rem; font-family: monospace; box-sizing: border-box"
    />

    <button
      :disabled="!address || busy"
      :style="{ marginTop: '0.75rem', padding: '0.6rem 1.2rem', cursor: busy ? 'progress' : 'pointer' }"
      @click="claim"
    >
      {{ busy ? 'Claiming…' : 'Claim' }}
    </button>

    <p v-if="status === 'confirmed'" style="color: green">
      ✓ Confirmed — tx <code>{{ txId }}</code>. <button @click="reset">Claim again</button>
    </p>
    <p v-else-if="status === 'rejected' || error" style="color: crimson">
      {{ error?.message ?? 'Claim rejected.' }} <button @click="reset">Try again</button>
    </p>
    <p v-else-if="status === 'challenged'" style="color: #a60">
      The faucet asked for a captcha or proof-of-work. This minimal example doesn’t handle abuse layers — see the
      README.
    </p>
  </main>
</template>
