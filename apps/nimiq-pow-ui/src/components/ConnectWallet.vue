<script setup lang="ts">
/**
 * Paste-address input. v1 of the NimiqPoW theme uses a simple
 * paste-and-claim flow; Hub-API integration is roadmap §3.0.15.
 */
import { computed } from 'vue';

const props = defineProps<{ modelValue: string; disabled?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const isValidShape = computed(() => {
  // Loose check — server-side validation does the real work.
  // NQ + 36 alphanumeric chars (with optional spaces every 4 = 40 chars).
  const stripped = props.modelValue.replace(/\s/g, '').toUpperCase();
  return /^NQ[0-9]{2}[A-Z0-9]{32}$/.test(stripped);
});
</script>

<template>
  <div class="connect-wallet">
    <label for="addr-input" class="label">Your Nimiq address</label>
    <div class="input-row" :class="{ valid: isValidShape, dirty: modelValue.length > 0 }">
      <input
        id="addr-input"
        type="text"
        spellcheck="false"
        autocomplete="off"
        autocorrect="off"
        :placeholder="'NQ00 0000 0000 0000 0000 0000 0000 0000 0000'"
        :value="modelValue"
        :disabled="disabled"
        @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      />
      <span v-if="modelValue.length > 0" class="hint">{{ isValidShape ? '✓' : '…' }}</span>
    </div>
    <p class="help">
      Paste any testnet NIM address. We'll send the claim there. No wallet connection required —
      <a href="https://github.com/PanoramicRum/nimiq-simple-faucet/issues/119" target="_blank" rel="noopener">Hub-API support is on the roadmap</a>.
    </p>
  </div>
</template>

<style scoped>
.connect-wallet {
  width: 100%;
  max-width: 600px;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.label {
  font-size: 0.7rem;
  color: var(--muted);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  font-weight: 700;
}

.input-row {
  display: flex;
  align-items: center;
  background: rgba(20, 23, 46, 0.6);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 0.85rem 1rem;
  transition: border-color 200ms ease, box-shadow 200ms ease;
}
.input-row.dirty {
  border-color: rgba(246, 174, 45, 0.4);
}
.input-row.valid {
  border-color: var(--gold);
  box-shadow: 0 0 0 4px rgba(246, 174, 45, 0.10);
}

input {
  flex: 1;
  font-size: 0.95rem;
  letter-spacing: 0.02em;
}
input::placeholder {
  color: rgba(158, 163, 199, 0.45);
}

.hint {
  margin-left: 0.75rem;
  font-size: 0.95rem;
  color: var(--gold);
  font-weight: 700;
}

.help {
  font-size: 0.75rem;
  color: var(--muted);
  line-height: 1.5;
}
</style>
