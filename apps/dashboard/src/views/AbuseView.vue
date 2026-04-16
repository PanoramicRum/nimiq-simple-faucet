<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, ApiError } from '../lib/api';
import { formatTimestamp } from '../lib/format';

type Kind = 'ip' | 'address' | 'uid' | 'asn' | 'country';

interface BlockRow {
  id: string;
  kind: Kind;
  value: string;
  reason: string | null;
  createdAt: string | number;
  expiresAt: string | number | null;
}

interface BlocklistResponse {
  total: number;
  items: BlockRow[];
}

const rows = ref<BlockRow[]>([]);
const total = ref<number>(0);
const loading = ref<boolean>(false);
const error = ref<string | null>(null);

const form = ref<{ kind: Kind; value: string; reason: string }>({
  kind: 'ip',
  value: '',
  reason: '',
});
const creating = ref<boolean>(false);

const counts = computed<Record<Kind, number>>(() => {
  const out: Record<Kind, number> = { ip: 0, address: 0, uid: 0, asn: 0, country: 0 };
  for (const r of rows.value) out[r.kind] += 1;
  return out;
});

async function load(): Promise<void> {
  loading.value = true;
  try {
    const res = await api.get<BlocklistResponse>('/admin/blocklist', {
      query: { limit: 200 },
    });
    rows.value = res.items;
    total.value = res.total;
    error.value = null;
  } catch (err) {
    if (err instanceof ApiError) error.value = err.message;
    else if (err instanceof Error) error.value = err.message;
    else error.value = 'failed to load blocklist';
  } finally {
    loading.value = false;
  }
}

async function onCreate(): Promise<void> {
  if (!form.value.value) return;
  creating.value = true;
  try {
    const body: { kind: Kind; value: string; reason?: string } = {
      kind: form.value.kind,
      value: form.value.value,
    };
    if (form.value.reason) body.reason = form.value.reason;
    await api.post('/admin/blocklist', body);
    form.value.value = '';
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
    await api.del(`/admin/blocklist/${encodeURIComponent(id)}`);
    await load();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'failed';
  }
}

onMounted(load);
</script>

<template>
  <section aria-labelledby="abuse-heading" class="flex flex-col gap-4">
    <header class="flex items-center justify-between">
      <h2 id="abuse-heading" class="text-base font-semibold">Abuse</h2>
      <button type="button" class="btn-secondary" :disabled="loading" @click="load">
        Refresh
      </button>
    </header>

    <div class="grid grid-cols-2 gap-3 sm:grid-cols-5">
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
          <option value="ip">ip</option>
          <option value="address">address</option>
          <option value="uid">uid</option>
          <option value="asn">asn</option>
          <option value="country">country</option>
        </select>
      </label>
      <label class="flex min-w-[12rem] flex-1 flex-col gap-1 text-xs">
        <span>Value</span>
        <input v-model="form.value" class="input font-mono" required />
      </label>
      <label class="flex min-w-[12rem] flex-1 flex-col gap-1 text-xs">
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
            <th>Reason</th>
            <th>Created</th>
            <th>Expires</th>
            <th class="w-20"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id" class="!cursor-default hover:!bg-transparent">
            <td>{{ r.kind }}</td>
            <td class="font-mono text-xs">{{ r.value }}</td>
            <td class="text-xs">{{ r.reason ?? '—' }}</td>
            <td class="font-mono text-xs">{{ formatTimestamp(r.createdAt) }}</td>
            <td class="font-mono text-xs">{{ formatTimestamp(r.expiresAt) }}</td>
            <td>
              <button type="button" class="btn-secondary !px-2 !py-1" @click.stop="onDelete(r.id)">
                Remove
              </button>
            </td>
          </tr>
          <tr v-if="rows.length === 0 && !loading">
            <td colspan="6" class="muted text-center text-sm">Blocklist is empty.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
