<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useClient } from '../lib/client';
import { t } from '../i18n/en';

interface Props {
  difficulty: number;
}

defineProps<Props>();
const emit = defineEmits<{ (e: 'solved', solution: string): void }>();

const attempts = ref(0);
const done = ref(false);
const error = ref<string | null>(null);
const startedAt = ref<number | null>(null);

let worker: Worker | null = null;
const client = useClient();

// Expected attempts roughly 2^difficulty, so cap the progress bar at a visual estimate.
function progressPct(): number {
  if (done.value) return 100;
  if (!startedAt.value || attempts.value === 0) return 4;
  const elapsed = Date.now() - startedAt.value;
  return Math.min(95, 5 + Math.log2(attempts.value + 2) * 6 + elapsed / 1000);
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
        class="h-full bg-nimiq-500"
        :style="{ width: progressPct() + '%' }"
      />
    </div>
    <p v-if="error" class="text-sm text-[color:var(--color-danger)]">{{ error }}</p>
  </div>
</template>
