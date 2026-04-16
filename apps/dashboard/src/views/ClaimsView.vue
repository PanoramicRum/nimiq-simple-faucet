<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, ApiError } from '../lib/api';
import { formatTimestamp, truncateMiddle } from '../lib/format';
import ClaimExplainDrawer from '../components/ClaimExplainDrawer.vue';

interface ClaimRow {
  id: string;
  createdAt: string | number;
  address: string;
  status: string;
  decision: string | null;
  txId: string | null;
  ip: string | null;
  integratorId: string | null;
  abuseScore: number | null;
  rejectionReason: string | null;
}

interface ClaimsResponse {
  total: number;
  items: ClaimRow[];
}

const route = useRoute();
const router = useRouter();

const filters = ref<{ status: string; decision: string; address: string }>({
  status: '',
  decision: '',
  address: '',
});
const page = ref<number>(0);
const pageSize = 50;
const data = ref<ClaimsResponse | null>(null);
const loading = ref<boolean>(false);
const error = ref<string | null>(null);

const selectedId = computed<string | null>(() => {
  const p = route.params['id'];
  return typeof p === 'string' && p.length > 0 ? p : null;
});

async function load(): Promise<void> {
  loading.value = true;
  try {
    const query: Record<string, string | number | undefined> = {
      limit: pageSize,
      offset: page.value * pageSize,
    };
    if (filters.value.status) query['status'] = filters.value.status;
    if (filters.value.decision) query['decision'] = filters.value.decision;
    if (filters.value.address) query['address'] = filters.value.address;
    data.value = await api.get<ClaimsResponse>('/admin/claims', { query });
    error.value = null;
  } catch (err) {
    if (err instanceof ApiError) error.value = err.message;
    else if (err instanceof Error) error.value = err.message;
    else error.value = 'failed to load claims';
  } finally {
    loading.value = false;
  }
}

function openClaim(id: string): void {
  void router.push({ path: `/admin/claims/${encodeURIComponent(id)}` });
}

function closeDrawer(): void {
  void router.push({ path: '/admin/claims' });
}

onMounted(load);
watch(
  () => [filters.value.status, filters.value.decision, filters.value.address],
  () => {
    page.value = 0;
    void load();
  },
);

function badgeClass(decision: string | null): string {
  if (decision === 'allow') return 'badge badge-allow';
  if (decision === 'deny') return 'badge badge-deny';
  return 'badge badge-review';
}
</script>

<template>
  <section aria-labelledby="claims-heading" class="flex flex-col gap-4">
    <header class="flex items-center justify-between">
      <h2 id="claims-heading" class="text-base font-semibold">Claims</h2>
      <button type="button" class="btn-secondary" :disabled="loading" @click="load">
        Refresh
      </button>
    </header>

    <div class="card flex flex-wrap items-end gap-3 p-3">
      <label class="flex flex-col gap-1 text-xs">
        <span>Status</span>
        <input v-model="filters.status" class="input" placeholder="e.g. broadcast" />
      </label>
      <label class="flex flex-col gap-1 text-xs">
        <span>Decision</span>
        <select v-model="filters.decision" class="input">
          <option value="">any</option>
          <option value="allow">allow</option>
          <option value="deny">deny</option>
          <option value="review">review</option>
        </select>
      </label>
      <label class="flex flex-col gap-1 text-xs">
        <span>Address</span>
        <input v-model="filters.address" class="input font-mono" placeholder="NQ…" />
      </label>
    </div>

    <p
      v-if="error"
      class="rounded-md border border-[color:var(--color-danger)]/30 bg-[color:var(--color-danger)]/10 px-3 py-2 text-sm"
      role="alert"
    >
      {{ error }}
    </p>

    <div class="card overflow-x-auto">
      <table class="table w-full text-sm">
        <thead>
          <tr>
            <th>Created</th>
            <th>Address</th>
            <th>Status</th>
            <th>Decision</th>
            <th>IP</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in data?.items ?? []"
            :key="row.id"
            tabindex="0"
            @click="openClaim(row.id)"
            @keydown.enter="openClaim(row.id)"
            @keydown.space.prevent="openClaim(row.id)"
          >
            <td class="whitespace-nowrap font-mono text-xs">
              {{ formatTimestamp(row.createdAt) }}
            </td>
            <td class="font-mono text-xs">{{ truncateMiddle(row.address, 10, 6) }}</td>
            <td>{{ row.status }}</td>
            <td><span :class="badgeClass(row.decision)">{{ row.decision ?? '—' }}</span></td>
            <td class="font-mono text-xs">{{ row.ip ?? '—' }}</td>
            <td class="text-xs">{{ row.rejectionReason ?? '—' }}</td>
          </tr>
          <tr v-if="(data?.items.length ?? 0) === 0 && !loading">
            <td colspan="6" class="muted text-center text-sm">No claims match your filters.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <footer class="flex items-center justify-between text-sm">
      <span class="muted"
        >Showing {{ data?.items.length ?? 0 }} of {{ data?.total ?? 0 }}</span
      >
      <div class="flex gap-2">
        <button
          type="button"
          class="btn-secondary"
          :disabled="page === 0 || loading"
          @click="(page = Math.max(0, page - 1)), load()"
        >
          Previous
        </button>
        <button
          type="button"
          class="btn-secondary"
          :disabled="((page + 1) * pageSize) >= (data?.total ?? 0) || loading"
          @click="(page += 1), load()"
        >
          Next
        </button>
      </div>
    </footer>

    <ClaimExplainDrawer
      v-if="selectedId"
      :claim-id="selectedId"
      @close="closeDrawer"
      @changed="load"
    />
  </section>
</template>
