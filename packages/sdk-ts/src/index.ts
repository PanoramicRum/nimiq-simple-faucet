export interface HostContext {
  uid?: string | undefined;
  cookieHash?: string | undefined;
  sessionHash?: string | undefined;
  accountAgeDays?: number | undefined;
  emailDomainHash?: string | undefined;
  kycLevel?: 'none' | 'email' | 'phone' | 'id' | undefined;
  tags?: string[] | undefined;
  signature?: string | undefined;
}

export interface FingerprintBundle {
  visitorId?: string | undefined;
  confidence?: number | undefined;
  components?: Record<string, unknown> | undefined;
}

export interface ClaimOptions {
  hostContext?: HostContext | undefined;
  fingerprint?: FingerprintBundle | undefined;
  captchaToken?: string | undefined;
  hashcashSolution?: string | undefined;
  signal?: AbortSignal | undefined;
}

export type ClaimDecision = 'allow' | 'challenge' | 'review' | 'deny';
export type ClaimStatus = 'queued' | 'broadcast' | 'confirmed' | 'rejected' | 'challenged';

export interface ClaimResponse {
  id: string;
  status: ClaimStatus;
  txId?: string | undefined;
  decision?: ClaimDecision | undefined;
  reason?: string | undefined;
}

export interface HashcashChallenge {
  challenge: string;
  difficulty: number;
  expiresAt: number;
}

export interface FaucetConfig {
  network: 'main' | 'test';
  claimAmountLuna: string;
  abuseLayers: Record<string, boolean>;
  captcha: { provider: 'turnstile' | 'hcaptcha'; siteKey: string } | null;
  hashcash: { difficulty: number; ttlMs: number } | null;
}

export interface FaucetClientOptions {
  url: string;
  /** Integrator API key. Required only for server-to-server HMAC-signed calls. */
  apiKey?: string | undefined;
  /** Integrator HMAC secret. Required only for server-to-server calls. */
  hmacSecret?: string | undefined;
  fetch?: typeof fetch | undefined;
  /** Optional HMAC signer; required in Node when hmacSecret is set and Web Crypto isn't enabled. */
  hmacSigner?: ((secret: string, data: string) => Promise<string> | string) | undefined;
}

export class FaucetError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly decision: ClaimDecision | undefined;

  constructor(message: string, status: number, code?: string, decision?: ClaimDecision) {
    super(message);
    this.name = 'FaucetError';
    this.status = status;
    this.code = code;
    this.decision = decision;
  }
}

export class FaucetClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly apiKey: string | undefined;
  private readonly hmacSecret: string | undefined;
  private readonly hmacSigner: FaucetClientOptions['hmacSigner'];

  constructor(options: FaucetClientOptions) {
    this.baseUrl = options.url.replace(/\/+$/, '');
    // `window.fetch` / `globalThis.fetch` must be invoked with its original
    // `this`; assigning it to an instance field and calling it as a method
    // triggers "Illegal invocation" in browsers. Bind once at construction.
    this.fetchImpl = options.fetch ?? globalThis.fetch?.bind(globalThis);
    this.apiKey = options.apiKey;
    this.hmacSecret = options.hmacSecret;
    this.hmacSigner = options.hmacSigner;
    if (!this.fetchImpl) {
      throw new Error('FaucetClient needs a fetch implementation (none available globally).');
    }
  }

  /**
   * Sign a hostContext with an integrator's HMAC secret. The returned
   * context has `signature` set to `{integratorId}:{base64-hmac}`.
   *
   * Run this on your BACKEND — never expose hmacSecret to the browser.
   * Pass the signed context through to the browser SDK's `claim()` call.
   */
  static signHostContext(
    hostContext: HostContext,
    integratorId: string,
    hmacSecret: string,
  ): HostContext {
    // Inline canonicalization (mirrors @faucet/core's canonicalizeHostContext).
    const FIELDS = ['uid', 'cookieHash', 'sessionHash', 'accountAgeDays', 'emailDomainHash', 'kycLevel', 'tags', 'verifiedIdentities'] as const;
    const entries: [string, unknown][] = [];
    for (const key of FIELDS) {
      const value = (hostContext as Record<string, unknown>)[key];
      if (value === undefined) continue;
      entries.push([key, Array.isArray(value) ? [...value].sort() : value]);
    }
    const canonical = JSON.stringify(entries);
    // Lazy-import Node crypto so this module stays browser-importable.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createHmac } = require('node:crypto') as typeof import('node:crypto');
    const hmac = createHmac('sha256', hmacSecret).update(canonical).digest('base64');
    return { ...hostContext, signature: `${integratorId}:${hmac}` };
  }

  async config(): Promise<FaucetConfig> {
    return this.#get<FaucetConfig>('/v1/config');
  }

  async claim(address: string, options: ClaimOptions = {}): Promise<ClaimResponse> {
    const body = {
      address,
      captchaToken: options.captchaToken,
      hashcashSolution: options.hashcashSolution,
      fingerprint: options.fingerprint,
      hostContext: options.hostContext,
    };
    return this.#post<ClaimResponse>('/v1/claim', body, options.signal);
  }

  /**
   * Request a signed hashcash challenge from the server. Only available when the
   * server has `FAUCET_HASHCASH_SECRET` set; otherwise returns 404.
   */
  async requestChallenge(uid?: string): Promise<HashcashChallenge> {
    return this.#post<HashcashChallenge>('/v1/challenge', uid ? { uid } : {});
  }

  /**
   * Request a challenge, solve it, and claim — all in one call. The `onProgress`
   * callback is invoked every ~2k hashes so UIs can show progress.
   */
  async solveAndClaim(
    address: string,
    options: ClaimOptions & { uid?: string; onProgress?: (attempts: number) => void } = {},
  ): Promise<ClaimResponse> {
    const challenge = await this.requestChallenge(options.uid);
    const nonce = await solveHashcash(challenge.challenge, challenge.difficulty, options.onProgress);
    return this.claim(address, { ...options, hashcashSolution: `${challenge.challenge}#${nonce}` });
  }

  async status(id: string): Promise<ClaimResponse> {
    return this.#get<ClaimResponse>(`/v1/claim/${encodeURIComponent(id)}`);
  }

  async waitForConfirmation(id: string, timeoutMs = 60_000): Promise<ClaimResponse> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const s = await this.status(id);
      if (s.status === 'confirmed' || s.status === 'rejected') return s;
      await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new FaucetError(`Claim ${id} not confirmed in ${timeoutMs}ms`, 408);
  }

  subscribe(onEvent: (event: unknown) => void): () => void {
    const wsUrl = this.baseUrl.replace(/^http/, 'ws') + '/v1/stream';
    const ws = new WebSocket(wsUrl);
    ws.addEventListener('message', (ev) => {
      try {
        onEvent(JSON.parse(ev.data));
      } catch {
        /* ignore malformed frames */
      }
    });
    return () => ws.close();
  }

  async #get<T>(path: string): Promise<T> {
    const res = await this.fetchImpl(this.baseUrl + path);
    return this.#handle<T>(res);
  }

  async #post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const bodyText = JSON.stringify(body);
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.apiKey && this.hmacSecret) {
      const ts = Date.now().toString();
      const nonce = randomNonce();
      const canonical = ['POST', path, ts, nonce, bodyText].join('\n');
      const signature = await this.#sign(canonical);
      headers['x-faucet-api-key'] = this.apiKey;
      headers['x-faucet-timestamp'] = ts;
      headers['x-faucet-nonce'] = nonce;
      headers['x-faucet-signature'] = signature;
    }
    const init: RequestInit = { method: 'POST', headers, body: bodyText };
    if (signal) init.signal = signal;
    const res = await this.fetchImpl(this.baseUrl + path, init);
    return this.#handle<T>(res);
  }

  async #sign(data: string): Promise<string> {
    if (!this.hmacSecret) throw new Error('hmacSecret missing');
    if (this.hmacSigner) {
      return this.hmacSigner(this.hmacSecret, data);
    }
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) {
      throw new Error('WebCrypto unavailable; pass `hmacSigner` to FaucetClient.');
    }
    const key = await subtle.importKey(
      'raw',
      new TextEncoder().encode(this.hmacSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = await subtle.sign('HMAC', key, new TextEncoder().encode(data));
    return toHex(new Uint8Array(sig));
  }

  async #handle<T>(res: Response): Promise<T> {
    const text = await res.text();
    const parsed = text ? safeJson(text) : undefined;
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      if (parsed && typeof parsed === 'object' && 'error' in parsed) {
        const err = (parsed as { error: unknown }).error;
        if (typeof err === 'string') message = err;
      }
      const obj = parsed as { code?: string; decision?: ClaimDecision } | undefined;
      throw new FaucetError(message, res.status, obj?.code, obj?.decision);
    }
    return parsed as T;
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/**
 * Brute-force a hashcash nonce such that `SHA-256(challenge + ":" + nonce)` has
 * at least `difficulty` leading zero bits. Uses WebCrypto; works in browsers,
 * Node 18+, React Native (via polyfill) and Flutter Web. `onProgress` is called
 * every ~2k attempts.
 */
export async function solveHashcash(
  challenge: string,
  difficulty: number,
  onProgress?: (attempts: number) => void,
): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('WebCrypto SHA-256 unavailable');
  const encoder = new TextEncoder();
  let attempts = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const nonce = attempts.toString(36) + '.' + Math.random().toString(36).slice(2);
    const digest = new Uint8Array(await subtle.digest('SHA-256', encoder.encode(`${challenge}:${nonce}`)));
    if (leadingZeroBitsBytes(digest) >= difficulty) return nonce;
    attempts++;
    if (onProgress && attempts % 2048 === 0) onProgress(attempts);
  }
}

function leadingZeroBitsBytes(buf: Uint8Array): number {
  let bits = 0;
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i] as number;
    if (byte === 0) {
      bits += 8;
      continue;
    }
    for (let mask = 0x80; mask > 0; mask >>= 1) {
      if (byte & mask) return bits;
      bits++;
    }
    return bits;
  }
  return bits;
}

function toHex(buf: Uint8Array): string {
  let out = '';
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i] as number;
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}

// Re-export shared managers for framework-specific SDK wrappers.
export { ClaimManager, type ClaimState, type FaucetClaimClient } from './claimManager.js';
export { StatusPoller, type StatusState, type FaucetStatusClient } from './statusPoller.js';
export { StreamManager, type FaucetStreamClient } from './streamManager.js';

function randomNonce(): string {
  const buf = new Uint8Array(16);
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(buf);
  } else {
    for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256);
  }
  return toHex(buf);
}
