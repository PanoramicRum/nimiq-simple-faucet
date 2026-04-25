<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { loadFcaptcha, type FcaptchaWidget } from '@nimiq-faucet/mini-app-claim-shared';

const props = defineProps<{ serverUrl: string; siteKey: string }>();
const emit = defineEmits<{ solved: [token: string]; failed: [error: Error] }>();

const host = ref<HTMLDivElement | null>(null);
let widget: FcaptchaWidget | null = null;

onMounted(async () => {
  if (!host.value) return;
  try {
    widget = await loadFcaptcha({
      serverUrl: props.serverUrl,
      siteKey: props.siteKey,
      hostElement: host.value,
    });
    const token = await widget.token;
    emit('solved', token);
  } catch (err) {
    emit('failed', err instanceof Error ? err : new Error(String(err)));
  }
});

onBeforeUnmount(() => {
  widget?.destroy();
  widget = null;
});
</script>

<template>
  <div ref="host" class="captcha-host" />
</template>
