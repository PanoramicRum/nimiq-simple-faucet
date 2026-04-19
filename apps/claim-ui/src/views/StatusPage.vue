<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import ClaimDetailModal from '../components/ClaimDetailModal.vue';
import { timeAgo, lunaToNim, truncateAddress } from '../lib/format';

interface StatsSummary {
  balance: string;
  claims: Record<string, number>;
  blocked: Record<string, number>;
  successRate: number;
  recentClaims: {
    id: string;
    createdAt: string | number;
    address: string;
    amountLuna: string;
    status: string;
    decision: string;
    txId: string | null;
    rejectionReason: string | null;
  }[];
  recentBlocked: {
    id: string;
    createdAt: string | number;
    address: string;
    amountLuna: string;
    status: string;
    decision: string;
    txId: string | null;
    rejectionReason: string | null;
  }[];
  topRejectionReasons: { reason: string; count: number }[];
}

interface SystemEvent {
  type: string;
  message: string;
  detail?: string;
  ts: number;
}

interface ReadyCheck {
  ready: boolean;
  checks: Record<string, string>;
}

const stats = ref<StatsSummary | null>(null);
const selectedClaim = ref<StatsSummary['recentClaims'][number] | null>(null);
const events = ref<SystemEvent[]>([]);
const health = ref<ReadyCheck | null>(null);
const loading = ref(true);

async function fetchAll() {
  const base = window.location.origin;
  const [statsRes, eventsRes, healthRes] = await Promise.allSettled([
    fetch(`${base}/v1/stats/summary`).then(r => r.json()),
    fetch(`${base}/v1/events`).then(r => r.json()),
    fetch(`${base}/readyz`).then(r => r.json()),
  ]);
  if (statsRes.status === 'fulfilled') stats.value = statsRes.value;
  if (eventsRes.status === 'fulfilled') events.value = eventsRes.value.events ?? [];
  if (healthRes.status === 'fulfilled') health.value = healthRes.value;
  loading.value = false;
}

let pollTimer: ReturnType<typeof setInterval>;
onMounted(() => {
  fetchAll();
  pollTimer = setInterval(fetchAll, 30_000);
});
onUnmounted(() => clearInterval(pollTimer));
</script>

<template>
  <main class="flex-grow max-w-7xl mx-auto w-full px-8 py-16 space-y-24">
    <div v-if="loading" class="text-center text-on-surface-variant py-24 font-body">Loading...</div>

    <template v-else>
      <!-- Faucet Performance -->
      <section class="space-y-12">
        <div class="flex justify-between items-end">
          <div>
            <h2 class="font-headline text-3xl font-bold text-on-surface tracking-tight">Faucet Performance</h2>
            <p class="text-on-surface-variant leading-relaxed mt-2 font-body">Metrics on distribution and security measures.</p>
          </div>
          <div class="text-right">
            <p class="text-sm text-on-surface-variant font-medium mb-1 font-body">Current Balance</p>
            <div class="font-mono text-4xl text-primary font-bold">
              {{ stats ? lunaToNim(stats.balance) : '—' }}
              <span class="text-2xl text-on-surface-variant font-medium">NIM</span>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
          <!-- Successful Claims -->
          <div class="bg-surface-container-low rounded-xl p-8">
            <h3 class="font-headline text-lg font-bold mb-6 flex items-center gap-2">
              <span class="text-primary-container">💧</span> Successful Claims
            </h3>
            <div class="grid grid-cols-3 gap-4">
              <div class="bg-surface-container-lowest p-4 rounded-lg">
                <p class="text-xs text-on-surface-variant font-medium mb-1 font-body">24h</p>
                <p class="font-mono text-xl font-semibold">{{ stats?.claims?.['24h'] ?? 0 }}</p>
              </div>
              <div class="bg-surface-container-lowest p-4 rounded-lg">
                <p class="text-xs text-on-surface-variant font-medium mb-1 font-body">7d</p>
                <p class="font-mono text-xl font-semibold">{{ stats?.claims?.['7d'] ?? 0 }}</p>
              </div>
              <div class="bg-surface-container-lowest p-4 rounded-lg">
                <p class="text-xs text-on-surface-variant font-medium mb-1 font-body">1h</p>
                <p class="font-mono text-xl font-semibold">{{ stats?.claims?.['1h'] ?? 0 }}</p>
              </div>
            </div>
          </div>

          <!-- Abuse Attempts Stopped -->
          <div class="bg-surface-container-low rounded-xl p-8">
            <h3 class="font-headline text-lg font-bold mb-6 flex items-center gap-2">
              <span class="text-error">🛡️</span> Abuse Attempts Stopped
            </h3>
            <div class="grid grid-cols-3 gap-4">
              <div class="bg-surface-container-lowest p-4 rounded-lg">
                <p class="text-xs text-on-surface-variant font-medium mb-1 font-body">24h</p>
                <p class="font-mono text-xl font-semibold text-error">{{ stats?.blocked?.['24h'] ?? 0 }}</p>
              </div>
              <div class="bg-surface-container-lowest p-4 rounded-lg">
                <p class="text-xs text-on-surface-variant font-medium mb-1 font-body">7d</p>
                <p class="font-mono text-xl font-semibold text-error">{{ stats?.blocked?.['7d'] ?? 0 }}</p>
              </div>
              <div class="bg-surface-container-lowest p-4 rounded-lg">
                <p class="text-xs text-on-surface-variant font-medium mb-1 font-body">1h</p>
                <p class="font-mono text-xl font-semibold text-error">{{ stats?.blocked?.['1h'] ?? 0 }}</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Recent Claims Log -->
        <div class="bg-surface-container-lowest rounded-xl shadow-soft-sm p-8">
          <div class="flex justify-between items-center mb-8">
            <h3 class="font-headline text-xl font-bold">Recent Claims Log</h3>
            <RouterLink to="/log" class="text-primary font-label font-semibold text-sm flex items-center gap-1 hover:opacity-80 transition-opacity">
              View Full Log →
            </RouterLink>
          </div>
          <div v-if="!stats?.recentClaims?.length" class="text-sm text-on-surface-variant py-8 text-center font-body">
            No claims yet
          </div>
          <div v-else class="space-y-4">
            <div
              v-for="c in stats.recentClaims.slice(0, 5)"
              :key="c.id"
              class="grid grid-cols-12 gap-4 items-center bg-surface-container-low p-4 rounded-lg text-sm cursor-pointer hover:bg-surface-container transition-colors"
              @click="selectedClaim = c"
            >
              <div class="col-span-6 font-mono text-on-surface font-medium truncate pr-4">{{ truncateAddress(c.address) }}</div>
              <div class="col-span-3 text-on-surface-variant font-mono">{{ timeAgo(c.createdAt) }}</div>
              <div class="col-span-3 text-right font-mono font-semibold" :class="c.status === 'rejected' ? 'text-error' : 'text-primary'">
                {{ c.status === 'rejected' ? c.rejectionReason ?? 'Blocked' : `+${lunaToNim(c.amountLuna)} NIM` }}
              </div>
            </div>
          </div>
        </div>

        <!-- Recent Attempts Stopped -->
        <div class="bg-surface-container-lowest rounded-xl shadow-soft-sm p-8">
          <div class="flex justify-between items-center mb-8">
            <h3 class="font-headline text-xl font-bold">Recent Attempts Stopped</h3>
            <RouterLink to="/log?status=rejected" class="text-primary font-label font-semibold text-sm flex items-center gap-1 hover:opacity-80 transition-opacity">
              View Full Log →
            </RouterLink>
          </div>
          <div v-if="!stats?.recentBlocked?.length" class="text-sm text-on-surface-variant py-8 text-center font-body">
            No blocked attempts
          </div>
          <div v-else class="space-y-4">
            <div
              v-for="c in stats.recentBlocked.slice(0, 5)"
              :key="c.id"
              class="grid grid-cols-12 gap-4 items-center bg-error-container/20 p-4 rounded-lg text-sm cursor-pointer hover:bg-error-container/30 transition-colors"
              @click="selectedClaim = c"
            >
              <div class="col-span-5 font-mono text-on-surface font-medium truncate pr-4">{{ truncateAddress(c.address) }}</div>
              <div class="col-span-3 text-on-surface-variant font-mono">{{ timeAgo(c.createdAt) }}</div>
              <div class="col-span-4 text-right font-mono font-semibold text-error truncate">
                {{ c.rejectionReason ?? 'Blocked' }}
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- System Health -->
      <section class="grid grid-cols-1 md:grid-cols-12 gap-8 items-start">
        <div class="md:col-span-4 space-y-6">
          <h2 class="font-headline text-3xl font-bold text-on-surface tracking-tight">System Health</h2>
          <p class="text-on-surface-variant leading-relaxed font-body">Real-time status and operational metrics for the faucet infrastructure.</p>
          <div class="bg-surface-container-low rounded-xl p-8 space-y-6">
            <div class="flex items-center gap-4">
              <div
                class="px-4 py-2 rounded-full font-label font-bold flex items-center gap-2 text-sm"
                :class="health?.ready ? 'bg-[#21BCA5]/10 text-[#21BCA5]' : 'bg-error/10 text-error'"
              >
                <span class="w-2.5 h-2.5 rounded-full animate-pulse" :class="health?.ready ? 'bg-[#21BCA5]' : 'bg-error'"></span>
                {{ health?.ready ? 'Operational' : 'Degraded' }}
              </div>
            </div>
            <div class="pt-4 space-y-4">
              <div class="flex justify-between items-center text-sm">
                <span class="text-on-surface-variant font-medium font-body">Version</span>
                <span class="font-mono text-primary font-medium">v2.2.0</span>
              </div>
            </div>
          </div>
        </div>

        <div class="md:col-span-8 bg-surface-container-lowest rounded-xl shadow-soft-sm p-8">
          <div class="flex justify-between items-center mb-8">
            <h3 class="font-headline text-xl font-bold">System Events</h3>
          </div>
          <div v-if="!events.length" class="text-sm text-on-surface-variant py-8 text-center font-body">
            No events yet
          </div>
          <div v-else class="space-y-4">
            <div v-for="(e, i) in events.slice(0, 5)" :key="i" class="flex gap-6 items-start bg-surface-container-low p-4 rounded-lg">
              <span class="text-[#21BCA5] mt-0.5 text-xl">✓</span>
              <div>
                <p class="font-medium text-on-surface font-body">{{ e.message }}</p>
                <p class="text-sm text-on-surface-variant font-mono mt-1">{{ timeAgo(e.ts) }}</p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </template>

    <ClaimDetailModal v-if="selectedClaim" :claim="selectedClaim" @close="selectedClaim = null" />
  </main>
</template>
