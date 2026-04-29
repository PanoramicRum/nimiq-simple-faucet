import { translate } from '@nimiq-faucet/mini-app-claim-shared';
import { useMiniAppFaucet } from './hooks/useMiniAppFaucet';
import { FcaptchaWidgetView } from './components/FcaptchaWidget';

const FAUCET_URL = import.meta.env.VITE_FAUCET_URL ?? 'http://localhost:8080';
const EXPLORER_BASE = import.meta.env.VITE_EXPLORER_URL ?? 'https://nimiq-testnet.observer/#tx/';

export function App() {
  const { state, captchaPrompt, claim, reset, canClaim } = useMiniAppFaucet(FAUCET_URL);
  const t = translate;

  const buttonLabel =
    state.phase === 'awaiting-address' ||
    state.phase === 'awaiting-captcha' ||
    state.phase === 'submitting' ||
    state.phase === 'broadcast'
      ? t('claiming')
      : t('claim');

  const showButtonSpinner =
    state.phase !== 'ready' &&
    state.phase !== 'rejected' &&
    state.phase !== 'error' &&
    state.phase !== 'confirmed' &&
    state.phase !== 'connecting' &&
    state.phase !== 'outside-nimiq-pay';

  const explorerUrl = state.txId ? `${EXPLORER_BASE}${state.txId}` : null;

  return (
    <>
      <h1 className="title">{t('title')}</h1>
      <p className="subtitle">{t('subtitle')}</p>

      {state.phase === 'connecting' && (
        <div className="card">
          <span>
            <span className="spinner" />
            {t('connecting')}
          </span>
        </div>
      )}

      {state.phase === 'outside-nimiq-pay' && (
        <div className="card">
          <strong>{t('outsidePay')}</strong>
          <p className="subtitle">{t('outsidePayHint')}</p>
          {state.outsideReason && (
            <p className="subtitle">
              <small>{state.outsideReason}</small>
            </p>
          )}
        </div>
      )}

      {state.phase !== 'connecting' && state.phase !== 'outside-nimiq-pay' && (
        <>
          {state.address && (
            <div className="card">
              <span className="label">{t('addressFromWallet')}</span>
              <span className="address">{state.address}</span>
            </div>
          )}

          {captchaPrompt && (
            <FcaptchaWidgetView
              serverUrl={captchaPrompt.serverUrl}
              siteKey={captchaPrompt.siteKey}
              onSolved={captchaPrompt.resolve}
              onFailed={captchaPrompt.reject}
            />
          )}

          {state.phase === 'awaiting-captcha' && <p className="subtitle">{t('awaitingCaptcha')}</p>}

          <button className="btn" disabled={!canClaim} onClick={claim}>
            {showButtonSpinner && <span className="spinner" />}
            {buttonLabel}
          </button>

          {state.phase === 'broadcast' && (
            <div className="banner warn">
              <span className="spinner" />
              {t('broadcast')}
            </div>
          )}

          {state.phase === 'confirmed' && (
            <div className="banner good">
              <strong>{t('confirmed')}</strong>
              {state.txId && (
                <p className="tx">
                  {t('txLabel')}: {state.txId}
                </p>
              )}
              {explorerUrl && (
                <a href={explorerUrl} target="_blank" rel="noopener" className="link">
                  {t('explorerLink')} →
                </a>
              )}
            </div>
          )}

          {(state.phase === 'rejected' || state.phase === 'challenged') && (
            <div className="banner bad">
              <strong>{state.phase === 'challenged' ? t('challenged') : t('rejected')}</strong>
              {state.errorMessage && <p className="tx">{state.errorMessage}</p>}
              <button className="btn" onClick={reset}>
                {t('retry')}
              </button>
            </div>
          )}

          {state.phase === 'error' && (
            <div className="banner bad">
              <strong>{t('error')}</strong>
              {state.errorMessage && <p className="tx">{state.errorMessage}</p>}
              <button className="btn" onClick={reset}>
                {t('retry')}
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
