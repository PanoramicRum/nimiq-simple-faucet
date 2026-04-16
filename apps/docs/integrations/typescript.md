# TypeScript

The `@nimiq-faucet/sdk` package works in any Node.js 18+ or modern-browser
runtime. It is the shared surface every other SDK wraps.

## Install

```bash
pnpm add @nimiq-faucet/sdk
```

## Add a claim button

```ts
import { FaucetClient } from '@nimiq-faucet/sdk';

const client = new FaucetClient({
  url: 'https://faucet.example.com',
});

async function onClaimClick(address: string): Promise<void> {
  const button = document.querySelector<HTMLButtonElement>('#claim')!;
  button.disabled = true;
  button.textContent = 'Claiming...';
  try {
    const { id } = await client.claim(address, {
      hostContext: {
        uid: localStorage.getItem('uidHash') ?? undefined,
        kycLevel: 'email',
      },
    });
    const result = await client.waitForConfirmation(id);
    button.textContent = result.status === 'confirmed' ? 'Sent!' : result.status;
  } catch (err) {
    button.textContent = (err as Error).message;
  } finally {
    button.disabled = false;
  }
}

document.querySelector('#claim')!.addEventListener('click', () => {
  onClaimClick((document.querySelector('#address') as HTMLInputElement).value);
});
```

## Options

| Option | Type | Notes |
| --- | --- | --- |
| `url` | `string` | Faucet base URL. Required. |
| `apiKey` | `string` | Integrator API key for signed `hostContext`. |
| `fetch` | `typeof fetch` | Custom fetch (useful for Node < 18 or mocking). |

## Error handling

All failures throw `FaucetError` with `.code` and `.status`. Common codes:

- `rate_limited` — retry after the `Retry-After` header.
- `captcha_required` — call `client.getConfig()` for the active provider.
- `denied` — see `error.reason`; surface it to the user or log for review.

## Live snippet URL

| Version | URL | Notes |
| --- | --- | --- |
| `latest` | `/snippets/typescript` | TODO: generated at release (M9). |
