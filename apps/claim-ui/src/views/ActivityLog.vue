<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import ClaimDetailModal from '../components/ClaimDetailModal.vue';
import { timeAgo, lunaToNim } from '../lib/format';

interface ClaimRow {
  id: string;
  createdAt: string | number;
  address: string;
  amountLuna: string;
  status: string;
  decision: string | null;
  txId: string | null;
  rejectionReason: string | null;
}

const items = ref<ClaimRow[]>([]);
const total = ref(0);
const page = ref(0);
const statusFilter = ref('');
const loading = ref(false);
const selectedClaim = ref<ClaimRow | null>(null);
const pageSize = 20;

function entryTitle(c: ClaimRow): string {
  if (c.status === 'confirmed') return 'Claim Successful';
  if (c.status === 'broadcast') return 'Faucet Sent';
  if (c.status === 'rejected' && c.decision === 'deny') return 'Abuse Attempt Blocked';
  if (c.status === 'rejected') return 'Rate Limit Exceeded';
  if (c.status === 'challenged') return 'Processing Transaction';
  if (c.status === 'timeout') return 'Processing Transaction';
  return 'Claim ' + c.status;
}

function entryDotColor(c: ClaimRow): string {
  if (c.status === 'confirmed') return '#005db8'; // blue
  if (c.status === 'broadcast') return '#005db8';
  if (c.status === 'rejected') return '#ba1a1a'; // red
  if (c.status === 'challenged' || c.status === 'timeout') return '#785a00'; // gold
  return '#817661';
}

function isBlocked(c: ClaimRow): boolean {
  return c.status === 'rejected';
}

async function load() {
  loading.value = true;
  const base = window.location.origin;
  const params = new URLSearchParams({
    limit: String(pageSize),
    offset: String(page.value * pageSize),
  });
  if (statusFilter.value) params.set('status', statusFilter.value);
  try {
    const res = await fetch(`${base}/v1/claims/recent?${params}`);
    const data = await res.json();
    items.value = data.items ?? [];
    total.value = data.total ?? 0;
  } catch {
    items.value = [];
  }
  loading.value = false;
}

function openDetail(c: ClaimRow) {
  selectedClaim.value = c;
}

watch([page, statusFilter], () => load());
onMounted(load);
</script>

<template>
  <main class="flex-grow max-w-3xl mx-auto w-full px-6 py-16">
    <div class="bg-surface-container-lowest rounded-2xl shadow-soft p-8 md:p-10">
      <div class="flex justify-between items-center mb-8">
        <h1 class="font-headline text-2xl font-bold">Full Activity Log</h1>
        <select
          v-model="statusFilter"
          class="text-sm font-body bg-surface-container-high rounded-lg px-3 py-1.5 border-none focus:ring-1 focus:ring-primary-container"
        >
          <option value="">All</option>
          <option value="confirmed">Confirmed</option>
          <option value="rejected">Rejected</option>
          <option value="broadcast">Broadcast</option>
        </select>
      </div>

      <div v-if="loading" class="text-center text-on-surface-variant py-16 font-body">Loading...</div>

      <div v-else-if="!items.length" class="text-center text-on-surface-variant py-16 font-body">
        No claims found
      </div>

      <div v-else class="space-y-2">
        <div
          v-for="c in items"
          :key="c.id"
          class="rounded-xl p-5 cursor-pointer transition-all duration-200"
          :class="isBlocked(c) ? 'bg-error-container/30' : 'hover:bg-surface-container-low'"
          @click="openDetail(c)"
        >
          <div class="flex items-start gap-4">
            <!-- Status dot -->
            <div class="mt-1.5 flex-shrink-0">
              <span class="block w-3 h-3 rounded-full" :style="{ background: entryDotColor(c) }"></span>
            </div>

            <!-- Content -->
            <div class="flex-1 min-w-0">
              <p class="font-headline font-bold text-on-surface" :class="isBlocked(c) ? 'text-error' : ''">
                {{ entryTitle(c) }}
              </p>
              <p class="text-sm text-on-surface-variant font-mono mt-1 truncate">
                {{ c.address }}
                <span class="font-body"> · {{ timeAgo(c.createdAt) }}</span>
              </p>
            </div>

            <!-- Right badge -->
            <div class="flex-shrink-0 text-right">
              <span v-if="c.status === 'confirmed' || c.status === 'broadcast'" class="font-mono font-semibold text-primary">
                +{{ lunaToNim(c.amountLuna) }} NIM
              </span>
              <span v-else-if="isBlocked(c)" class="inline-block px-3 py-1 bg-error-container rounded-full text-xs font-label font-semibold text-error">
                Blocked
              </span>
              <span v-else class="text-sm text-on-surface-variant font-body">
                Processing ...
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Pagination -->
      <div v-if="total > pageSize" class="flex items-center justify-center gap-4 mt-8 pt-6">
        <button
          :disabled="page === 0"
          class="text-sm font-label font-medium px-4 py-2 rounded-full bg-surface-container-low disabled:opacity-40 hover:bg-surface-container transition-colors"
          @click="page--"
        >
          ← Prev
        </button>
        <span class="text-xs text-on-surface-variant font-mono">
          Page {{ page + 1 }} of {{ Math.ceil(total / pageSize) }}
        </span>
        <button
          :disabled="(page + 1) * pageSize >= total"
          class="text-sm font-label font-medium px-4 py-2 rounded-full bg-surface-container-low disabled:opacity-40 hover:bg-surface-container transition-colors"
          @click="page++"
        >
          Next →
        </button>
      </div>
    </div>

    <ClaimDetailModal v-if="selectedClaim" :claim="selectedClaim" @close="selectedClaim = null" />
  </main>
</template>
