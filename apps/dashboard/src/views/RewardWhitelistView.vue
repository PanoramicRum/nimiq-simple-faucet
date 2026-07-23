<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, ApiError } from '../lib/api';
import { formatTimestamp } from '../lib/format';

type Kind = 'address' | 'uid';

interface WhitelistRow {
  id: string;
  kind: Kind;
  value: string;
  integratorId: string | null;
  bonusPercent: number | null;
  exactAmountNim: number | null;
  reason: string | null;
  createdAt: string | number;
}

interface WhitelistResponse {
  total: number;
  items: WhitelistRow[];
}

const rows = ref<WhitelistRow[]>([]);
const total = ref<number>(0);
const loading = ref<boolean>(false);
const error = ref<string | null>(null);

const form = ref<{
  kind: Kind;
  value: string;
  integratorId: string;
  bonusPercent: string;
  exactAmountNim: string;
  reason: string;
}>({
  kind: 'address',
  value: '',
  integratorId: '',
  bonusPercent: '',
  exactAmountNim: '',
  reason: '',
});
const creating = ref<boolean>(false);

const counts = computed<Record<Kind, number>>(() => {
  const out: Record<Kind, number> = { address: 0, uid: 0 };
  for (const r of rows.value) out[r.kind] += 1;
  return out;
});

async function load(): Promise<void> {
  loading.value = true;
  try {
    const res = await api.get<WhitelistResponse>('/admin/reward-whitelist', {
      query: { limit: 200 },
    });
    rows.value = res.items;
    total.value = res.total;
    error.value = null;
  } catch (err) {
    if (err instanceof ApiError) error.value = err.message;
    else if (err instanceof Error) error.value = err.message;
    else error.value = 'failed to load reward whitelist';
  } finally {
    loading.value = false;
  }
}

async function onCreate(): Promise<void> {
  if (!form.value.value) return;
  creating.value = true;
  try {
    const body: {
      kind: Kind;
      value: string;
      integratorId?: string;
      bonusPercent?: number;
      exactAmountNim?: number;
      reason?: string;
    } = {
      kind: form.value.kind,
      value: form.value.value,
    };
    if (form.value.kind === 'uid' && form.value.integratorId) {
      body.integratorId = form.value.integratorId;
    }
    if (form.value.bonusPercent !== '') body.bonusPercent = Number(form.value.bonusPercent);
    if (form.value.exactAmountNim !== '') body.exactAmountNim = Number(form.value.exactAmountNim);
    if (form.value.reason) body.reason = form.value.reason;
    await api.post('/admin/reward-whitelist', body);
    form.value.value = '';
    form.value.integratorId = '';
    form.value.bonusPercent = '';
    form.value.exactAmountNim = '';
    form.value.reason = '';
    await load();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'failed';
  } finally {
    creating.value = false;
  }
}

async function onDelete(id: string): Promise<void> {
  try {
    await api.del(`/admin/reward-whitelist/${encodeURIComponent(id)}`);
    await load();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'failed';
  }
}

onMounted(load);
</script>

<template>
  <section aria-labelledby="reward-wl-heading" class="flex flex-col gap-4">
    <header class="flex items-center justify-between">
      <h2 id="reward-wl-heading" class="text-base font-semibold">Reward whitelist</h2>
      <button type="button" class="btn-secondary" :disabled="loading" @click="load">
        Refresh
      </button>
    </header>

    <p class="muted text-sm">
      Allow-listed identities get a bonus percent — or an exact payout — in automatic reward mode.
      Entries only take effect while the whitelist toggle on the Config page is on. An entry without
      its own percent or exact amount uses the global default bonus from the Config page; an exact
      amount wins over any percent. Uid entries are bound to one integrator and match only claims
      carrying that integrator's full request signature (api-key + signed body) — browser-side
      hostContext signatures are not accepted for payouts.
    </p>

    <div class="grid grid-cols-2 gap-3 sm:grid-cols-2">
      <div v-for="(n, k) in counts" :key="k" class="card p-3 text-center">
        <div class="muted text-xs uppercase">{{ k }}</div>
        <div class="mt-1 text-lg font-semibold">{{ n }}</div>
      </div>
    </div>

    <p
      v-if="error"
      class="rounded-md border border-[color:var(--color-danger)]/30 bg-[color:var(--color-danger)]/10 px-3 py-2 text-sm"
      role="alert"
    >
      {{ error }}
    </p>

    <form class="card flex flex-wrap items-end gap-3 p-3" @submit.prevent="onCreate">
      <label class="flex flex-col gap-1 text-xs">
        <span>Kind</span>
        <select v-model="form.kind" class="input">
          <option value="address">address</option>
          <option value="uid">uid</option>
        </select>
      </label>
      <label class="flex min-w-[12rem] flex-1 flex-col gap-1 text-xs">
        <span>Value</span>
        <input v-model="form.value" class="input font-mono" required />
      </label>
      <label v-if="form.kind === 'uid'" class="flex min-w-[10rem] flex-col gap-1 text-xs">
        <span>Integrator id</span>
        <input v-model="form.integratorId" class="input font-mono" required />
      </label>
      <label class="flex flex-col gap-1 text-xs">
        <span>Bonus (%)</span>
        <input
          v-model="form.bonusPercent"
          class="input font-mono w-24"
          type="number"
          min="0"
          max="500"
          step="1"
          placeholder="default"
        />
      </label>
      <label class="flex flex-col gap-1 text-xs">
        <span>Exact (NIM)</span>
        <input
          v-model="form.exactAmountNim"
          class="input font-mono w-24"
          type="number"
          min="0.00001"
          max="1000000"
          step="any"
          placeholder="—"
        />
      </label>
      <label class="flex min-w-[10rem] flex-1 flex-col gap-1 text-xs">
        <span>Reason</span>
        <input v-model="form.reason" class="input" />
      </label>
      <button type="submit" class="btn-primary" :disabled="creating">
        {{ creating ? 'Adding…' : 'Add' }}
      </button>
    </form>

    <div class="card overflow-x-auto">
      <table class="table w-full text-sm">
        <thead>
          <tr>
            <th>Kind</th>
            <th>Value</th>
            <th>Integrator</th>
            <th>Bonus</th>
            <th>Exact</th>
            <th>Reason</th>
            <th>Created</th>
            <th class="w-20"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id" class="!cursor-default hover:!bg-transparent">
            <td>{{ r.kind }}</td>
            <td class="font-mono text-xs">{{ r.value }}</td>
            <td class="font-mono text-xs">{{ r.integratorId ?? '—' }}</td>
            <td class="font-mono text-xs">{{ r.bonusPercent !== null ? `${r.bonusPercent}%` : 'default' }}</td>
            <td class="font-mono text-xs">{{ r.exactAmountNim !== null ? `${r.exactAmountNim} NIM` : '—' }}</td>
            <td class="text-xs">{{ r.reason ?? '—' }}</td>
            <td class="font-mono text-xs">{{ formatTimestamp(r.createdAt) }}</td>
            <td>
              <button type="button" class="btn-secondary !px-2 !py-1" @click.stop="onDelete(r.id)">
                Remove
              </button>
            </td>
          </tr>
          <tr v-if="rows.length === 0 && !loading">
            <td colspan="8" class="muted text-center text-sm">Reward whitelist is empty.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
