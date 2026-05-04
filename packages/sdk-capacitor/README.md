# @nimiq-faucet/capacitor

Capacitor wrapper around `@nimiq-faucet/sdk`. Auto-populates `fingerprint.visitorId` from `@capacitor/device`'s `Device.getId()`.

## Install

```
pnpm add @nimiq-faucet/capacitor @capacitor/core @capacitor/device
```

## Usage

```ts
import { createCapacitorFaucetClient } from '@nimiq-faucet/capacitor';

const client = createCapacitorFaucetClient({ url: 'https://faucet.example.com' });
await client.claim(address); // fingerprint.visitorId auto-filled from Device.getId()
```

Caller-provided `fingerprint.visitorId` always wins. Everything else in `@nimiq-faucet/sdk` is re-exported (`FaucetClient`, `solveHashcash`, types).

## Security: `visitorId` is unsigned client input

The auto-populated `visitorId` is **untrusted** by design — an attacker who controls the Capacitor app (modified APK/IPA, JS tampering, runtime hook) can spoof this value to bypass per-device abuse correlation. The faucet's fingerprint abuse-layer treats `visitorId` as a **correlation hint, not authentication**.

For real trust, lean on:

1. **Per-IP rate limit** (`FAUCET_RATE_LIMIT_PER_IP_PER_DAY`) — the primary cap; can't be spoofed without distinct network paths.
2. **Signed `hostContext`** — if you run an integrator backend, sign the `hostContext` envelope server-side using `FaucetClient.signHostContext()` (from `@nimiq-faucet/sdk`) and pass the signed value into this SDK's `claim()` via the `hostContext` option:

   ```ts
   // On your backend (where the HMAC secret lives):
   const signedHostContext = FaucetClient.signHostContext(hostContext, {
     integratorId: 'your-integrator-id',
     hmacSecret: process.env.FAUCET_HMAC_SECRET,
   });
   // Pass the signed envelope down to the Capacitor app, then:
   await client.claim(address, { hostContext: signedHostContext });
   ```

   The faucet verifies the HMAC server-side and treats the contained fields (KYC level, account age, verified identities) as trusted. Without the signature, the same fields are stripped before the abuse pipeline sees them.

This mirrors the parity hardening that closed audit finding #104 for `sdk-go` and `sdk-flutter`. Don't reintroduce unsigned `visitorId` weighting in your operator config.
