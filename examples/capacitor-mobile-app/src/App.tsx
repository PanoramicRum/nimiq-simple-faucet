import { useEffect, useMemo, useRef, useState } from 'react';
import { Device, type DeviceInfo } from '@capacitor/device';
import { CapacitorFaucetClient, type ClaimResponse, type FaucetConfig } from '@nimiq-faucet/capacitor';

/**
 * §3.0.7 abuse-layer demo — Capacitor mobile app (React + Vite).
 *
 * Demonstrates the four abuse-layer surfaces that apply on mobile:
 *   1. Device fingerprint — `CapacitorFaucetClient` automatically injects
 *      `fingerprint.visitorId` from `@capacitor/device`'s `Device.getId()`
 *      on every claim. The example also surfaces the platform/model in the
 *      UI so testers can confirm the value the faucet receives.
 *   2. Captcha widget (Turnstile/hCaptcha) — driven by `/v1/config`. Loads
 *      the provider's script in the WebView.
 *   3. Hashcash proof-of-work — `client.solveAndClaim()` does the round trip.
 *   4. `hostContext` — uid + KYC level + accountAgeDays. Production apps
 *      receive a backend-signed context as part of authenticated session
 *      state; this demo sends an unsigned uid for runnability.
 */

const faucetUrl = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_FAUCET_URL || 'http://localhost:8080';
const integratorId = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_INTEGRATOR_ID || 'capacitor-example';

type Phase = 'idle' | 'loading-config' | 'awaiting-captcha' | 'solving-hashcash' | 'submitting' | 'broadcast' | 'confirmed' | 'rejected' | 'error';

function phaseLabel(phase: Phase, attempts: number): string {
  switch (phase) {
    case 'loading-config': return 'Reading server config…';
    case 'solving-hashcash': return `Proof-of-work: ${attempts.toLocaleString()} attempts…`;
    case 'submitting': return 'Submitting claim…';
    case 'broadcast': return 'Broadcast — waiting for confirmation…';
    case 'confirmed': return 'Confirmed!';
    case 'rejected': return 'Rejected';
    case 'error': return 'Something went wrong.';
    default: return '';
  }
}

export default function App() {
  const client = useMemo(() => new CapacitorFaucetClient({ url: faucetUrl }), []);

  const [phase, setPhase] = useState<Phase>('loading-config');
  const [address, setAddress] = useState('');
  const [config, setConfig] = useState<FaucetConfig | null>(null);
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [hashcashAttempts, setHashcashAttempts] = useState(0);
  const [txId, setTxId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const captchaToken = useRef<string | null>(null);
  const captchaRendered = useRef(false);

  const isPending = ['loading-config', 'solving-hashcash', 'submitting', 'broadcast'].includes(phase);
  const captchaRequired = Boolean(config?.captcha) && config?.captcha?.provider !== 'fcaptcha';
  const captchaSatisfied = !captchaRequired || captchaToken.current !== null;
  const canSubmit = !isPending && address.trim().length > 0 && captchaSatisfied;

  // Device info + faucet config + captcha widget on mount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [info, id] = await Promise.all([
          Device.getInfo().catch(() => null),
          Device.getId().then((r) => r.identifier).catch(() => null),
        ]);
        if (cancelled) return;
        setDeviceInfo(info);
        setDeviceId(id);

        const cfg = await client.config();
        if (cancelled) return;
        setConfig(cfg);
        setPhase(cfg.captcha ? 'awaiting-captcha' : 'idle');
        if (cfg.captcha && !captchaRendered.current) {
          await loadCaptchaWidget(cfg);
          captchaRendered.current = true;
        }
      } catch (err) {
        if (cancelled) return;
        setPhase('error');
        setErrorMessage(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => { cancelled = true; };
  }, [client]);

  async function loadCaptchaWidget(cfg: FaucetConfig) {
    if (!cfg.captcha) return;
    const provider = cfg.captcha.provider;
    if (provider === 'fcaptcha') {
      // FCaptcha is the WebView/mini-app fcaptcha pattern; this example
      // targets Turnstile/hCaptcha. fcaptcha would work here too — see
      // examples/mini-app-claim-* for that pattern.
      setErrorMessage('This example renders Turnstile/hCaptcha; the faucet returned fcaptcha.');
      return;
    }
    const src = provider === 'turnstile'
      ? 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      : 'https://js.hcaptcha.com/1/api.js?render=explicit';
    await injectScript(src, `data-${provider}`);
    type CaptchaLib = { render: (el: HTMLElement, o: Record<string, unknown>) => unknown };
    const w = window as Window & { turnstile?: CaptchaLib; hcaptcha?: CaptchaLib };
    const lib = provider === 'turnstile' ? w.turnstile : w.hcaptcha;
    const host = document.getElementById('captcha-host');
    if (!lib || !host) return;
    lib.render(host, {
      sitekey: cfg.captcha.siteKey,
      callback: (token: string) => { captchaToken.current = token; },
      'error-callback': () => { captchaToken.current = null; setErrorMessage('Captcha widget reported an error'); },
      'expired-callback': () => { captchaToken.current = null; },
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setErrorMessage(null);
    setTxId(null);

    // hostContext: production frontends receive a SIGNED context minted
    // by their backend as part of authenticated session state. This demo
    // sends a plain uid so it runs without a backend.
    const hostContext = { uid: integratorId };

    try {
      let result: ClaimResponse;
      if (config?.hashcash) {
        setPhase('solving-hashcash');
        setHashcashAttempts(0);
        result = await client.solveAndClaim(address.trim(), {
          uid: integratorId,
          hostContext,
          captchaToken: captchaToken.current ?? undefined,
          onProgress: (n) => setHashcashAttempts(n),
        });
      } else {
        setPhase('submitting');
        result = await client.claim(address.trim(), {
          hostContext,
          captchaToken: captchaToken.current ?? undefined,
        });
      }
      // Either path auto-injected fingerprint.visitorId via the
      // CapacitorFaucetClient wrapper — the faucet logs include the
      // device id in `request.fingerprint`.
      setPhase('submitting');
      setTxId(result.txId ?? null);
      if (result.status === 'rejected') {
        setPhase('rejected');
        setErrorMessage(result.reason ?? 'Claim rejected');
        return;
      }
      if (result.status === 'challenged') {
        setPhase('rejected');
        setErrorMessage(result.reason ?? 'Captcha challenge required');
        return;
      }
      setPhase('broadcast');
      const final = await client.waitForConfirmation(result.id);
      setTxId((prev) => final.txId ?? prev);
      setPhase(final.status === 'confirmed' ? 'confirmed' : 'rejected');
      if (final.status === 'rejected' && final.reason) setErrorMessage(final.reason);
    } catch (err) {
      setPhase('error');
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  }

  function handleReset() {
    setPhase(config?.captcha ? 'awaiting-captcha' : 'idle');
    setTxId(null);
    setErrorMessage(null);
    setHashcashAttempts(0);
    captchaToken.current = null;
  }

  const label = phaseLabel(phase, hashcashAttempts);

  return (
    <main style={styles.container}>
      <h1 style={styles.heading}>Nimiq Faucet</h1>
      <p style={styles.subtitle}>Capacitor mobile app — claim free NIM (with abuse-layer demo)</p>

      <div style={styles.deviceCard}>
        <div style={styles.deviceLabel}>Device fingerprint (auto-injected)</div>
        <div style={styles.deviceLine}>
          <strong>{deviceInfo ? `${deviceInfo.platform} ${deviceInfo.model}` : 'detecting…'}</strong>
        </div>
        <div style={styles.deviceLine}><code>visitorId: {deviceId ?? 'unavailable'}</code></div>
      </div>

      <form onSubmit={handleSubmit} style={styles.form}>
        <label htmlFor="address" style={styles.label}>Nimiq Address</label>
        <input
          id="address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="NQ00 0000 0000 0000 0000 0000 0000 0000 0000"
          disabled={isPending}
          autoComplete="off"
          spellCheck={false}
          style={styles.input}
        />

        {captchaRequired && (
          <div style={styles.captchaBlock}>
            <div style={styles.captchaLabel}>{config!.captcha!.provider === 'turnstile' ? 'Cloudflare Turnstile' : 'hCaptcha'}</div>
            <div id="captcha-host" />
          </div>
        )}

        {config?.hashcash && (
          <p style={styles.hashcashNote}>
            Hashcash difficulty {config.hashcash.difficulty} bits — solved on this device.
          </p>
        )}

        <button type="submit" disabled={!canSubmit} style={styles.button}>
          {isPending ? 'Claiming…' : 'Claim NIM'}
        </button>
      </form>

      {label && (
        <div style={{
          ...styles.status,
          ...(phase === 'confirmed' ? styles.confirmed : {}),
          ...(phase === 'rejected' ? styles.rejected : {}),
          ...(phase === 'solving-hashcash' ? styles.hashcash : {}),
        }}>
          <p>{label}</p>
          {txId && <p style={styles.tx}>TX: <code>{txId}</code></p>}
        </div>
      )}

      {errorMessage && (
        <div style={styles.error}>
          <p>{errorMessage}</p>
          <button onClick={handleReset} style={{ ...styles.button, ...styles.retry }}>Try again</button>
        </div>
      )}
    </main>
  );
}

function injectScript(src: string, marker: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[${marker}]`);
    if (existing) { resolve(); return; }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    script.setAttribute(marker, 'true');
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
    document.head.appendChild(script);
  });
}

const styles: Record<string, React.CSSProperties> = {
  container: { maxWidth: 480, margin: '0 auto', padding: '2rem', fontFamily: 'system-ui, sans-serif' },
  heading: { fontSize: '1.75rem', marginBottom: '0.25rem', color: '#1f2348' },
  subtitle: { color: '#6b7280', marginBottom: '1.5rem' },
  deviceCard: { padding: '0.75rem', background: '#f0f1f9', borderRadius: 8, marginBottom: '1.5rem', fontSize: '0.8rem' },
  deviceLabel: { fontSize: '0.7rem', color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: '0.25rem' },
  deviceLine: { wordBreak: 'break-all' as const, lineHeight: 1.4 },
  form: { display: 'flex', flexDirection: 'column' as const, gap: '0.75rem' },
  label: { fontWeight: 600, fontSize: '0.875rem' },
  input: { padding: '0.75rem', border: '1px solid #d1d5db', borderRadius: 8, fontFamily: 'monospace', fontSize: '0.875rem' },
  button: { padding: '0.75rem', border: 'none', borderRadius: 8, background: '#1f2348', color: '#fff', fontSize: '1rem', fontWeight: 600, cursor: 'pointer' },
  captchaBlock: { padding: '0.75rem', background: '#f0f1f9', borderRadius: 8 },
  captchaLabel: { fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.5rem' },
  hashcashNote: { fontSize: '0.75rem', color: '#6b7280', fontStyle: 'italic' as const, marginTop: '-0.25rem' },
  status: { marginTop: '1.5rem', padding: '1rem', borderRadius: 8, background: '#e8eaf6' },
  confirmed: { background: '#d1fae5', color: '#065f46' },
  rejected: { background: '#fee2e2', color: '#991b1b' },
  hashcash: { background: '#fef3c7', color: '#78350f' },
  tx: { marginTop: '0.5rem', fontSize: '0.8rem', wordBreak: 'break-all' as const },
  error: { marginTop: '1.5rem', padding: '1rem', borderRadius: 8, background: '#fee2e2', color: '#991b1b' },
  retry: { marginTop: '0.75rem', background: '#991b1b', fontSize: '0.875rem', padding: '0.5rem 1rem' },
};
