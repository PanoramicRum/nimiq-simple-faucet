<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { api, ApiError } from '../lib/api';
import { formatLuna, formatPercent } from '../lib/format';
import { useAdminStream } from '../lib/stream';

interface Overview {
  balance: string;
  claimsLastHour: number;
  claimsLast24h: number;
  successRate: number;
  topRejectionReasons: { reason: string; count: number }[];
}

const data = ref<Overview | null>(null);
const error = ref<string | null>(null);
const loading = ref<boolean>(true);
let timer: ReturnType<typeof setInterval> | null = null;

async function load(): Promise<void> {
  try {
    data.value = await api.get<Overview>('/admin/overview');
    error.value = null;
  } catch (err) {
    if (err instanceof ApiError) error.value = err.message;
    else if (err instanceof Error) error.value = err.message;
    else error.value = 'failed to load overview';
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await load();
  timer = setInterval(load, 30_000);
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});

// Refresh counters quickly when a new claim event is streamed.
useAdminStream((event) => {
  if (event.type === 'claim' || event.type === 'admin.audit') {
    void load();
  }
});
</script>

<template>
  <section aria-labelledby="ov-heading" class="flex flex-col gap-4">
    <header class="flex items-center justify-between">
      <h2 id="ov-heading" class="text-base font-semibold">Overview</h2>
      <button type="button" class="btn-secondary" :disabled="loading" @click="load">
        Refresh
      </button>
    </header>

    <p
      v-if="error"
      class="rounded-md border border-[color:var(--color-danger)]/30 bg-[color:var(--color-danger)]/10 px-3 py-2 text-sm"
      role="alert"
    >
      {{ error }}
    </p>

    <div v-if="data" class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div class="card p-4">
        <div class="muted text-xs uppercase tracking-wide">Balance</div>
        <div class="mt-1 text-xl font-semibold">{{ formatLuna(data.balance) }}</div>
      </div>
      <div class="card p-4">
        <div class="muted text-xs uppercase tracking-wide">Claims / last hour</div>
        <div class="mt-1 text-xl font-semibold">{{ data.claimsLastHour }}</div>
      </div>
      <div class="card p-4">
        <div class="muted text-xs uppercase tracking-wide">Claims / 24 h</div>
        <div class="mt-1 text-xl font-semibold">{{ data.claimsLast24h }}</div>
      </div>
      <div class="card p-4">
        <div class="muted text-xs uppercase tracking-wide">Success rate (24 h)</div>
        <div class="mt-1 text-xl font-semibold">{{ formatPercent(data.successRate) }}</div>
      </div>
    </div>

    <div v-if="data" class="card p-4">
      <h3 class="mb-2 text-sm font-semibold">Top rejection reasons (24 h)</h3>
      <p v-if="data.topRejectionReasons.length === 0" class="muted text-sm">No rejections.</p>
      <ol v-else class="flex flex-col gap-1 text-sm">
        <li
          v-for="(r, i) in data.topRejectionReasons"
          :key="r.reason + i"
          class="flex items-center justify-between"
        >
          <span class="font-mono text-xs">{{ r.reason }}</span>
          <span class="badge">{{ r.count }}</span>
        </li>
      </ol>
    </div>
  </section>
</template>
