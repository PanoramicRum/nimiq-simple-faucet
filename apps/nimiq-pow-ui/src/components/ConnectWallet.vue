<script setup lang="ts">
/**
 * Wallet-connect surface — flattened layout.
 *
 * Always renders one row of three controls:
 *   [ Hub button ]  [ paste address input ]
 *
 * The Hub-API path (preferred — no keys touch this page) and the
 * manual-paste fallback share the row; whichever the user uses, the
 * resulting address is emitted via `update:modelValue` and the parent
 * adds the Claim button on its right.
 *
 * When the Hub returns an account we collapse the same row into a
 * connected-state pill plus a small Disconnect link, still occupying
 * the same flex slot so the layout doesn't jump.
 */

import { computed, watch, type Ref } from 'vue';
import type { FaucetConfig } from '@nimiq-faucet/sdk';
import { useHub } from '../composables/useHub';
import { isValidNimiqAddress } from '../lib/nimiqAddress';

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

// Mirrors App.vue's claim gate so the input's green ✓ only lights up
// for addresses that pass the full IBAN-checksum validation, not just
// the regex shape. Avoids the misleading state where the input looks
// valid but the Claim button stays disabled.
const isValidPasteShape = computed(() => isValidNimiqAddress(props.modelValue));

function shortAddr(addr: string): string {
  const stripped = addr.replace(/\s/g, '');
  if (stripped.length < 16) return addr;
  return `${stripped.slice(0, 8)}…${stripped.slice(-6)}`;
}

// Expose `connect` so the parent (App.vue) can trigger the same Hub
// flow from elsewhere — e.g. a "Ready to mine your free NIM." pill in
// the top-right that doubles as a connect button.
defineExpose({ connect });
</script>

<template>
  <!-- Connected state: replaces the row with an inline pill. -->
  <div v-if="account" class="connected">
    <span class="dot" />
    <span class="info">
      <span class="label">{{ account.label }}</span>
      <span class="addr">{{ shortAddr(account.address) }}</span>
    </span>
    <button type="button" class="link" :disabled="disabled" @click="clearAccount">
      Disconnect
    </button>
  </div>

  <!-- Default state: Hub button + paste input, side-by-side. -->
  <div v-else class="row">
    <button
      type="button"
      class="hub-btn"
      :disabled="disabled || isConnecting"
      @click="connect"
    >
      <svg class="hub-logo" viewBox="0 0 64 64" aria-hidden="true">
        <path
          d="M50 32 L41 47.6 L23 47.6 L14 32 L23 16.4 L41 16.4 Z"
          fill="#F6AE2D"
        />
      </svg>
      <span class="hub-label">{{ isConnecting ? 'Opening Hub…' : 'Connect' }}</span>
    </button>
    <div class="paste-row" :class="{ valid: isValidPasteShape, dirty: modelValue.length > 0 }">
      <input
        id="nimiq-address"
        name="nimiq-address"
        type="text"
        spellcheck="false"
        autocomplete="off"
        autocorrect="off"
        aria-label="Nimiq address"
        placeholder="Or paste an address: NQ00 0000 0000 …"
        :value="modelValue"
        :disabled="disabled"
        @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      />
      <span v-if="modelValue.length > 0" class="hint">{{ isValidPasteShape ? '✓' : '…' }}</span>
    </div>
    <p v-if="errorMessage" class="error">{{ errorMessage }}</p>
  </div>
</template>

<style scoped>
.row {
  display: flex;
  align-items: stretch;
  gap: 0.5rem;
  width: 100%;
}

/* ── Hub button ───────────────────────────────────────────── */
.hub-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0 0.85rem;
  height: 2.25rem;
  background: rgba(20, 23, 46, 0.65);
  border: 1px solid var(--gold);
  color: var(--text);
  border-radius: 999px;
  font-weight: 700;
  font-size: 0.78rem;
  letter-spacing: 0.02em;
  white-space: nowrap;
  flex: 0 0 auto;
  transition: background-color 160ms ease, transform 120ms ease, box-shadow 200ms ease;
}
.hub-btn:not(:disabled):hover {
  background: rgba(246, 174, 45, 0.10);
  box-shadow: 0 0 0 3px rgba(246, 174, 45, 0.10);
}
.hub-btn:disabled { opacity: 0.55; cursor: not-allowed; }

.hub-logo { width: 0.85rem; height: 0.85rem; }
.hub-label { font-size: 0.78rem; }

/* ── Paste-address row ────────────────────────────────────── */
.paste-row {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  height: 2.25rem;
  background: rgba(20, 23, 46, 0.65);
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 0 0.85rem;
  transition: border-color 200ms ease, box-shadow 200ms ease;
}
.paste-row.dirty { border-color: rgba(246, 174, 45, 0.5); }
.paste-row.valid {
  border-color: var(--gold);
  box-shadow: 0 0 0 3px rgba(246, 174, 45, 0.10);
}
.paste-row input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  color: var(--text);
  font-family: 'JetBrains Mono', 'Menlo', monospace;
  font-size: 0.78rem;
  letter-spacing: 0.02em;
}
.paste-row input::placeholder { color: rgba(158, 163, 199, 0.5); }
.paste-row .hint {
  margin-left: 0.5rem;
  font-size: 0.95rem;
  color: var(--gold);
  font-weight: 700;
}

/* ── Connected pill ───────────────────────────────────────── */
.connected {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0 0.9rem;
  height: 2.25rem;
  background: rgba(20, 23, 46, 0.65);
  border: 1px solid rgba(111, 207, 151, 0.45);
  border-radius: 999px;
  width: 100%;
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
  align-items: baseline;
  gap: 0.6rem;
  flex: 1;
  min-width: 0;
}
.label {
  font-weight: 700;
  font-size: 0.9rem;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.addr {
  font-family: 'JetBrains Mono', 'Menlo', monospace;
  font-size: 0.78rem;
  color: var(--muted);
  white-space: nowrap;
}

.link {
  background: transparent;
  border: none;
  color: var(--muted);
  font-size: 0.8rem;
  padding: 0.25rem 0.5rem;
  cursor: pointer;
  flex: 0 0 auto;
}
.link:hover { color: var(--gold); }
.link:disabled { opacity: 0.55; cursor: not-allowed; }

.error {
  position: absolute;
  bottom: -1.2rem;
  left: 0;
  font-size: 0.72rem;
  color: var(--error);
}

@media (max-width: 720px) {
  .row { flex-wrap: wrap; }
  .hub-btn, .paste-row { flex: 1 1 100%; }
}
</style>
