export type MessageKey =
  | 'title'
  | 'subtitleNetwork'
  | 'addressLabel'
  | 'addressPlaceholder'
  | 'addressInvalid'
  | 'claim'
  | 'claiming'
  | 'status.pending'
  | 'status.broadcast'
  | 'status.confirmed'
  | 'status.rejected'
  | 'status.challenged'
  | 'reason.rateLimited'
  | 'reason.invalidAddress'
  | 'reason.geoBlocked'
  | 'reason.vpnBlocked'
  | 'reason.captchaFailed'
  | 'reason.serverError'
  | 'reason.unknown'
  | 'status.serverError'
  | 'explorerLink'
  | 'tryAgain'
  | 'copyTx'
  | 'copied'
  | 'challenge.solving'
  | 'challenge.attempts'
  | 'challenge.ready'
  | 'captcha.prompt'
  | 'footer.poweredBy'
  | 'footer.repo';

export const messages: Record<MessageKey, string> = {
  title: 'Nimiq Faucet',
  subtitleNetwork: 'Network: {{network}}',
  addressLabel: 'Nimiq address',
  addressPlaceholder: 'NQ12 ...',
  addressInvalid: 'Enter a valid Nimiq address (e.g. NQ07 0000 0000 0000 0000 0000 0000 0000 0000).',
  claim: 'Claim',
  claiming: 'Claiming ...',
  'status.pending': 'Submitting claim ...',
  'status.broadcast': 'Transaction broadcast. Waiting for confirmation ...',
  'status.confirmed': 'Confirmed on-chain.',
  'status.rejected': 'Claim rejected.',
  'status.challenged': 'Additional verification required. Please try again.',
  'reason.rateLimited': 'This IP has already claimed recently. Please try again later.',
  'reason.invalidAddress': 'The address you entered is not a valid Nimiq address.',
  'reason.geoBlocked': 'The faucet is not available in your region.',
  'reason.vpnBlocked': 'Please disable VPN or proxy services and try again.',
  'reason.captchaFailed': 'Captcha verification failed. Please try again.',
  'reason.serverError': 'The faucet is temporarily unavailable. Please try again in a moment.',
  'reason.unknown': 'Something went wrong. Please try again in a moment.',
  'status.serverError': 'Faucet not accessible',
  explorerLink: 'View on block explorer',
  tryAgain: 'Try again',
  copyTx: 'Copy transaction id',
  copied: 'Copied',
  'challenge.solving': 'Running a quick anti-spam check ...',
  'challenge.attempts': '{{n}} computations',
  'challenge.ready': 'Verification complete.',
  'captcha.prompt': 'Complete the captcha to continue.',
  'footer.poweredBy': 'Powered by @nimiq-faucet',
  'footer.repo': 'Source',
};

function render(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => {
    const v = vars[k];
    return v === undefined ? `{{${k}}}` : String(v);
  });
}

// Minimal fallback: unknown keys return the key itself so missing strings
// are obvious in the UI rather than silently blank.
export function t(key: MessageKey | string, vars?: Record<string, string | number>): string {
  const template = (messages as Record<string, string>)[key];
  if (typeof template !== 'string') return key;
  return render(template, vars);
}
