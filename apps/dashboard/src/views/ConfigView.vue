<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { api, ApiError } from '../lib/api';

interface LayerFlags {
  turnstile: boolean;
  hcaptcha: boolean;
  hashcash: boolean;
  geoip: boolean;
  fingerprint: boolean;
  onchain: boolean;
  ai: boolean;
}

interface ConfigResponse {
  base: {
    claimAmountLuna: string;
    rateLimitPerIpPerDay: number;
    abuseDenyThreshold: number;
    abuseReviewThreshold: number;
    layers: LayerFlags;
  };
  overrides: Record<string, unknown>;
}

type PatchBody = {
  claimAmountLuna?: string;
  rateLimitPerIpPerDay?: number;
  abuseDenyThreshold?: number;
  abuseReviewThreshold?: number;
  layers?: Partial<LayerFlags>;
};

const loading = ref<boolean>(true);
const saving = ref<boolean>(false);
const error = ref<string | null>(null);
const status = ref<string | null>(null);
const overrides = ref<Record<string, unknown>>({});

const form = reactive({
  claimAmountLuna: '',
  rateLimitPerIpPerDay: 50,
  abuseDenyThreshold: 0.8,
  abuseReviewThreshold: 0.5,
  layers: {
    turnstile: false,
    hcaptcha: false,
    hashcash: false,
    geoip: false,
    fingerprint: false,
    onchain: false,
    ai: false,
  } as LayerFlags,
});

async function load(): Promise<void> {
  loading.value = true;
  try {
    const res = await api.get<ConfigResponse>('/admin/config');
    form.claimAmountLuna = res.base.claimAmountLuna;
    form.rateLimitPerIpPerDay = res.base.rateLimitPerIpPerDay;
    form.abuseDenyThreshold = res.base.abuseDenyThreshold;
    form.abuseReviewThreshold = res.base.abuseReviewThreshold;
    form.layers = { ...res.base.layers };
    overrides.value = res.overrides;
    error.value = null;
  } catch (err) {
    if (err instanceof ApiError) error.value = err.message;
    else if (err instanceof Error) error.value = err.message;
    else error.value = 'failed to load config';
  } finally {
    loading.value = false;
  }
}

async function onSave(): Promise<void> {
  saving.value = true;
  status.value = null;
  try {
    const body: PatchBody = {
      claimAmountLuna: form.claimAmountLuna,
      rateLimitPerIpPerDay: Number(form.rateLimitPerIpPerDay),
      abuseDenyThreshold: Number(form.abuseDenyThreshold),
      abuseReviewThreshold: Number(form.abuseReviewThreshold),
      layers: { ...form.layers },
    };
    const res = await api.patch<{ ok: true; persistedKeys: string[] }>('/admin/config', body);
    status.value = `Saved \u2014 restart the faucet to apply: ${res.persistedKeys.join(', ')}`;
    await load();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'failed';
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <section aria-labelledby="cfg-heading" class="flex flex-col gap-4">
    <header class="flex items-center justify-between">
      <h2 id="cfg-heading" class="text-base font-semibold">Config</h2>
      <button type="button" class="btn-secondary" :disabled="loading" @click="load">Refresh</button>
    </header>

    <div
      class="rounded-md border border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning)]/10 p-3 text-sm"
      role="note"
    >
      <strong>Restart required.</strong> Saved overrides are persisted but not applied to the
      running server until the faucet container is restarted. Hot-reload is planned for a future
      release.
    </div>

    <p
      v-if="error"
      class="rounded-md border border-[color:var(--color-danger)]/30 bg-[color:var(--color-danger)]/10 px-3 py-2 text-sm"
      role="alert"
    >
      {{ error }}
    </p>
    <p v-if="status" class="text-sm" role="status">{{ status }}</p>

    <form class="card flex flex-col gap-4 p-4" @submit.prevent="onSave">
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label class="flex flex-col gap-1 text-xs">
          <span>Claim amount (luna)</span>
          <input
            v-model="form.claimAmountLuna"
            class="input font-mono"
            pattern="[0-9]+"
            required
          />
        </label>
        <label class="flex flex-col gap-1 text-xs">
          <span>Rate limit per IP per day</span>
          <input
            v-model.number="form.rateLimitPerIpPerDay"
            class="input font-mono"
            type="number"
            min="1"
            max="10000"
            required
          />
        </label>
        <label class="flex flex-col gap-1 text-xs">
          <span>Abuse deny threshold (0–1)</span>
          <input
            v-model.number="form.abuseDenyThreshold"
            class="input font-mono"
            type="number"
            min="0"
            max="1"
            step="0.01"
            required
          />
        </label>
        <label class="flex flex-col gap-1 text-xs">
          <span>Abuse review threshold (0–1)</span>
          <input
            v-model.number="form.abuseReviewThreshold"
            class="input font-mono"
            type="number"
            min="0"
            max="1"
            step="0.01"
            required
          />
        </label>
      </div>

      <fieldset class="flex flex-wrap gap-3">
        <legend class="text-xs font-semibold">Abuse layers</legend>
        <label
          v-for="(_, k) in form.layers"
          :key="k"
          class="flex items-center gap-2 text-sm"
        >
          <input v-model="form.layers[k]" type="checkbox" />
          <span>{{ k }}</span>
        </label>
      </fieldset>

      <div class="flex justify-end">
        <button type="submit" class="btn-primary" :disabled="saving || loading">
          {{ saving ? 'Saving…' : 'Save' }}
        </button>
      </div>
    </form>

    <details v-if="Object.keys(overrides).length > 0" class="card p-3">
      <summary class="cursor-pointer text-sm font-semibold">Persisted overrides</summary>
      <pre class="mt-2 overflow-auto font-mono text-xs">{{ JSON.stringify(overrides, null, 2) }}</pre>
    </details>
  </section>
</template>
