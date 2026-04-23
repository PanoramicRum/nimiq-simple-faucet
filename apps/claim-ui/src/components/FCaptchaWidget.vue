<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { t } from '../i18n/en';

interface Props {
  siteKey: string;
  serverUrl: string;
  modelValue: string;
}

const props = defineProps<Props>();
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>();

const container = ref<HTMLDivElement | null>(null);
const containerId = `fcaptcha-${Math.random().toString(36).slice(2, 10)}`;
const loadError = ref<string | null>(null);

interface FCaptchaApi {
  configure: (opts: { serverUrl: string }) => void;
  render: (
    elementId: string,
    opts: { siteKey: string; callback: (token: string) => void; 'error-callback'?: () => void },
  ) => void;
  reset?: (elementId: string) => void;
  remove?: (elementId: string) => void;
}

declare global {
  interface Window {
    FCaptcha?: FCaptchaApi;
  }
}

function scriptUrl(serverUrl: string): string {
  return `${serverUrl.replace(/\/$/, '')}/fcaptcha.js`;
}

function ensureScript(serverUrl: string): Promise<FCaptchaApi> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.FCaptcha) return Promise.resolve(window.FCaptcha);
  const src = scriptUrl(serverUrl);
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => {
        if (window.FCaptcha) resolve(window.FCaptcha);
        else reject(new Error('fcaptcha load failed'));
      });
      existing.addEventListener('error', () => reject(new Error('fcaptcha load failed')));
    });
  }
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.defer = true;
    s.addEventListener('load', () => {
      if (window.FCaptcha) resolve(window.FCaptcha);
      else reject(new Error('fcaptcha load failed'));
    });
    s.addEventListener('error', () => reject(new Error('fcaptcha load failed')));
    document.head.appendChild(s);
  });
}

onMounted(async () => {
  try {
    const api = await ensureScript(props.serverUrl);
    api.configure({ serverUrl: props.serverUrl });
    if (!container.value) return;
    api.render(containerId, {
      siteKey: props.siteKey,
      callback: (token: string) => emit('update:modelValue', token),
      'error-callback': () => emit('update:modelValue', ''),
    });
  } catch (err) {
    loadError.value = (err as Error).message;
  }
});

watch(
  () => props.modelValue,
  (v) => {
    if (!v && window.FCaptcha?.reset) window.FCaptcha.reset(containerId);
  },
);

onBeforeUnmount(() => {
  if (window.FCaptcha?.remove) window.FCaptcha.remove(containerId);
});
</script>

<template>
  <div class="space-y-2">
    <p class="text-sm text-[color:var(--color-muted)]">{{ t('captcha.prompt') }}</p>
    <div :id="containerId" ref="container" aria-label="FCaptcha" />
    <p v-if="loadError" class="text-sm text-[color:var(--color-danger)]">{{ loadError }}</p>
  </div>
</template>
