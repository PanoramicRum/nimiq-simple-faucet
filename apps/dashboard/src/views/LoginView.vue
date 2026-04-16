<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { ApiError } from '../lib/api';
import { qrSvgDataUrl } from '../lib/qr';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const password = ref<string>('');
const totp = ref<string>('');
const submitting = ref<boolean>(false);
const error = ref<string | null>(null);
const firstLoginUri = ref<string | null>(null);
const firstLoginSecret = ref<string | null>(null);
const copied = ref<boolean>(false);

const qrSrc = computed<string | null>(() =>
  firstLoginUri.value ? qrSvgDataUrl(firstLoginUri.value) : null,
);

function nextPath(): string {
  const next = route.query['next'];
  if (typeof next === 'string' && next.startsWith('/admin/') && !next.startsWith('/admin/login')) {
    return next;
  }
  return '/admin/overview';
}

function onTotpInput(e: Event): void {
  const el = e.target as HTMLInputElement;
  const digits = el.value.replace(/\D/g, '').slice(0, 6);
  totp.value = digits;
  el.value = digits;
}

async function onSubmit(): Promise<void> {
  error.value = null;
  submitting.value = true;
  try {
    const res = await auth.login(password.value, totp.value || undefined);
    password.value = '';
    totp.value = '';
    if (res.totpProvisioningUri) {
      firstLoginUri.value = res.totpProvisioningUri;
      firstLoginSecret.value = res.totpSecret ?? null;
      // Don't auto-redirect: operator must capture the secret.
      return;
    }
    await nextTick();
    await router.replace(nextPath());
  } catch (err) {
    if (err instanceof ApiError) {
      error.value = err.message;
    } else if (err instanceof Error) {
      error.value = err.message;
    } else {
      error.value = 'login failed';
    }
  } finally {
    submitting.value = false;
  }
}

async function onContinueAfterEnrol(): Promise<void> {
  firstLoginUri.value = null;
  firstLoginSecret.value = null;
  await router.replace(nextPath());
}

async function copyUri(): Promise<void> {
  if (!firstLoginUri.value) return;
  try {
    await navigator.clipboard.writeText(firstLoginUri.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  } catch {
    copied.value = false;
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center p-6">
    <div class="card w-full max-w-md p-6">
      <h1 class="mb-1 text-lg font-semibold">Nimiq Faucet Admin</h1>
      <p class="muted mb-6 text-sm">Sign in to manage the faucet.</p>

      <form v-if="!firstLoginUri" class="flex flex-col gap-3" @submit.prevent="onSubmit">
        <label class="flex flex-col gap-1 text-sm">
          <span>Password</span>
          <input
            v-model="password"
            type="password"
            autocomplete="current-password"
            required
            class="input"
            aria-required="true"
          />
        </label>
        <label class="flex flex-col gap-1 text-sm">
          <span>
            TOTP code
            <span class="muted">(leave blank on very first login)</span>
          </span>
          <input
            :value="totp"
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="6"
            pattern="[0-9]{6}"
            class="input font-mono tracking-[0.4em]"
            aria-label="Six digit authenticator code"
            @input="onTotpInput"
          />
        </label>

        <p
          v-if="error"
          class="rounded-md border border-[color:var(--color-danger)]/30 bg-[color:var(--color-danger)]/10 px-3 py-2 text-sm"
          role="alert"
        >
          {{ error }}
        </p>

        <button type="submit" class="btn-primary mt-2" :disabled="submitting">
          {{ submitting ? 'Signing in…' : 'Sign in' }}
        </button>
      </form>

      <div v-else class="flex flex-col gap-4">
        <div class="rounded-md border border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning)]/10 p-3 text-sm">
          <strong>Save this secret now.</strong> This is the only time it will be shown. Scan the
          QR code with your authenticator app, or paste the URI into it manually.
        </div>

        <div class="flex flex-col items-center gap-3">
          <img
            v-if="qrSrc"
            :src="qrSrc"
            alt="TOTP provisioning QR code"
            width="228"
            height="228"
            class="rounded bg-white p-2"
          />
          <p v-else class="muted text-xs">(QR too large to render; use the URI below.)</p>
        </div>

        <label class="flex flex-col gap-1 text-sm">
          <span>Provisioning URI</span>
          <textarea
            :value="firstLoginUri"
            readonly
            rows="3"
            class="input font-mono text-xs"
            aria-label="TOTP provisioning URI"
          />
        </label>

        <label v-if="firstLoginSecret" class="flex flex-col gap-1 text-sm">
          <span>Raw secret</span>
          <input
            :value="firstLoginSecret"
            readonly
            class="input font-mono"
            aria-label="TOTP shared secret"
          />
        </label>

        <div class="flex items-center justify-between">
          <button type="button" class="btn-secondary" @click="copyUri">
            {{ copied ? 'Copied' : 'Copy URI' }}
          </button>
          <button type="button" class="btn-primary" @click="onContinueAfterEnrol">
            I have saved it — continue
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
