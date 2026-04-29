import { useEffect, useRef } from 'react';
import { loadFcaptcha, type FcaptchaWidget } from '@nimiq-faucet/mini-app-claim-shared';

export interface FcaptchaWidgetProps {
  serverUrl: string;
  siteKey: string;
  onSolved: (token: string) => void;
  onFailed: (error: Error) => void;
}

export function FcaptchaWidgetView({ serverUrl, siteKey, onSolved, onFailed }: FcaptchaWidgetProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  // Stabilise the callbacks via refs so the widget effect below depends only
  // on (serverUrl, siteKey). Without this, every parent render produces fresh
  // closure identities for onSolved/onFailed (the parent passes inline arrows
  // bound to the captchaPrompt useState value), which would tear down and
  // re-mount the fcaptcha script on every render — broken under StrictMode
  // and noisy in production.
  const onSolvedRef = useRef(onSolved);
  const onFailedRef = useRef(onFailed);
  useEffect(() => { onSolvedRef.current = onSolved; }, [onSolved]);
  useEffect(() => { onFailedRef.current = onFailed; }, [onFailed]);

  useEffect(() => {
    let widget: FcaptchaWidget | null = null;
    let cancelled = false;
    if (!hostRef.current) return;
    void loadFcaptcha({ serverUrl, siteKey, hostElement: hostRef.current })
      .then((w) => {
        if (cancelled) {
          w.destroy();
          return;
        }
        widget = w;
        return w.token;
      })
      .then((token) => {
        if (cancelled || token === undefined) return;
        onSolvedRef.current(token);
      })
      .catch((err) => {
        if (cancelled) return;
        onFailedRef.current(err instanceof Error ? err : new Error(String(err)));
      });
    return () => {
      cancelled = true;
      widget?.destroy();
    };
  }, [serverUrl, siteKey]);

  return <div ref={hostRef} className="captcha-host" />;
}
