<script setup lang="ts">
import { computed } from 'vue';
import type { Phase } from '../composables/useClaim';

const props = defineProps<{
  phase: Phase;
  txId: string | null;
  errorMessage: string | null;
  hashcashAttempts: number;
}>();

const message = computed(() => {
  switch (props.phase) {
    case 'idle': return 'Ready to mine your free NIM.';
    case 'loading-config': return 'Reading server config…';
    case 'solving-hashcash': return `Proof-of-work: ${props.hashcashAttempts.toLocaleString()} attempts…`;
    case 'submitting': return 'Submitting claim to the faucet…';
    case 'broadcast': return 'Broadcast — waiting for confirmation…';
    case 'confirmed': return 'Confirmed! Welcome to Nimiq.';
    case 'rejected': return props.errorMessage ?? 'Claim rejected.';
    case 'error': return props.errorMessage ?? 'Something went wrong.';
    default: return '';
  }
});

const tone = computed<'idle' | 'busy' | 'good' | 'bad'>(() => {
  if (props.phase === 'confirmed') return 'good';
  if (props.phase === 'rejected' || props.phase === 'error') return 'bad';
  if (props.phase === 'idle' || props.phase === 'loading-config') return 'idle';
  return 'busy';
});
</script>

<template>
  <div class="status-bar" :data-tone="tone">
    <span class="dot" />
    <span class="msg">{{ message }}</span>
    <span v-if="txId" class="tx">
      tx
      <a
        :href="`https://nimiq-testnet.observer/transactions/${txId}`"
        target="_blank"
        rel="noopener"
      >{{ txId.slice(0, 16) }}…</a>
    </span>
  </div>
</template>

<style scoped>
.status-bar {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.5rem 1rem;
  background: rgba(20, 23, 46, 0.6);
  border: 1px solid var(--line);
  border-radius: 999px;
  font-size: 0.85rem;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: var(--muted);
}

.status-bar[data-tone='busy']  .dot { background: var(--amber); animation: pulse-dot 1.2s infinite; }
.status-bar[data-tone='good']  .dot { background: var(--success); }
.status-bar[data-tone='bad']   .dot { background: var(--error); }
.status-bar[data-tone='good']  { color: var(--success); border-color: rgba(111, 207, 151, 0.25); }
.status-bar[data-tone='bad']   { color: var(--error);   border-color: rgba(235, 87, 87, 0.25); }

@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.45; }
}

.tx {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.78rem;
  opacity: 0.85;
  border-left: 1px solid var(--line);
  padding-left: 0.6rem;
  margin-left: 0.2rem;
}
</style>
