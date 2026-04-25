import { getHostLanguage } from '@nimiq/mini-app-sdk';

export type Lang = 'en' | 'de';

const STRINGS = {
  en: {
    title: 'Nimiq Faucet',
    subtitle: 'Claim free testnet NIM',
    connecting: 'Connecting to Nimiq Pay…',
    outsidePay: 'Open this app inside Nimiq Pay',
    outsidePayHint: 'Paste this URL into Nimiq Pay → Mini Apps on a phone running on the same Wi-Fi as the faucet.',
    claim: 'Claim NIM',
    claiming: 'Claiming…',
    awaitingCaptcha: 'Solve the captcha to continue',
    addressFromWallet: 'Address from wallet',
    broadcast: 'Broadcast — waiting for confirmation…',
    confirmed: 'Confirmed',
    rejected: 'Rejected',
    challenged: 'Captcha required',
    txLabel: 'Transaction',
    explorerLink: 'Open in explorer',
    retry: 'Try again',
    error: 'Something went wrong',
  },
  de: {
    title: 'Nimiq Faucet',
    subtitle: 'Kostenlose Testnet-NIM beanspruchen',
    connecting: 'Verbinde mit Nimiq Pay…',
    outsidePay: 'Diese App in Nimiq Pay öffnen',
    outsidePayHint: 'URL in Nimiq Pay → Mini Apps einfügen, auf einem Telefon im selben WLAN wie der Faucet.',
    claim: 'NIM beanspruchen',
    claiming: 'Wird beansprucht…',
    awaitingCaptcha: 'Captcha lösen um fortzufahren',
    addressFromWallet: 'Adresse aus dem Wallet',
    broadcast: 'Gesendet — warte auf Bestätigung…',
    confirmed: 'Bestätigt',
    rejected: 'Abgelehnt',
    challenged: 'Captcha erforderlich',
    txLabel: 'Transaktion',
    explorerLink: 'Im Explorer öffnen',
    retry: 'Erneut versuchen',
    error: 'Etwas ist schiefgelaufen',
  },
} as const;

export type StringKey = keyof typeof STRINGS['en'];

function pickLang(): Lang {
  const raw = getHostLanguage();
  return raw && raw.toLowerCase().startsWith('de') ? 'de' : 'en';
}

export function translate(key: StringKey, lang?: Lang): string {
  const l = lang ?? pickLang();
  return STRINGS[l][key];
}
