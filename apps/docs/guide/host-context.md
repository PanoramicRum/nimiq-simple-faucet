# Host context

Every SDK accepts a `hostContext` object that feeds the abuse-scoring pipeline.
Forwarding whatever signals the integrator's app already has reduces false
positives for legitimate users and raises the cost for abusers.

## Shape

All fields are optional. Anything you send improves scoring; nothing is
required.

```ts
interface HostContext {
  uid?: string;              // hashed stable user id
  cookieHash?: string;       // hash of a long-lived host cookie
  sessionHash?: string;      // hash of the current session id
  accountAgeDays?: number;   // how long the user has existed on your app
  emailDomainHash?: string;  // hash of the email domain (not the address)
  kycLevel?: 'none' | 'email' | 'phone' | 'id';
  tags?: string[];           // free-form signals, e.g. ['employee', 'beta']
  signature?: string;        // HMAC of the canonicalized context
}
```

## Signing

Unsigned contexts are accepted but weighted lower. Sign on a trusted server
with your integrator HMAC secret, then pass the signature through to the
client.

```ts
import { createHmac } from 'node:crypto';

function canonicalize(ctx: Omit<HostContext, 'signature'>): string {
  // Stable key order; skip undefined.
  const keys = Object.keys(ctx).sort() as (keyof typeof ctx)[];
  return keys.map((k) => `${k}=${ctx[k] ?? ''}`).join('&');
}

const signature = createHmac('sha256', process.env.FAUCET_INTEGRATOR_SECRET!)
  .update(canonicalize(ctx))
  .digest('hex');
```

The server recomputes and compares with `timingSafeEqual`. Replay protection
comes from including `sessionHash` or a short-lived nonce in your canonical
form.

## Why it improves accuracy

- `accountAgeDays > 30` + `kycLevel: 'phone'` typically downgrades a borderline
  GeoIP score from `review` to `allow`.
- `tags: ['employee']` can be wired to a dedicated integrator bypass list.
- `uid` lets the faucet cluster claims across IP churn without storing the raw
  user identifier.

See [Abuse prevention](./abuse-prevention.md) for the exact weighting.
