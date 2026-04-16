import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api, ApiError } from '../lib/api';
import { readCookie } from '../lib/cookie';

export interface LoginResult {
  ok: true;
  expiresAt: string;
  totpProvisioningUri?: string;
  totpSecret?: string;
}

interface LoginResponse {
  ok: true;
  expiresAt: string;
  totpProvisioningUri?: string;
  totpSecret?: string;
}

interface OverviewProbe {
  balance: string;
}

/**
 * Authentication state for the admin dashboard.
 *
 * We cannot read the HttpOnly `faucet_session` cookie, but the server also
 * sets a readable `faucet_csrf` cookie on login. Its presence is a strong
 * hint that we have a session; `probe()` confirms by hitting `/admin/overview`
 * which 401s when the session is missing/expired.
 */
export const useAuthStore = defineStore('auth', () => {
  const csrfPresent = ref<boolean>(readCookie('faucet_csrf') !== null);
  const probed = ref<boolean>(false);
  const sessionValid = ref<boolean>(false);
  const user = ref<{ userId: string } | null>(null);

  const isAuthenticated = computed<boolean>(() => {
    if (probed.value) return sessionValid.value;
    return csrfPresent.value;
  });

  function csrfToken(): string | null {
    return readCookie('faucet_csrf');
  }

  function refreshCsrfFlag(): void {
    csrfPresent.value = readCookie('faucet_csrf') !== null;
  }

  async function login(password: string, totp?: string): Promise<LoginResult> {
    const body: { password: string; totp?: string } = { password };
    if (totp) body.totp = totp;
    const res = await api.post<LoginResponse>('/admin/auth/login', body);
    refreshCsrfFlag();
    probed.value = true;
    sessionValid.value = true;
    user.value = { userId: 'admin' };
    const out: LoginResult = { ok: true, expiresAt: res.expiresAt };
    if (res.totpProvisioningUri) out.totpProvisioningUri = res.totpProvisioningUri;
    if (res.totpSecret) out.totpSecret = res.totpSecret;
    return out;
  }

  async function logout(): Promise<void> {
    try {
      await api.post<{ ok: true }>('/admin/auth/logout', {});
    } catch {
      // Best-effort — clear local state even if the server call fails.
    }
    refreshCsrfFlag();
    probed.value = true;
    sessionValid.value = false;
    user.value = null;
  }

  async function probe(): Promise<boolean> {
    try {
      await api.get<OverviewProbe>('/admin/overview');
      probed.value = true;
      sessionValid.value = true;
      user.value = { userId: 'admin' };
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        probed.value = true;
        sessionValid.value = false;
        user.value = null;
        return false;
      }
      // Network or other error — leave state untouched, treat as not probed.
      return sessionValid.value;
    }
  }

  function clearLocal(): void {
    probed.value = true;
    sessionValid.value = false;
    user.value = null;
    refreshCsrfFlag();
  }

  return {
    user,
    isAuthenticated,
    csrfToken,
    login,
    logout,
    probe,
    clearLocal,
    refreshCsrfFlag,
  };
});
