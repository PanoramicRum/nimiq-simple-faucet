'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { FaucetClient, type ClaimResponse } from '@nimiq-faucet/react';
import type { FaucetConfig } from '@nimiq-faucet/sdk';

/**
 * §3.0.7 abuse-layer demo — Next.js (App Router).
 *
 * Demonstrates the four abuse-layer surfaces the faucet supports:
 *   1. Captcha widget (Turnstile or hCaptcha) — driven by `/v1/config`.
 *   2. Hashcash proof-of-work — `client.solveAndClaim()` does the round trip.
 *   3. `hostContext` — passed on every claim. Production frontends should
 *      send a *signed* hostContext minted by their backend (see README §
 *      "Abuse layers" — `FaucetClient.signHostContext` is the helper).
 *   4. Fingerprint — out of scope here; see the Capacitor/RN examples.
 *
 * `useFaucetClaim` from `@nimiq-faucet/react` is the simpler shape for
 * uid-only flows; we bypass it here so we can interleave the captcha +
 * hashcash steps before calling `client.claim`. The hook's source
 * (packages/sdk-react/src/index.ts) is a 30-line wrapper over `client.claim`,
 * so this manual path stays close in spirit and easy to compare.
 */

const faucetUrl = process.env.NEXT_PUBLIC_FAUCET_URL || 'http://localhost:8080';
const integratorId = process.env.NEXT_PUBLIC_INTEGRATOR_ID || 'nextjs-example';

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

export default function Home() {
  const client = useMemo(() => new FaucetClient({ url: faucetUrl }), []);

  const [phase, setPhase] = useState<Phase>('loading-config');
  const [address, setAddress] = useState('');
  const [config, setConfig] = useState<FaucetConfig | null>(null);
  const [hashcashAttempts, setHashcashAttempts] = useState(0);
  const [txId, setTxId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const captchaToken = useRef<string | null>(null);
  const captchaRendered = useRef(false);

  const isPending = ['loading-config', 'solving-hashcash', 'submitting', 'broadcast'].includes(phase);
  const captchaRequired = Boolean(config?.captcha);
  const captchaSatisfied = !captchaRequired || captchaToken.current !== null;
  const canSubmit = !isPending && address.trim().length > 0 && captchaSatisfied;

  // Load `/v1/config` + captcha widget once on mount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const cfg = await client.config();
        if (cancelled) return;
        setConfig(cfg);
        setPhase(cfg.captcha ? 'awaiting-captcha' : 'idle');
        if (cfg.captcha && !captchaRendered.current) {
          await loadCaptchaWidget(cfg, () => {
            // No-op on success: token is captured via window callback below.
          });
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

  async function loadCaptchaWidget(cfg: FaucetConfig, onLoaded: () => void) {
    if (!cfg.captcha) return;
    const provider = cfg.captcha.provider;
    if (provider === 'fcaptcha') {
      // FCaptcha is the WebView/mini-app path; the standalone web example
      // doesn't render its widget — see examples/mini-app-claim-* for that.
      setErrorMessage('This example renders Turnstile/hCaptcha; the faucet returned fcaptcha. See examples/mini-app-claim-* instead.');
      return;
    }
    const src = provider === 'turnstile'
      ? 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      : 'https://js.hcaptcha.com/1/api.js?render=explicit';
    await injectScript(src, `data-${provider}`);
    onLoaded();
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

    // hostContext: production frontends should send a SIGNED context minted
    // by their backend (FaucetClient.signHostContext + integrator HMAC secret).
    // The example sends a plain uid to keep the demo runnable without a backend.
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
    <main className="container">
      <h1>Nimiq Faucet</h1>
      <p className="subtitle">Claim free NIM on testnet (with abuse-layer demo)</p>

      <form className="claim-form" onSubmit={handleSubmit}>
        <label htmlFor="address">Nimiq Address</label>
        <input
          id="address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="NQ00 0000 0000 0000 0000 0000 0000 0000 0000"
          disabled={isPending}
          autoComplete="off"
          spellCheck={false}
        />

        {config?.captcha && config.captcha.provider !== 'fcaptcha' && (
          <div className="captcha-block">
            <p className="captcha-label">{config.captcha.provider === 'turnstile' ? 'Cloudflare Turnstile' : 'hCaptcha'}</p>
            <div id="captcha-host" />
          </div>
        )}

        {config?.hashcash && (
          <p className="hashcash-note">
            Hashcash difficulty {config.hashcash.difficulty} bits — solved in your browser.
          </p>
        )}

        <button type="submit" disabled={!canSubmit}>
          {isPending ? 'Claiming…' : 'Claim NIM'}
        </button>
      </form>

      {label && (
        <div className={`status ${phase}`}>
          <p>{label}</p>
          {txId && <p className="tx">TX: <code>{txId}</code></p>}
        </div>
      )}

      {errorMessage && (
        <div className="error">
          <p>{errorMessage}</p>
          <button className="retry" onClick={handleReset}>Try again</button>
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
