<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, ApiError } from '../lib/api';
import { formatTimestamp } from '../lib/format';
import { useAdminStream } from '../lib/stream';

interface AuditRow {
  id: string;
  ts: string | number;
  actor: string;
  action: string;
  target: string | null;
  signals: unknown;
}

interface AuditResponse {
  total: number;
  items: AuditRow[];
}

const rows = ref<AuditRow[]>([]);
const total = ref<number>(0);
const loading = ref<boolean>(false);
const error = ref<string | null>(null);
const expanded = ref<Set<string>>(new Set());

async function load(): Promise<void> {
  loading.value = true;
  try {
    const res = await api.get<AuditResponse>('/admin/audit-log', { query: { limit: 200 } });
    rows.value = res.items;
    total.value = res.total;
    error.value = null;
  } catch (err) {
    if (err instanceof ApiError) error.value = err.message;
    else if (err instanceof Error) error.value = err.message;
    else error.value = 'failed to load audit log';
  } finally {
    loading.value = false;
  }
}

function toggle(id: string): void {
  const next = new Set(expanded.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expanded.value = next;
}

onMounted(load);

// Subscribe to live audit events. The server emits `admin.audit` into the same
// `/v1/stream` feed used by the public UI; we just filter by type.
useAdminStream((event) => {
  if (event.type !== 'admin.audit') return;
  const row: AuditRow = {
    id: typeof event['id'] === 'string' ? (event['id'] as string) : `live-${Date.now()}`,
    ts: (event['ts'] as string | number | undefined) ?? Date.now(),
    actor: String(event['actor'] ?? 'unknown'),
    action: String(event['action'] ?? 'unknown'),
    target: (event['target'] as string | null | undefined) ?? null,
    signals: event['signals'] ?? {},
  };
  rows.value = [row, ...rows.value].slice(0, 500);
  total.value += 1;
});
</script>

<template>
  <section aria-labelledby="logs-heading" class="flex flex-col gap-4">
    <header class="flex items-center justify-between">
      <h2 id="logs-heading" class="text-base font-semibold">Audit log</h2>
      <button type="button" class="btn-secondary" :disabled="loading" @click="load">Refresh</button>
    </header>

    <p
      v-if="error"
      class="rounded-md border border-[color:var(--color-danger)]/30 bg-[color:var(--color-danger)]/10 px-3 py-2 text-sm"
      role="alert"
    >
      {{ error }}
    </p>

    <div class="card overflow-x-auto" aria-live="polite">
      <table class="table w-full text-sm">
        <thead>
          <tr>
            <th>Time</th>
            <th>Actor</th>
            <th>Action</th>
            <th>Target</th>
            <th>Signals</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="r in rows"
            :key="r.id"
            class="!cursor-default hover:!bg-transparent align-top"
          >
            <td class="font-mono text-xs">{{ formatTimestamp(r.ts) }}</td>
            <td class="font-mono text-xs">{{ r.actor }}</td>
            <td class="font-mono text-xs">{{ r.action }}</td>
            <td class="font-mono text-xs">{{ r.target ?? '—' }}</td>
            <td class="text-xs">
              <button type="button" class="btn-secondary !px-2 !py-0.5" @click="toggle(r.id)">
                {{ expanded.has(r.id) ? 'Hide' : 'Show' }}
              </button>
              <pre v-if="expanded.has(r.id)" class="mt-1 overflow-auto font-mono text-[11px]">{{ JSON.stringify(r.signals, null, 2) }}</pre>
            </td>
          </tr>
          <tr v-if="rows.length === 0 && !loading">
            <td colspan="5" class="muted text-center text-sm">No audit entries yet.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <footer class="muted text-xs">
      {{ rows.length }} shown / {{ total }} total. Live updates stream via <code>/v1/stream</code>.
    </footer>
  </section>
</template>
