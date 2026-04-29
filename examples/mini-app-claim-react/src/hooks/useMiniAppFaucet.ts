import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FaucetClient } from '@nimiq-faucet/sdk';
import {
  connectMiniApp,
  getUserAddress,
  type MiniAppConnectionState,
} from '@nimiq-faucet/mini-app-claim-shared';

export type Phase =
  | 'connecting'
  | 'outside-nimiq-pay'
  | 'ready'
  | 'awaiting-address'
  | 'awaiting-captcha'
  | 'submitting'
  | 'broadcast'
  | 'confirmed'
  | 'rejected'
  | 'challenged'
  | 'error';

export interface CaptchaPrompt {
  serverUrl: string;
  siteKey: string;
  resolve: (token: string) => void;
  reject: (err: Error) => void;
}

export interface MiniAppFaucetState {
  phase: Phase;
  address: string | null;
  txId: string | null;
  errorMessage: string | null;
  outsideReason: string | null;
}

const INITIAL: MiniAppFaucetState = {
  phase: 'connecting',
  address: null,
  txId: null,
  errorMessage: null,
  outsideReason: null,
};

export function useMiniAppFaucet(faucetUrl: string) {
  const [state, setState] = useState<MiniAppFaucetState>(INITIAL);
  const [captchaPrompt, setCaptchaPrompt] = useState<CaptchaPrompt | null>(null);
  const conn = useRef<MiniAppConnectionState | null>(null);
  // In-flight guard: a fast double-tap can fire two parallel claim() calls
  // before React's render commit disables the button. Lock here in addition
  // to the UI-level disable.
  const inFlight = useRef(false);

  const client = useMemo(() => new FaucetClient({ url: faucetUrl }), [faucetUrl]);

  useEffect(() => {
    let cancelled = false;
    void connectMiniApp().then((next) => {
      if (cancelled) return;
      conn.current = next;
      setState((prev) => {
        if (next.status === 'ready') return { ...prev, phase: 'ready' };
        if (next.status === 'outside-nimiq-pay')
          return { ...prev, phase: 'outside-nimiq-pay', outsideReason: next.reason };
        return prev;
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchCaptchaToken = useCallback(async (): Promise<string | undefined> => {
    const config = await client.config();
    if (!config.captcha) return undefined;
    if (config.captcha.provider !== 'fcaptcha') {
      throw new Error(
        `This example only renders fcaptcha; faucet is configured for ${config.captcha.provider}.`,
      );
    }
    if (!config.captcha.serverUrl) {
      throw new Error('faucet returned fcaptcha provider without serverUrl');
    }
    setState((prev) => ({ ...prev, phase: 'awaiting-captcha' }));
    return new Promise<string>((resolve, reject) => {
      setCaptchaPrompt({
        serverUrl: config.captcha!.serverUrl!,
        siteKey: config.captcha!.siteKey,
        resolve: (token) => {
          setCaptchaPrompt(null);
          resolve(token);
        },
        reject: (err) => {
          setCaptchaPrompt(null);
          reject(err);
        },
      });
    });
  }, [client]);

  const claim = useCallback(async (): Promise<void> => {
    if (inFlight.current) return;
    if (!conn.current || conn.current.status !== 'ready') return;
    inFlight.current = true;
    setState((prev) => ({ ...prev, errorMessage: null, txId: null, phase: 'awaiting-address' }));
    try {
      const address = await getUserAddress(conn.current.provider);
      setState((prev) => ({ ...prev, address }));
      const captchaToken = await fetchCaptchaToken();
      setState((prev) => ({ ...prev, phase: 'submitting' }));
      const initialOpts: { captchaToken?: string } = captchaToken ? { captchaToken } : {};
      const initial = await client.claim(address, initialOpts);
      setState((prev) => ({ ...prev, txId: initial.txId ?? null }));
      if (initial.status === 'rejected') {
        setState((prev) => ({
          ...prev,
          phase: 'rejected',
          errorMessage: initial.reason ?? 'Claim rejected',
        }));
        return;
      }
      if (initial.status === 'challenged') {
        setState((prev) => ({
          ...prev,
          phase: 'challenged',
          errorMessage: initial.reason ?? 'Captcha required',
        }));
        return;
      }
      setState((prev) => ({ ...prev, phase: 'broadcast' }));
      const final = await client.waitForConfirmation(initial.id);
      setState((prev) => ({
        ...prev,
        txId: final.txId ?? prev.txId,
        phase: final.status === 'confirmed' ? 'confirmed' : 'rejected',
        errorMessage: final.status === 'rejected' && final.reason ? final.reason : prev.errorMessage,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState((prev) => ({ ...prev, phase: 'error', errorMessage: message }));
    } finally {
      inFlight.current = false;
    }
  }, [client, fetchCaptchaToken]);

  const reset = useCallback(() => {
    setState({
      ...INITIAL,
      phase: conn.current?.status === 'ready' ? 'ready' : 'connecting',
      outsideReason:
        conn.current?.status === 'outside-nimiq-pay' ? conn.current.reason : null,
    });
    setCaptchaPrompt(null);
  }, []);

  const canClaim =
    state.phase === 'ready' ||
    state.phase === 'rejected' ||
    state.phase === 'error' ||
    state.phase === 'confirmed';

  return { state, captchaPrompt, claim, reset, canClaim };
}
