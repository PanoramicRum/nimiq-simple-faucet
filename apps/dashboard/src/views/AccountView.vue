<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, ApiError } from '../lib/api';
import { formatLuna, formatTimestamp, truncateMiddle } from '../lib/format';

interface Payout {
  id: string;
  address: string;
  amountLuna: string | null;
  txId: string | null;
  createdAt: string | number;
  status: string;
}

interface AccountResponse {
  address: string;
  balance: string;
  recentPayouts: Payout[];
}

const data = ref<AccountResponse | null>(null);
const error = ref<string | null>(null);
const loading = ref<boolean>(true);

const sendForm = ref<{ to: string; amountLuna: string; memo: string; totp: string }>({
  to: '',
  amountLuna: '',
  memo: '',
  totp: '',
});
const sending = ref<boolean>(false);
const sendResult = ref<string | null>(null);

const rotateOpen = ref<boolean>(false);
const rotateTotp = ref<string>('');
const rotateConfirm = ref<string>('');
const rotating = ref<boolean>(false);
const rotateResult = ref<string | null>(null);

async function load(): Promise<void> {
  try {
    data.value = await api.get<AccountResponse>('/admin/account');
    error.value = null;
  } catch (err) {
    if (err instanceof ApiError) error.value = err.message;
    else if (err instanceof Error) error.value = err.message;
    else error.value = 'failed to load account';
  } finally {
    loading.value = false;
  }
}

async function onSend(): Promise<void> {
  sendResult.value = null;
  if (!sendForm.value.to || !sendForm.value.amountLuna || !sendForm.value.totp) return;
  sending.value = true;
  try {
    const body: { to: string; amountLuna: string; memo?: string } = {
      to: sendForm.value.to,
      amountLuna: sendForm.value.amountLuna,
    };
    if (sendForm.value.memo) body.memo = sendForm.value.memo;
    const res = await api.post<{ txId: string }>('/admin/account/send', body, {
      totp: sendForm.value.totp,
    });
    sendResult.value = `Sent. Tx: ${res.txId}`;
    sendForm.value.to = '';
    sendForm.value.amountLuna = '';
    sendForm.value.memo = '';
    sendForm.value.totp = '';
    await load();
  } catch (err) {
    sendResult.value = err instanceof Error ? err.message : 'failed';
  } finally {
    sending.value = false;
  }
}

async function onRotate(): Promise<void> {
  rotateResult.value = null;
  if (rotateConfirm.value !== 'ROTATE' || !rotateTotp.value) return;
  rotating.value = true;
  try {
    const res = await api.post<{ rotatedAt: string }>(
      '/admin/account/rotate-key',
      {},
      { totp: rotateTotp.value },
    );
    rotateResult.value = `Rotated at ${res.rotatedAt}`;
    rotateTotp.value = '';
    rotateConfirm.value = '';
    rotateOpen.value = false;
  } catch (err) {
    rotateResult.value = err instanceof Error ? err.message : 'failed';
  } finally {
    rotating.value = false;
  }
}

onMounted(load);
</script>

<template>
  <section aria-labelledby="acct-heading" class="flex flex-col gap-4">
    <header class="flex items-center justify-between">
      <h2 id="acct-heading" class="text-base font-semibold">Account</h2>
      <button type="button" class="btn-secondary" :disabled="loading" @click="load">Refresh</button>
    </header>

    <p
      v-if="error"
      class="rounded-md border border-[color:var(--color-danger)]/30 bg-[color:var(--color-danger)]/10 px-3 py-2 text-sm"
      role="alert"
    >
      {{ error }}
    </p>

    <div v-if="data" class="grid grid-cols-1 gap-3 md:grid-cols-2">
      <div class="card p-4">
        <div class="muted text-xs uppercase">Faucet address</div>
        <div class="mt-1 break-all font-mono text-sm">{{ data.address || '—' }}</div>
      </div>
      <div class="card p-4">
        <div class="muted text-xs uppercase">Balance</div>
        <div class="mt-1 text-xl font-semibold">{{ formatLuna(data.balance) }}</div>
      </div>
    </div>

    <div class="card p-4">
      <h3 class="mb-3 text-sm font-semibold">Send from faucet (TOTP step-up)</h3>
      <form class="flex flex-wrap items-end gap-3" @submit.prevent="onSend">
        <label class="flex min-w-[12rem] flex-1 flex-col gap-1 text-xs">
          <span>To address</span>
          <input v-model="sendForm.to" class="input font-mono" required />
        </label>
        <label class="flex flex-col gap-1 text-xs">
          <span>Amount (luna)</span>
          <input
            v-model="sendForm.amountLuna"
            class="input font-mono"
            inputmode="numeric"
            pattern="[0-9]+"
            required
          />
        </label>
        <label class="flex flex-col gap-1 text-xs">
          <span>Memo</span>
          <input v-model="sendForm.memo" class="input" maxlength="256" />
        </label>
        <label class="flex flex-col gap-1 text-xs">
          <span>TOTP</span>
          <input
            v-model="sendForm.totp"
            class="input font-mono tracking-widest"
            inputmode="numeric"
            maxlength="6"
            pattern="[0-9]{6}"
            required
          />
        </label>
        <button type="submit" class="btn-primary" :disabled="sending">
          {{ sending ? 'Sending…' : 'Send' }}
        </button>
      </form>
      <p v-if="sendResult" class="mt-2 text-sm" role="status">{{ sendResult }}</p>
    </div>

    <div class="card p-4">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold">Rotate signing key</h3>
        <button type="button" class="btn-danger" @click="rotateOpen = !rotateOpen">
          {{ rotateOpen ? 'Cancel' : 'Rotate key…' }}
        </button>
      </div>
      <form v-if="rotateOpen" class="mt-3 flex flex-wrap items-end gap-3" @submit.prevent="onRotate">
        <label class="flex flex-col gap-1 text-xs">
          <span>Type ROTATE to confirm</span>
          <input v-model="rotateConfirm" class="input font-mono" required />
        </label>
        <label class="flex flex-col gap-1 text-xs">
          <span>TOTP</span>
          <input
            v-model="rotateTotp"
            class="input font-mono tracking-widest"
            inputmode="numeric"
            maxlength="6"
            pattern="[0-9]{6}"
            required
          />
        </label>
        <button
          type="submit"
          class="btn-danger"
          :disabled="rotating || rotateConfirm !== 'ROTATE'"
        >
          {{ rotating ? 'Rotating…' : 'Confirm rotate' }}
        </button>
      </form>
      <p v-if="rotateResult" class="mt-2 text-sm" role="status">{{ rotateResult }}</p>
    </div>

    <div v-if="data" class="card overflow-x-auto">
      <h3 class="px-3 pt-3 text-sm font-semibold">Recent payouts</h3>
      <table class="table w-full text-sm">
        <thead>
          <tr>
            <th>Created</th>
            <th>Address</th>
            <th>Amount</th>
            <th>Status</th>
            <th>Tx</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="p in data.recentPayouts"
            :key="p.id"
            class="!cursor-default hover:!bg-transparent"
          >
            <td class="font-mono text-xs">{{ formatTimestamp(p.createdAt) }}</td>
            <td class="font-mono text-xs">{{ truncateMiddle(p.address, 10, 6) }}</td>
            <td class="font-mono text-xs">{{ formatLuna(p.amountLuna) }}</td>
            <td>{{ p.status }}</td>
            <td class="font-mono text-xs">{{ p.txId ? truncateMiddle(p.txId, 8, 8) : '—' }}</td>
          </tr>
          <tr v-if="data.recentPayouts.length === 0">
            <td colspan="5" class="muted text-center text-sm">No payouts yet.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
