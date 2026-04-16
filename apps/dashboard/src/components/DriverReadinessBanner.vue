<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';

const ready = ref<boolean | null>(null);
let timer: ReturnType<typeof setInterval> | null = null;

async function poll(): Promise<void> {
  try {
    const res = await fetch('/readyz', { credentials: 'include' });
    // `/readyz` returns 200 {"ready":true} or 503 {"ready":false,"reason":...}
    const body = (await res.json().catch(() => null)) as { ready?: boolean } | null;
    ready.value = body?.ready === true;
    if (ready.value && timer) {
      clearInterval(timer);
      timer = null;
    }
  } catch {
    ready.value = null;
  }
}

onMounted(() => {
  void poll();
  timer = setInterval(() => void poll(), 10_000);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <div
    v-if="ready === false"
    class="border-b border-yellow-600/30 bg-yellow-500/10 px-4 py-2 text-sm text-yellow-200"
    role="status"
    aria-live="polite"
  >
    <span class="font-medium">Signer driver syncing</span> — the faucet is still
    establishing consensus with the network. Claim endpoints will return
    <code class="mx-1 rounded bg-yellow-900/30 px-1 py-0.5 text-xs">503</code>
    until ready.
  </div>
</template>
