<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, ApiError } from '../lib/api';
import { formatTimestamp } from '../lib/format';

interface Integrator {
  id: string;
  createdAt: string | number;
  lastUsedAt: string | number | null;
  revokedAt: string | number | null;
}

interface ListResponse {
  items: Integrator[];
}

interface CreateResponse {
  id: string;
  apiKey: string;
  hmacSecret: string;
}

const items = ref<Integrator[]>([]);
const loading = ref<boolean>(false);
const error = ref<string | null>(null);

const showCreate = ref<boolean>(false);
const newId = ref<string>('');
const creating = ref<boolean>(false);

const revealed = ref<CreateResponse | null>(null);
const copiedKey = ref<boolean>(false);
const copiedSecret = ref<boolean>(false);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const res = await api.get<ListResponse>('/admin/integrators');
    items.value = res.items;
    error.value = null;
  } catch (err) {
    if (err instanceof ApiError) error.value = err.message;
    else if (err instanceof Error) error.value = err.message;
    else error.value = 'failed to load integrators';
  } finally {
    loading.value = false;
  }
}

async function onCreate(): Promise<void> {
  if (!newId.value) return;
  creating.value = true;
  try {
    const res = await api.post<CreateResponse>('/admin/integrators', { id: newId.value });
    revealed.value = res;
    newId.value = '';
    showCreate.value = false;
    await load();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'failed';
  } finally {
    creating.value = false;
  }
}

async function onRotate(id: string): Promise<void> {
  try {
    const res = await api.post<CreateResponse>(`/admin/integrators/${encodeURIComponent(id)}/rotate`, {});
    revealed.value = res;
    await load();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'failed';
  }
}

async function onDelete(id: string): Promise<void> {
  try {
    await api.del(`/admin/integrators/${encodeURIComponent(id)}`);
    await load();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'failed';
  }
}

async function copy(text: string, which: 'key' | 'secret'): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    if (which === 'key') copiedKey.value = true;
    if (which === 'secret') copiedSecret.value = true;
    setTimeout(() => {
      copiedKey.value = false;
      copiedSecret.value = false;
    }, 2000);
  } catch {
    // ignore clipboard failure
  }
}

function dismissRevealed(): void {
  revealed.value = null;
  copiedKey.value = false;
  copiedSecret.value = false;
}

onMounted(load);
</script>

<template>
  <section aria-labelledby="int-heading" class="flex flex-col gap-4">
    <header class="flex items-center justify-between">
      <h2 id="int-heading" class="text-base font-semibold">Integrators</h2>
      <div class="flex gap-2">
        <button type="button" class="btn-secondary" :disabled="loading" @click="load">
          Refresh
        </button>
        <button type="button" class="btn-primary" @click="showCreate = !showCreate">
          {{ showCreate ? 'Cancel' : 'New integrator' }}
        </button>
      </div>
    </header>

    <p
      v-if="error"
      class="rounded-md border border-[color:var(--color-danger)]/30 bg-[color:var(--color-danger)]/10 px-3 py-2 text-sm"
      role="alert"
    >
      {{ error }}
    </p>

    <form v-if="showCreate" class="card flex flex-wrap items-end gap-3 p-3" @submit.prevent="onCreate">
      <label class="flex min-w-[16rem] flex-1 flex-col gap-1 text-xs">
        <span>Integrator id (alphanumeric / `-` / `_`)</span>
        <input
          v-model="newId"
          class="input font-mono"
          pattern="[a-zA-Z0-9_-]+"
          required
          maxlength="64"
        />
      </label>
      <button type="submit" class="btn-primary" :disabled="creating">
        {{ creating ? 'Creating…' : 'Create' }}
      </button>
    </form>

    <div
      v-if="revealed"
      class="card border-[color:var(--color-warning)]/40 p-4"
      role="alert"
      aria-live="assertive"
    >
      <h3 class="text-sm font-semibold">Save these credentials now</h3>
      <p class="muted mt-1 text-xs">
        The API key and HMAC secret will not be shown again.
      </p>
      <div class="mt-3 flex flex-col gap-3 text-sm">
        <div>
          <div class="muted text-xs uppercase">Integrator</div>
          <div class="font-mono text-xs">{{ revealed.id }}</div>
        </div>
        <div>
          <div class="muted text-xs uppercase">API key</div>
          <div class="flex items-center gap-2">
            <code class="block flex-1 break-all rounded bg-black/5 p-2 font-mono text-xs dark:bg-white/5">
              {{ revealed.apiKey }}
            </code>
            <button type="button" class="btn-secondary" @click="copy(revealed.apiKey, 'key')">
              {{ copiedKey ? 'Copied' : 'Copy' }}
            </button>
          </div>
        </div>
        <div>
          <div class="muted text-xs uppercase">HMAC secret</div>
          <div class="flex items-center gap-2">
            <code class="block flex-1 break-all rounded bg-black/5 p-2 font-mono text-xs dark:bg-white/5">
              {{ revealed.hmacSecret }}
            </code>
            <button type="button" class="btn-secondary" @click="copy(revealed.hmacSecret, 'secret')">
              {{ copiedSecret ? 'Copied' : 'Copy' }}
            </button>
          </div>
        </div>
      </div>
      <div class="mt-3 flex justify-end">
        <button type="button" class="btn-primary" @click="dismissRevealed">I have saved them</button>
      </div>
    </div>

    <div class="card overflow-x-auto">
      <table class="table w-full text-sm">
        <thead>
          <tr>
            <th>Id</th>
            <th>Created</th>
            <th>Last used</th>
            <th>Revoked</th>
            <th class="w-48"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="it in items"
            :key="it.id"
            class="!cursor-default hover:!bg-transparent"
          >
            <td class="font-mono text-xs">{{ it.id }}</td>
            <td class="font-mono text-xs">{{ formatTimestamp(it.createdAt) }}</td>
            <td class="font-mono text-xs">{{ formatTimestamp(it.lastUsedAt) }}</td>
            <td class="font-mono text-xs">{{ formatTimestamp(it.revokedAt) }}</td>
            <td class="flex gap-2">
              <button type="button" class="btn-secondary !px-2 !py-1" @click="onRotate(it.id)">
                Rotate
              </button>
              <button type="button" class="btn-danger !px-2 !py-1" @click="onDelete(it.id)">
                Revoke
              </button>
            </td>
          </tr>
          <tr v-if="items.length === 0 && !loading">
            <td colspan="5" class="muted text-center text-sm">No integrators yet.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
