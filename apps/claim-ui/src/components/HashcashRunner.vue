<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useClient } from '../lib/client';
import { t } from '../i18n/en';

const props = defineProps<{ difficulty: number }>();
const emit = defineEmits<{ (e: 'solved', solution: string): void }>();

const attempts = ref(0);
const done = ref(false);
const error = ref<string | null>(null);
const startedAt = ref<number | null>(null);

let worker: Worker | null = null;
const client = useClient();

// Linear progress against the expected attempt count (2^difficulty).
// Clamp at 90% so the bar doesn't stall at 100% before the nonce is verified.
function progressPct(): number {
  if (done.value) return 100;
  if (attempts.value === 0) return 2;
  const expected = 2 ** props.difficulty;
  return Math.min(90, (attempts.value / expected) * 90 + 2);
}

async function run() {
  try {
    const challenge = await client.requestChallenge();
    startedAt.value = Date.now();
    worker = new Worker(new URL('../workers/hashcash.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (e: MessageEvent<{ type: string; attempts?: number; nonce?: string; message?: string }>) => {
      const data = e.data;
      if (data.type === 'progress' && typeof data.attempts === 'number') {
        attempts.value = data.attempts;
      } else if (data.type === 'done' && typeof data.nonce === 'string') {
        attempts.value = attempts.value || 1;
        done.value = true;
        emit('solved', `${challenge.challenge}#${data.nonce}`);
      } else if (data.type === 'error') {
        error.value = data.message ?? 'worker error';
      }
    };
    worker.onerror = (e) => {
      error.value = e.message || 'worker error';
    };
    worker.postMessage({ challenge: challenge.challenge, difficulty: challenge.difficulty });
  } catch (err) {
    error.value = (err as Error).message;
  }
}

onMounted(run);
onBeforeUnmount(() => {
  worker?.terminate();
  worker = null;
});
</script>

<template>
  <div class="space-y-2" aria-live="polite">
    <div class="flex items-center justify-between text-sm">
      <span class="text-[color:var(--color-muted)]">
        {{ done ? t('challenge.ready') : t('challenge.solving') }}
      </span>
      <span class="tabular-nums text-xs text-[color:var(--color-muted)]">
        {{ t('challenge.attempts', { n: attempts }) }}
      </span>
    </div>
    <div
      class="h-2 w-full overflow-hidden rounded-full bg-surface-muted dark:bg-surface-darkMuted"
      role="progressbar"
      :aria-valuenow="Math.round(progressPct())"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-label="t('challenge.solving')"
    >
      <div
        class="h-full bg-nimiq-500 transition-[width] duration-300 ease-linear"
        :style="{ width: progressPct() + '%' }"
      />
    </div>
    <p v-if="error" class="text-sm text-[color:var(--color-danger)]">{{ error }}</p>
  </div>
</template>
