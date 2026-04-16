<script setup lang="ts">
import { ref, computed } from 'vue';
import { FaucetClient, useFaucetClaim } from '@nimiq-faucet/vue';

const faucetUrl = import.meta.env.VITE_FAUCET_URL || 'http://localhost:8080';
const client = new FaucetClient({ url: faucetUrl });

const address = ref('');

const { claim, reset, status, txId, error, isPending } = useFaucetClaim({
  client,
  get address() { return address.value; },
  hostContext: { uid: 'vue-example' },
});

const statusLabel = computed(() => {
  switch (status.value) {
    case 'idle': return '';
    case 'pending': return 'Submitting claim...';
    case 'queued': return 'Queued — waiting for broadcast...';
    case 'broadcast': return 'Broadcast — waiting for confirmation...';
    case 'confirmed': return 'Confirmed!';
    case 'rejected': return 'Rejected';
    case 'challenged': return 'Challenge required';
    default: return status.value;
  }
});

function handleSubmit() {
  if (!address.value.trim()) return;
  claim();
}
</script>

<template>
  <main class="container">
    <h1>Nimiq Faucet</h1>
    <p class="subtitle">Claim free NIM on testnet</p>

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

      <button type="submit" :disabled="isPending || !address.trim()">
        {{ isPending ? 'Claiming...' : 'Claim NIM' }}
      </button>
    </form>

    <div v-if="statusLabel" class="status" :class="status">
      <p>{{ statusLabel }}</p>
      <p v-if="txId" class="tx">
        TX: <code>{{ txId }}</code>
      </p>
    </div>

    <div v-if="error" class="error">
      <p>{{ error.message }}</p>
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

.container {
  max-width: 480px;
  width: 100%;
  padding: 2rem;
}

h1 {
  font-size: 1.75rem;
  margin-bottom: 0.25rem;
}

.subtitle {
  color: #6b7280;
  margin-bottom: 2rem;
}

.claim-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

label {
  font-weight: 600;
  font-size: 0.875rem;
}

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

.status {
  margin-top: 1.5rem;
  padding: 1rem;
  border-radius: 8px;
  background: #e8eaf6;
}

.status.confirmed { background: #d1fae5; color: #065f46; }
.status.rejected { background: #fee2e2; color: #991b1b; }

.tx { margin-top: 0.5rem; font-size: 0.8rem; word-break: break-all; }

.error {
  margin-top: 1.5rem;
  padding: 1rem;
  border-radius: 8px;
  background: #fee2e2;
  color: #991b1b;
}

.retry {
  margin-top: 0.75rem;
  background: #991b1b;
  font-size: 0.875rem;
  padding: 0.5rem 1rem;
}
</style>
