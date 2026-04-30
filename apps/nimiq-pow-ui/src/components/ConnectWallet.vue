<script setup lang="ts">
/**
 * Wallet-connect surface — ROADMAP §3.0.15.
 *
 * Primary path: Nimiq Hub-API (`useHub`). One click pops the Hub in
 * its own origin, the user picks an address, we receive
 * `{ address, label }`. No keys touch this page.
 *
 * Fallback: a small "paste address manually" toggle reveals the
 * original v1 input — useful when the user doesn't have a Hub account
 * yet, or when the Hub popup is blocked (some mobile WebViews).
 *
 * Either path emits `update:modelValue` with the chosen address so
 * the parent (App.vue) can drive the claim. We also surface a label
 * via `connected-label` so the parent can show "Claiming to <label>" if it wants.
 */

import { computed, ref, watch, type Ref } from 'vue';
import type { FaucetConfig } from '@nimiq-faucet/sdk';
import { useHub } from '../composables/useHub';

const props = defineProps<{
  modelValue: string;
  disabled?: boolean;
  network: FaucetConfig['network'] | undefined;
}>();
const emit = defineEmits<{
  'update:modelValue': [value: string];
  'connected-label': [label: string | null];
}>();

const networkRef: Ref<FaucetConfig['network'] | undefined> = computed(() => props.network);
const { account, isConnecting, errorMessage, connect, disconnect } = useHub(networkRef);

const showPasteFallback = ref(false);

// When the Hub returns an address, push it up to the parent.
watch(account, (a) => {
  if (a) {
    emit('update:modelValue', a.address);
    emit('connected-label', a.label);
  } else {
    emit('connected-label', null);
  }
});

function clearAccount() {
  disconnect();
  emit('update:modelValue', '');
}

const isValidPasteShape = computed(() => {
  const stripped = props.modelValue.replace(/\s/g, '').toUpperCase();
  return /^NQ[0-9]{2}[A-Z0-9]{32}$/.test(stripped);
});
</script>

<template>
  <div class="connect">
    <!-- Connected state: address chip + label. -->
    <div v-if="account" class="connected">
      <span class="dot" />
      <div class="info">
        <span class="label">{{ account.label }}</span>
        <code class="addr">{{ account.address }}</code>
      </div>
      <button type="button" class="link" :disabled="disabled" @click="clearAccount">Disconnect</button>
    </div>

    <!-- Default state: Hub button (primary) + paste fallback (secondary). -->
    <template v-else>
      <button
        type="button"
        class="hub-btn"
        :disabled="disabled || isConnecting"
        @click="connect"
      >
        <svg class="logo" viewBox="0 0 64 64" aria-hidden="true">
          <circle cx="32" cy="32" r="28" fill="#F6AE2D" />
          <path d="M32 14 L48 24 L48 40 L32 50 L16 40 L16 24 Z" fill="#1F2348" stroke="#1F2348" stroke-width="2" stroke-linejoin="round" />
        </svg>
        <span>{{ isConnecting ? 'Opening Hub…' : 'Connect with Nimiq Hub' }}</span>
      </button>

      <p v-if="errorMessage" class="error">{{ errorMessage }}</p>

      <button
        v-if="!showPasteFallback"
        type="button"
        class="link paste-toggle"
        :disabled="disabled"
        @click="showPasteFallback = true"
      >
        Or paste an address manually →
      </button>

      <div v-else class="paste-row" :class="{ valid: isValidPasteShape, dirty: modelValue.length > 0 }">
        <input
          type="text"
          spellcheck="false"
          autocomplete="off"
          autocorrect="off"
          placeholder="NQ00 0000 0000 0000 0000 0000 0000 0000 0000"
          :value="modelValue"
          :disabled="disabled"
          @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
        />
        <span v-if="modelValue.length > 0" class="hint">{{ isValidPasteShape ? '✓' : '…' }}</span>
        <button
          type="button"
          class="link close"
          :disabled="disabled"
          @click="showPasteFallback = false; emit('update:modelValue', '')"
          aria-label="Close manual entry"
        >×</button>
      </div>
    </template>

    <p class="help">
      Your account stays in the Hub — this page never sees your keys. We only need the address to send NIM there.
    </p>
  </div>
</template>

<style scoped>
.connect {
  width: 100%;
  max-width: 600px;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.hub-btn {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  padding: 0.95rem 1.5rem;
  background: rgba(20, 23, 46, 0.6);
  border: 1px solid var(--gold);
  color: var(--text);
  border-radius: 12px;
  font-weight: 700;
  font-size: 0.95rem;
  letter-spacing: 0.02em;
  transition: background-color 160ms ease, transform 120ms ease, box-shadow 200ms ease;
}
.hub-btn:not(:disabled):hover {
  background: rgba(246, 174, 45, 0.08);
  transform: translateY(-1px);
  box-shadow: 0 0 0 4px rgba(246, 174, 45, 0.10);
}

.logo { width: 1.6rem; height: 1.6rem; }

.connected {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  padding: 0.85rem 1rem;
  background: rgba(20, 23, 46, 0.6);
  border: 1px solid rgba(111, 207, 151, 0.35);
  border-radius: 12px;
}
.dot {
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 50%;
  background: var(--success);
  flex: 0 0 auto;
}
.info {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  flex: 1;
  min-width: 0;
}
.label {
  font-weight: 700;
  font-size: 0.95rem;
  color: var(--text);
}
.addr {
  font-family: 'JetBrains Mono', 'Menlo', monospace;
  font-size: 0.78rem;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.link {
  background: transparent;
  color: var(--muted);
  font-size: 0.85rem;
  padding: 0.25rem 0.5rem;
  text-align: left;
}
.link:hover { color: var(--gold); }

.paste-toggle {
  align-self: flex-start;
  padding-left: 0;
}

.paste-row {
  display: flex;
  align-items: center;
  background: rgba(20, 23, 46, 0.6);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 0.75rem 1rem;
  transition: border-color 200ms ease, box-shadow 200ms ease;
}
.paste-row.dirty { border-color: rgba(246, 174, 45, 0.4); }
.paste-row.valid {
  border-color: var(--gold);
  box-shadow: 0 0 0 4px rgba(246, 174, 45, 0.10);
}
.paste-row input {
  flex: 1;
  font-size: 0.9rem;
  letter-spacing: 0.02em;
}
.paste-row input::placeholder { color: rgba(158, 163, 199, 0.45); }
.paste-row .hint {
  margin: 0 0.6rem;
  font-size: 0.95rem;
  color: var(--gold);
  font-weight: 700;
}
.close {
  font-size: 1.4rem;
  line-height: 1;
  padding: 0 0.4rem;
  color: var(--muted);
}

.error {
  font-size: 0.78rem;
  color: var(--error);
  padding-left: 0.25rem;
}

.help {
  font-size: 0.75rem;
  color: var(--muted);
  line-height: 1.5;
}
</style>
