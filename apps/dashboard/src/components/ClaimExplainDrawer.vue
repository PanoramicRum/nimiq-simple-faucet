<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { api, ApiError } from '../lib/api';
import { formatTimestamp, truncateMiddle } from '../lib/format';

interface ExplainResponse {
  id: string;
  address: string;
  status: string;
  decision: string | null;
  createdAt: string | number;
  ip: string | null;
  integratorId: string | null;
  abuseScore: number | null;
  rejectionReason: string | null;
  txId: string | null;
  signals: unknown;
}

const props = defineProps<{ claimId: string }>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'changed'): void }>();

const data = ref<ExplainResponse | null>(null);
const loading = ref<boolean>(true);
const error = ref<string | null>(null);
const acting = ref<false | 'allow' | 'deny'>(false);
const denyReason = ref<string>('');

async function load(id: string): Promise<void> {
  loading.value = true;
  try {
    data.value = await api.get<ExplainResponse>(`/admin/claims/${encodeURIComponent(id)}/explain`);
    error.value = null;
  } catch (err) {
    if (err instanceof ApiError) error.value = err.message;
    else if (err instanceof Error) error.value = err.message;
    else error.value = 'failed to load claim';
  } finally {
    loading.value = false;
  }
}

onMounted(() => void load(props.claimId));
watch(
  () => props.claimId,
  (id) => void load(id),
);

function onBackdrop(e: MouseEvent): void {
  if (e.target === e.currentTarget) emit('close');
}

async function allowClaim(): Promise<void> {
  acting.value = 'allow';
  try {
    await api.post(`/admin/claims/${encodeURIComponent(props.claimId)}/allow`, {});
    emit('changed');
    await load(props.claimId);
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'failed';
  } finally {
    acting.value = false;
  }
}

async function denyClaim(): Promise<void> {
  acting.value = 'deny';
  try {
    await api.post(`/admin/claims/${encodeURIComponent(props.claimId)}/deny`, {
      reason: denyReason.value || 'manual deny',
    });
    emit('changed');
    await load(props.claimId);
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'failed';
  } finally {
    acting.value = false;
  }
}

function prettyJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
</script>

<template>
  <div
    class="fixed inset-0 z-40 bg-black/40"
    role="dialog"
    aria-modal="true"
    aria-labelledby="drawer-heading"
    @click="onBackdrop"
    @keydown.esc="emit('close')"
  >
    <aside
      class="fixed right-0 top-0 flex h-full w-full max-w-lg flex-col overflow-y-auto border-l border-[color:var(--color-card-border)] bg-[color:var(--color-card-bg)] p-4 shadow-lg"
    >
      <header class="mb-3 flex items-start justify-between">
        <div>
          <h3 id="drawer-heading" class="text-base font-semibold">Claim details</h3>
          <p class="muted font-mono text-xs">{{ props.claimId }}</p>
        </div>
        <button type="button" class="btn-secondary !px-2 !py-1" aria-label="Close" @click="emit('close')">
          ✕
        </button>
      </header>

      <p v-if="loading" class="muted text-sm">Loading…</p>
      <p
        v-else-if="error"
        class="rounded-md border border-[color:var(--color-danger)]/30 bg-[color:var(--color-danger)]/10 px-3 py-2 text-sm"
        role="alert"
      >
        {{ error }}
      </p>

      <dl v-if="data" class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt class="muted">Address</dt>
        <dd class="font-mono text-xs">{{ truncateMiddle(data.address, 12, 6) }}</dd>
        <dt class="muted">Status</dt>
        <dd>{{ data.status }}</dd>
        <dt class="muted">Decision</dt>
        <dd>{{ data.decision ?? '—' }}</dd>
        <dt class="muted">Created</dt>
        <dd>{{ formatTimestamp(data.createdAt) }}</dd>
        <dt class="muted">IP</dt>
        <dd class="font-mono text-xs">{{ data.ip ?? '—' }}</dd>
        <dt class="muted">Integrator</dt>
        <dd>{{ data.integratorId ?? '—' }}</dd>
        <dt class="muted">Abuse score</dt>
        <dd>{{ data.abuseScore ?? '—' }}</dd>
        <dt class="muted">Rejection</dt>
        <dd>{{ data.rejectionReason ?? '—' }}</dd>
        <dt class="muted">Tx</dt>
        <dd class="font-mono text-xs">{{ data.txId ?? '—' }}</dd>
      </dl>

      <section v-if="data" class="mt-4">
        <h4 class="mb-1 text-sm font-semibold">Signals</h4>
        <pre
          class="card max-h-80 overflow-auto p-3 font-mono text-xs"
          tabindex="0"
          aria-label="Claim signal bundle"
        >{{ prettyJson(data.signals) }}</pre>
      </section>

      <section class="mt-4 flex flex-col gap-2">
        <h4 class="text-sm font-semibold">Manual override</h4>
        <label class="flex flex-col gap-1 text-xs">
          <span>Reason (for deny)</span>
          <input v-model="denyReason" class="input" placeholder="reason" />
        </label>
        <div class="flex gap-2">
          <button
            type="button"
            class="btn-primary"
            :disabled="acting !== false"
            @click="allowClaim"
          >
            {{ acting === 'allow' ? 'Allowing…' : 'Allow' }}
          </button>
          <button
            type="button"
            class="btn-danger"
            :disabled="acting !== false"
            @click="denyClaim"
          >
            {{ acting === 'deny' ? 'Denying…' : 'Deny' }}
          </button>
        </div>
      </section>
    </aside>
  </div>
</template>
