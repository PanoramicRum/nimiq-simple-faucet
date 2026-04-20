<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { FaucetError, type ClaimResponse, type ClaimStatus } from '@nimiq-faucet/sdk';
import { useClient } from '../lib/client';
import { txUrl } from '../lib/explorer';
import { t } from '../i18n/en';

interface Props {
  network: 'main' | 'test';
  claimId: string | null;
  initial: ClaimResponse | null;
  error: FaucetError | Error | null;
}

const props = defineProps<Props>();
const emit = defineEmits<{ (e: 'retry'): void }>();

type UiStatus = 'idle' | 'pending' | 'timeout' | ClaimStatus;

const status = ref<UiStatus>('idle');
const txId = ref<string | null>(null);
const reasonKey = ref<string | null>(null);
const copied = ref(false);
const client = useClient();

let unsubscribe: (() => void) | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

function mapReason(code?: string, message?: string): string {
  const src = `${code ?? ''} ${message ?? ''}`.toLowerCase();
  if (src.includes('send_failed') || src.includes('unavailable') || src.includes('503')) return 'reason.serverError';
  if (src.includes('rate') || src.includes('too many') || src.includes('daily cap')) return 'reason.rateLimited';
  if (src.includes('invalid address')) return 'reason.invalidAddress';
  if (src.includes('geo') || src.includes('country')) return 'reason.geoBlocked';
  if (src.includes('vpn') || src.includes('proxy')) return 'reason.vpnBlocked';
  if (src.includes('captcha') || src.includes('turnstile') || src.includes('hcaptcha')) return 'reason.captchaFailed';
  return 'reason.unknown';
}

const isServerError = ref(false);

function cleanup() {
  unsubscribe?.();
  unsubscribe = null;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

function startTracking(id: string) {
  cleanup();
  let confirmed = false;
  try {
    unsubscribe = client.subscribe((event) => {
      if (!event || typeof event !== 'object') return;
      const e = event as { type?: string; id?: string; txId?: string };
      if (e.id !== id) return;
      if (e.type === 'claim.broadcast' && typeof e.txId === 'string') {
        txId.value = e.txId;
        status.value = 'broadcast';
      } else if (e.type === 'claim.confirmed') {
        if (typeof e.txId === 'string') txId.value = e.txId;
        status.value = 'confirmed';
        confirmed = true;
        cleanup();
      }
    });
  } catch {
    // WS unavailable — fall back to polling only.
  }
  const started = Date.now();
  pollTimer = setInterval(async () => {
    if (confirmed || Date.now() - started > 60_000) {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
      return;
    }
    try {
      const s = await client.status(id);
      if (s.txId) txId.value = s.txId;
      if (s.status === 'confirmed') {
        status.value = 'confirmed';
        confirmed = true;
        cleanup();
      } else if (s.status === 'rejected') {
        status.value = 'rejected';
        reasonKey.value = mapReason(undefined, s.reason);
        cleanup();
      } else if (s.status === 'broadcast' && status.value !== 'confirmed') {
        status.value = 'broadcast';
      }
    } catch {
      /* keep polling */
    }
  }, 2_000);
}

watch(
  () => [props.claimId, props.initial, props.error] as const,
  ([id, initial, err]) => {
    cleanup();
    copied.value = false;
    if (err) {
      reasonKey.value =
        err instanceof FaucetError
          ? mapReason(err.code, err.message)
          : mapReason(undefined, (err as Error).message);
      isServerError.value = reasonKey.value === 'reason.serverError';
      status.value = isServerError.value ? 'timeout' : 'rejected';
      txId.value = null;
      return;
    }
    if (!id || !initial) {
      status.value = 'idle';
      txId.value = null;
      reasonKey.value = null;
      return;
    }
    status.value = initial.status;
    txId.value = initial.txId ?? null;
    if (initial.status === 'rejected') {
      reasonKey.value = mapReason(undefined, initial.reason);
      return;
    }
    if (initial.status === 'challenged') {
      reasonKey.value = null;
      return;
    }
    if (initial.status === 'broadcast' || initial.status === 'queued') {
      startTracking(id);
    }
  },
  { immediate: true },
);

onBeforeUnmount(cleanup);

async function copyTx() {
  if (!txId.value) return;
  try {
    await navigator.clipboard.writeText(txId.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1500);
  } catch {
    /* best-effort */
  }
}
</script>

<template>
  <div
    v-if="status !== 'idle'"
    class="rounded-lg border border-[color:var(--color-card-border)] p-3 text-sm"
    role="status"
    aria-live="polite"
  >
    <p v-if="status === 'pending'">{{ t('status.pending') }}</p>
    <p v-else-if="status === 'queued' || status === 'broadcast'">{{ t('status.broadcast') }}</p>
    <p v-else-if="status === 'challenged'" class="text-[color:var(--color-muted)]">
      {{ t('status.challenged') }}
    </p>

    <div v-else-if="status === 'confirmed'" class="space-y-2">
      <p class="font-medium text-[color:var(--color-success)]">{{ t('status.confirmed') }}</p>
      <div v-if="txId" class="space-y-1">
        <div class="flex flex-wrap items-center gap-2">
          <code class="max-w-full truncate rounded bg-surface-muted px-2 py-1 text-xs dark:bg-surface-darkMuted">
            {{ txId }}
          </code>
          <button
            type="button"
            class="focus-ring rounded border border-[color:var(--color-card-border)] px-2 py-1 text-xs"
            :aria-label="t('copyTx')"
            @click="copyTx"
          >
            {{ copied ? t('copied') : t('copyTx') }}
          </button>
        </div>
        <a
          :href="txUrl(network, txId)"
          target="_blank"
          rel="noopener noreferrer"
          class="focus-ring text-nimiq-600 underline underline-offset-2 dark:text-nimiq-300"
        >
          {{ t('explorerLink') }}
        </a>
      </div>
    </div>

    <div v-else-if="status === 'timeout' && isServerError" class="space-y-2">
      <p class="font-medium text-on-surface-variant">{{ t('status.serverError') }}</p>
      <p class="text-on-surface-variant">
        {{ t('reason.serverError') }}
      </p>
      <button
        type="button"
        class="focus-ring rounded border border-[color:var(--color-card-border)] px-3 py-1 text-sm"
        @click="emit('retry')"
      >
        {{ t('tryAgain') }}
      </button>
    </div>

    <div v-else-if="status === 'rejected'" class="space-y-2">
      <p class="font-medium text-[color:var(--color-danger)]">{{ t('status.rejected') }}</p>
      <p class="text-[color:var(--color-muted)]">
        {{ t(reasonKey ?? 'reason.unknown') }}
      </p>
      <button
        type="button"
        class="focus-ring rounded border border-[color:var(--color-card-border)] px-3 py-1 text-sm"
        @click="emit('retry')"
      >
        {{ t('tryAgain') }}
      </button>
    </div>
  </div>
</template>
