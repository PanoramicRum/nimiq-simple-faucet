/**
 * Framework-agnostic loader for the fcaptcha (https://github.com/WebDecoy/FCaptcha)
 * client widget. Mounts into a host element, returns a promise that resolves
 * when the user solves the puzzle.
 *
 * The faucet's `/v1/config` endpoint exposes `captcha.serverUrl` (the fcaptcha
 * service URL) and `captcha.siteKey` when fcaptcha is the chosen provider.
 *
 * Security: `serverUrl` flows from `/v1/config` straight into a `<script src>`
 * tag on `document.head`, so a compromised or MITM'd faucet response can pivot
 * to arbitrary JS execution in this app's origin (with full access to the
 * user's NIM address via the Mini App SDK). Two layered checks below:
 *
 *   1. URL parsed via `new URL()` — rejects malformed schemes (data:, javascript:).
 *   2. Origin allow-list — only hosts in `trustedOrigins` are accepted; falls
 *      back to "same origin as VITE_FAUCET_URL" when no list is provided so
 *      the default behaviour matches the operator's stated trust boundary.
 *   3. Plaintext HTTP allowed only for loopback / RFC1918 / .local hosts so
 *      LAN dev still works without inviting a Wi-Fi MITM in production.
 *
 * `index.html` should also ship a CSP `script-src` allow-list as defence in
 * depth — see `nginx.conf` and the `<meta http-equiv>` in `index.html`.
 */

export interface FcaptchaWidget {
  /** Resolves with the captcha token once the user solves it. */
  token: Promise<string>;
  /** Tear down DOM and event listeners. Idempotent. */
  destroy(): void;
}

interface FcaptchaConfig {
  serverUrl: string;
  siteKey: string;
  hostElement: HTMLElement;
  /**
   * Optional explicit allow-list of origins (scheme + host + port) that are
   * permitted to serve the widget bundle. When unset, the parsed origin of
   * `import.meta.env.VITE_FAUCET_URL` is used as the implicit allow-list,
   * which matches the operator's stated trust boundary in `/v1/config`.
   */
  trustedOrigins?: readonly string[];
}

let scriptPromise: Promise<void> | null = null;

function isLocalHost(host: string): boolean {
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return true;
  if (host.endsWith('.local') || host.endsWith('.localhost')) return true;
  // RFC1918 ranges.
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  return false;
}

function assertTrusted(serverUrl: string, trustedOrigins: readonly string[]): URL {
  let parsed: URL;
  try {
    parsed = new URL(serverUrl);
  } catch {
    throw new Error(`fcaptcha: serverUrl is not a valid URL: ${serverUrl}`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`fcaptcha: refusing scheme "${parsed.protocol}" — only http(s) is allowed`);
  }
  if (parsed.protocol === 'http:' && !isLocalHost(parsed.hostname)) {
    throw new Error(
      `fcaptcha: refusing plaintext http:// for non-local host "${parsed.hostname}". ` +
      `Use https in non-LAN deployments.`,
    );
  }
  if (!trustedOrigins.includes(parsed.origin)) {
    throw new Error(
      `fcaptcha: serverUrl origin "${parsed.origin}" is not in the trusted list ` +
      `[${trustedOrigins.join(', ')}]. The faucet returned an unexpected captcha host; ` +
      `aborting widget load to avoid script-injection.`,
    );
  }
  return parsed;
}

function loadScript(serverUrl: string, trustedOrigins: readonly string[]): Promise<void> {
  if (scriptPromise) return scriptPromise;
  const trustedUrl = assertTrusted(serverUrl, trustedOrigins);
  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-fcaptcha]');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => {
        scriptPromise = null;
        reject(new Error('fcaptcha script failed to load'));
      }, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = new URL('/fcaptcha.js', trustedUrl).toString();
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.dataset.fcaptcha = 'true';
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => {
      // Clear the cached promise so the next mount can retry. Without this,
      // a single transient network error poisons every subsequent widget mount
      // for the lifetime of the page.
      scriptPromise = null;
      script.remove();
      reject(new Error('fcaptcha script failed to load'));
    }, { once: true });
    document.head.appendChild(script);
  });
  return scriptPromise;
}

interface FcaptchaGlobal {
  render(host: HTMLElement, opts: {
    siteKey: string;
    serverUrl: string;
    callback: (token: string) => void;
    'error-callback'?: (err: unknown) => void;
  }): { reset(): void };
}

declare global {
  interface Window {
    fcaptcha?: FcaptchaGlobal;
  }
}

function defaultTrustedOrigins(): readonly string[] {
  // Implicit allow-list = the faucet origin we were built against. Operators
  // pass an explicit `trustedOrigins` when the captcha host differs from the
  // faucet host (e.g. a CDN-fronted captcha.example.com).
  const faucetUrl = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_FAUCET_URL;
  if (!faucetUrl) return [];
  try {
    return [new URL(faucetUrl).origin];
  } catch {
    return [];
  }
}

export async function loadFcaptcha({
  serverUrl,
  siteKey,
  hostElement,
  trustedOrigins,
}: FcaptchaConfig): Promise<FcaptchaWidget> {
  const allow = trustedOrigins && trustedOrigins.length > 0 ? trustedOrigins : defaultTrustedOrigins();
  if (allow.length === 0) {
    throw new Error(
      'fcaptcha: no trustedOrigins provided and VITE_FAUCET_URL is unset; ' +
      'cannot validate the captcha host. Set VITE_FAUCET_URL at build time ' +
      'or pass an explicit trustedOrigins list.',
    );
  }
  await loadScript(serverUrl, allow);
  if (!window.fcaptcha) {
    throw new Error('fcaptcha global missing after script load');
  }
  let resolveToken!: (token: string) => void;
  let rejectToken!: (err: Error) => void;
  const token = new Promise<string>((resolve, reject) => {
    resolveToken = resolve;
    rejectToken = reject;
  });
  const widget = window.fcaptcha.render(hostElement, {
    siteKey,
    serverUrl,
    callback: (t) => resolveToken(t),
    'error-callback': (err) => rejectToken(err instanceof Error ? err : new Error(String(err))),
  });
  return {
    token,
    destroy: () => {
      try {
        widget.reset();
      } catch {
        // already torn down
      }
      hostElement.replaceChildren();
    },
  };
}
