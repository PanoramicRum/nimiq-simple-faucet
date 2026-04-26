/**
 * Typed fetch wrapper for the admin API.
 *
 * - Always `credentials: 'include'` so the HttpOnly session cookie travels.
 * - Mutating methods attach `X-Faucet-Csrf` from the readable CSRF cookie.
 * - Optional `totp` attaches `X-Faucet-Totp` for step-up routes.
 * - On 401 we clear the auth store and navigate to `/admin/login`.
 *
 * Deliberately minimal — no global error toast, each caller decides how to
 * render the `ApiError`.
 */
import { readAdminCookie } from './cookie';

export interface ApiOptions {
  totp?: string;
  signal?: AbortSignal;
  query?: Record<string, string | number | boolean | undefined>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

type LogoutHandler = () => void;
let onUnauthorized: LogoutHandler | null = null;

export function setUnauthorizedHandler(fn: LogoutHandler): void {
  onUnauthorized = fn;
}

function buildUrl(path: string, query?: ApiOptions['query']): string {
  if (!query) return path;
  const u = new URL(path, window.location.origin);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    u.searchParams.set(k, String(v));
  }
  return u.pathname + (u.search ? u.search : '');
}

async function request<T>(
  method: string,
  path: string,
  body: unknown,
  opts: ApiOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {
    accept: 'application/json',
  };
  const isMutation = method !== 'GET' && method !== 'HEAD';
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  if (isMutation) {
    const csrf = readAdminCookie('faucet_csrf');
    if (csrf) headers['x-faucet-csrf'] = csrf;
  }
  if (opts.totp) {
    headers['x-faucet-totp'] = opts.totp;
  }

  const init: RequestInit = {
    method,
    credentials: 'include',
    headers,
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  if (opts.signal) init.signal = opts.signal;

  const url = buildUrl(path, opts.query);
  const res = await fetch(url, init);

  let parsed: unknown = null;
  const text = await res.text();
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!res.ok) {
    if (res.status === 401) {
      if (onUnauthorized) onUnauthorized();
    }
    const msg =
      (parsed && typeof parsed === 'object' && 'error' in parsed
        ? String((parsed as { error: unknown }).error)
        : res.statusText) || `HTTP ${res.status}`;
    throw new ApiError(msg, res.status, parsed);
  }
  return parsed as T;
}

export const api = {
  get<T>(path: string, opts?: ApiOptions): Promise<T> {
    return request<T>('GET', path, undefined, opts);
  },
  post<T>(path: string, body?: unknown, opts?: ApiOptions): Promise<T> {
    return request<T>('POST', path, body, opts);
  },
  patch<T>(path: string, body?: unknown, opts?: ApiOptions): Promise<T> {
    return request<T>('PATCH', path, body, opts);
  },
  del<T>(path: string, opts?: ApiOptions): Promise<T> {
    return request<T>('DELETE', path, undefined, opts);
  },
};
