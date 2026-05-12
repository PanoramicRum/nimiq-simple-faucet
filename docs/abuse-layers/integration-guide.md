# Handling abuse layers in your integration

The per-layer docs in this directory are written for the **operator** —
how to enable and configure each layer. This page is for the **integrator** —
how to make your app cooperate with whatever layers the operator turned on,
so a claim succeeds instead of coming back `challenged` or `rejected`.

The model is simple:

1. The faucet advertises which layers are active via `GET /v1/config`.
2. Your app reads that, renders / solves whatever is needed (captcha widget,
   proof-of-work), and submits the claim.
3. The **server** enforces every layer; the **client** only has to cooperate
   with the two interactive ones (captcha, hashcash) and optionally forward a
   signed `hostContext`. Everything else (blocklist, rate limit, geo-IP,
   fingerprint, on-chain heuristics, AI scoring) is server-side and needs no
   client work.

> The minimal examples ([`examples/minimal-react/`](../../examples/minimal-react),
> [`examples/minimal-vue/`](../../examples/minimal-vue)) deliberately skip all
> of this — they're the "no abuse layers" starting point. For full,
> framework-specific implementations see
> [`examples/nextjs-claim-page/`](../../examples/nextjs-claim-page) (React) and
> [`examples/vue-claim-page/`](../../examples/vue-claim-page) (Vue), and the
> reference widget wrappers in `apps/claim-ui/src/components/`.

## 1. Read `/v1/config`

```ts
import { FaucetClient } from '@nimiq-faucet/sdk';

const client = new FaucetClient({ url: FAUCET_URL });
const config = await client.config();
//  {
//    network: 'main' | 'test',
//    claimAmountLuna: string,
//    abuseLayers: Record<string, boolean>,       // which layers are on
//    captcha: { provider, siteKey, serverUrl? } | null,
//    hashcash: { difficulty, ttlMs } | null,
//  }
```

- `config.captcha === null` → no captcha; skip §2.
- `config.hashcash === null` → no proof-of-work; a plain `client.claim()` is
  fine. Otherwise use `client.solveAndClaim()` (§3).
- `config.abuseLayers` is informational (the dashboard / `faucet.explain_decision`
  surface uses it) — you don't need to act on it client-side.

The Go and Python SDKs expose the same: `client.Config(ctx)` / `client.config()`.

## 2. Render the captcha the operator chose

When `config.captcha` is non-null, render the upstream widget for
`config.captcha.provider` (`'turnstile' | 'hcaptcha' | 'fcaptcha'`) using
`config.captcha.siteKey` (FCaptcha also needs `config.captcha.serverUrl`),
collect the token the widget emits, and pass it to the claim:

```ts
// after the widget calls back with a token:
await client.claim(address, { captchaToken: token /* , hostContext, ... */ });
```

Loading the widget script is provider-specific — load it conditionally, only
when `config.captcha.provider` matches:

| Provider | Script | Token how |
|---|---|---|
| `turnstile` | `https://challenges.cloudflare.com/turnstile/v0/api.js` | `turnstile.render(el, { sitekey, callback })` |
| `hcaptcha` | `https://js.hcaptcha.com/1/api.js` | `hcaptcha.render(el, { sitekey, callback })` |
| `fcaptcha` | `${config.captcha.serverUrl}/fcaptcha.js` | widget element + `onSolved` handler |

Don't hard-code one provider — the operator can switch, and only one is ever
active. The reference wrappers (`apps/claim-ui/src/components/TurnstileWidget.vue`,
`HCaptchaWidget.vue`, `FCaptchaWidget.vue`) handle the script-tag lifecycle and
token hand-off; copy whichever you need. See also the per-layer docs:
[Turnstile](turnstile.md), [hCaptcha](hcaptcha.md), [FCaptcha](fcaptcha.md).

If a captcha is required and you submit without a token, the claim comes back
`{ status: 'challenged' }` — treat that as "show the captcha and let the user
solve it", not as a hard failure.

## 3. Solve the hashcash puzzle (proof-of-work)

When `config.hashcash` is non-null, the faucet requires a SHA-256 client puzzle
with the claim. Don't implement it by hand — `solveAndClaim()` does the whole
round trip (`POST /v1/challenge` → brute-force the nonce → `POST /v1/claim`
with `hashcashSolution`):

```ts
const result = await client.solveAndClaim(address, {
  // optional: a stable per-user id binds the challenge to the user
  uid: hashedUserId,
  // optional: progress for a UI (called every ~2k hashes)
  onProgress: (attempts) => setHashcashAttempts(attempts),
  // plus any captchaToken / hostContext you'd pass to claim()
});
```

Go / Python: `client.SolveAndClaim(ctx, address, opts)` /
`client.solve_and_claim(address, opts)`. All SDKs also expose the lower-level
`requestChallenge()` + a `solveHashcash()` helper if you want to drive the two
steps yourself (e.g. to show a checkbox-style widget). Difficulty is
`config.hashcash.difficulty` (a leading-zero-bits target); the default of 20 is
~1M hashes (~0.5 s on a laptop). This puzzle is unrelated to Nimiq's
proof-of-stake consensus — it's a self-hosted anti-bot client puzzle. See
[hashcash.md](hashcash.md).

## 4. (Optional) Forward a signed `hostContext`

If your app has a backend that knows things about the user — a hashed user id,
account age, KYC level, which SSO providers they're verified against — you can
pass that as `hostContext` so it feeds the faucet's scoring pipeline. **But
unsigned trust-claim fields are stripped server-side** (only the correlation
hashes — `uid`, `cookieHash`, `sessionHash` — survive an unsigned context).
For `accountAgeDays`, `kycLevel`, `tags`, `verifiedIdentities` to count, sign
the context on your backend with your integrator HMAC secret:

```ts
// --- on your BACKEND (never ship the HMAC secret to the browser) ---
import { FaucetClient } from '@nimiq-faucet/sdk';
const signed = FaucetClient.signHostContext(
  { uid: hashedUserId, accountAgeDays: 412, kycLevel: 'id', verifiedIdentities: ['google', 'apple'] },
  INTEGRATOR_ID,            // your integrator id
  INTEGRATOR_HMAC_SECRET,   // your integrator HMAC secret
);
// → { ...ctx, signature: 'INTEGRATOR_ID:base64hmac' } — send this to the browser

// --- in the browser ---
await client.claim(address, { hostContext: signed /* , captchaToken */ });
```

Go: `client.SignHostContext(ctx, integratorId, hmacSecret)`. Python:
`FaucetClient.sign_host_context(ctx, integrator_id, hmac_secret)`. (React / Vue /
React-Native / Capacitor are browser-side and don't expose the static signer —
sign on your backend, forward the result.) See
[integrator-hmac.md](../integrator-hmac.md) and [fraud-prevention.md](../fraud-prevention.md);
backend examples in [`examples/go-backend-integration/`](../../examples/go-backend-integration)
and [`examples/python-backend-integration/`](../../examples/python-backend-integration).

`hostContext.signature` also lets the operator pivot rate limiting from per-IP
(cheap to rotate) to per-UID (hard to rotate) for your traffic.

## 5. Rejections are opaque — don't parse them

A rejected claim returns `{ id, status: 'rejected' }` and nothing else — no
attribution to which layer tripped. The SDKs surface a generic error (e.g.
`FaucetError` / `FaucetException` with the HTTP status). Don't try to infer the
layer from the response; the silence is deliberate (`SECURITY.md` → "Public-API
silence on rejection"). If you need to debug a rejection, the **operator** can
inspect the per-claim signal breakdown via the admin dashboard or the
`faucet.explain_decision` MCP tool.

Terminal claim statuses you may see: `confirmed`, `rejected`, `expired`
(abandoned after retries), `timeout` (broadcast but the server's confirmation
wait elapsed — a reconciliation job converges it later), plus `challenged`
(needs a captcha/hashcash you didn't supply). `solveAndClaim` / `claim` return
`broadcast` first; `waitForConfirmation(id)` polls to a terminal state.

## Putting it together

```ts
const client = new FaucetClient({ url: FAUCET_URL });
const config = await client.config();

// (render config.captcha widget if non-null; collect `captchaToken` from it)

const opts = { captchaToken /* if any */, hostContext /* signed, if you have a backend */ };
const result = config.hashcash
  ? await client.solveAndClaim(address, { ...opts, onProgress })
  : await client.claim(address, opts);

if (result.status === 'challenged') {
  // show / re-show the captcha; let the user solve it, then retry
} else {
  const final = await client.waitForConfirmation(result.id);
  // final.status: 'confirmed' (with final.txId) | 'rejected' | 'expired'
}
```

That's the whole contract. The minimal examples show the no-layers case; this
page is what you add when the operator turns layers on.
