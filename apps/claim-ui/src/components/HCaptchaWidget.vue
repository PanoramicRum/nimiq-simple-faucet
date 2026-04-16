<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { t } from '../i18n/en';

interface Props {
  siteKey: string;
  modelValue: string;
}

const props = defineProps<Props>();
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>();

const container = ref<HTMLDivElement | null>(null);
const widgetId = ref<string | null>(null);
const loadError = ref<string | null>(null);

const SCRIPT_SRC = 'https://js.hcaptcha.com/1/api.js?render=explicit';

interface HCaptchaApi {
  render: (
    el: HTMLElement,
    opts: { sitekey: string; callback: (token: string) => void; 'error-callback'?: () => void },
  ) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
}

declare global {
  interface Window {
    hcaptcha?: HCaptchaApi;
  }
}

function ensureScript(): Promise<HCaptchaApi> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.hcaptcha) return Promise.resolve(window.hcaptcha);
  const existing = document.querySelector<HTMLScriptElement>(`script[src^="https://js.hcaptcha.com/1/api.js"]`);
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => {
        if (window.hcaptcha) resolve(window.hcaptcha);
        else reject(new Error('hcaptcha load failed'));
      });
      existing.addEventListener('error', () => reject(new Error('hcaptcha load failed')));
    });
  }
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.addEventListener('load', () => {
      if (window.hcaptcha) resolve(window.hcaptcha);
      else reject(new Error('hcaptcha load failed'));
    });
    s.addEventListener('error', () => reject(new Error('hcaptcha load failed')));
    document.head.appendChild(s);
  });
}

onMounted(async () => {
  try {
    const api = await ensureScript();
    if (!container.value) return;
    widgetId.value = api.render(container.value, {
      sitekey: props.siteKey,
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
    if (!v && widgetId.value && window.hcaptcha) window.hcaptcha.reset(widgetId.value);
  },
);

onBeforeUnmount(() => {
  if (widgetId.value && window.hcaptcha) window.hcaptcha.remove(widgetId.value);
});
</script>

<template>
  <div class="space-y-2">
    <p class="text-sm text-[color:var(--color-muted)]">{{ t('captcha.prompt') }}</p>
    <div ref="container" aria-label="hCaptcha" />
    <p v-if="loadError" class="text-sm text-[color:var(--color-danger)]">{{ loadError }}</p>
  </div>
</template>
