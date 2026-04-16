# Fraud prevention

One-pager for stakeholders and integrators asking **"what prevents abuse?"**

Short answer: **defense in depth**. Nine independent abuse-detection layers compose into a single allow/challenge/review/deny decision per claim, plus operator controls, plus an honest admission that any faucet can be drained if the payout exceeds the attacker's cost.

---

## What we have today

Every claim runs through a pipeline. Any layer can flag, score, or deny.

| Layer | What it catches | Cost | Enabled by |
|-------|-----------------|------|------------|
| Per-IP rate limit | Same IP hammering (per minute) | ~0 | Always on |
| Per-IP daily cap | Over-claiming from a single IP in 24h | ~0 | Always on |
| Blocklist | Known-bad IP, address, UID, ASN, or country | ~0 | Admin-curated |
| Captcha (Turnstile / hCaptcha) | Trivial bots | 1 verify call | Env var + site key |
| Hashcash (client puzzle) | Raises attacker CPU cost per claim | ~1 s client CPU | `FAUCET_HASHCASH_SECRET` |
| GeoIP / ASN / VPN / Tor / datacenter | Regional policy + datacenter IPs | <5 ms (MaxMind), ~150 ms (IPinfo) | `FAUCET_GEOIP_BACKEND` |
| Fingerprint correlation | Multi-account / multi-browser farming | DB lookup | `FAUCET_FINGERPRINT_ENABLED` |
| On-chain heuristics | Sweeper wallets, sibling faucet cross-funding | 1 RPC call | `FAUCET_ONCHAIN_ENABLED` |
| AI scoring (rules + optional ONNX) | Composite signal fusion — velocity, entropy, timing | <10 ms | `FAUCET_AI_ENABLED` |

**Final decision** is one of: `allow`, `challenge` (client must complete extra work and retry), `review` (claim routed to admin for manual allow/deny), or `deny`.

Every decision is logged with the full signal bundle, viewable in the admin dashboard and via the MCP tool `faucet.explain_decision(claimId)`.

---

## Trust connectors — the extra layer worth adding

**The problem.** IP rotation is cheap. Even captcha farms cost <$0.01 per solve. Bot operators can fake everything *except* a real human identity.

**The lever.** The faucet already accepts `hostContext` from integrators: a hash of the user's stable identity plus claims about what the integrator already verified (email, phone, account age, etc.). If the integrator signs `hostContext` with their HMAC secret, the faucet can trust it and weight those claims heavily in the scoring.

**The proposal.** Extend `hostContext` with `verifiedIdentities` — a list of third-party identity providers the integrator has successfully authenticated the user against:

```ts
hostContext: {
  uid: "<hash of your app's stable user id>",
  kycLevel: "email" | "phone" | "id" | "none",
  verifiedIdentities: ["apple", "google", "github", "email", "phone"],
  accountAgeDays: 42,
  emailDomainHash: "<hash of the user's email domain>",
  tags: ["beta-tester", "premium"],
  signature: "<HMAC(integratorSecret, canonical(context))>",
}
```

**Why this moves the needle.** Apple, Google, and GitHub SSO accounts aren't free to farm:

- Apple: phone-verified Apple ID, Family Sharing friction, strong anti-abuse inside Apple.
- Google: phone + recovery email + behavioral signals.
- GitHub: older accounts with real commit history cost real time to cultivate.

A captcha-farm bot can buy 10,000 IPs for $5. Buying 10,000 aged Apple IDs is orders of magnitude more expensive. Shifting rate-limiting from **per-IP** (cheap to rotate) to **per-UID** (hard to rotate when backed by SSO) flips the math.

**Where it fits in the architecture.**

1. Add `verifiedIdentities: string[]` to `HostContextSchema` in [packages/core/src/hostContext.ts](../packages/core/src/hostContext.ts) and to `canonicalizeHostContext` so it's included in the integrator signature.
2. Add a scoring bonus in [packages/abuse-ai](../packages/abuse-ai/) (or a new `abuse-identity` plugin) that down-weights risk when a signed `hostContext` has ≥1 verified identity.
3. Admin dashboard signal drawer surfaces the list of verified identities.

This is a **roadmap item** — see [ROADMAP.md](../ROADMAP.md) §1.4 "Integrator-signed host context".

---

## The honest limits — abuse at scale

Faucets leak. Always have. The goal is to raise attacker ROI above what they're willing to pay, and to cap total damage when abuse ramps up.

**Reality check.**

- MTurk-style captcha farms solve for $0.001–0.003 per challenge.
- Hashcash at 20 bits adds ~$0.0001 of CPU cost.
- Low-end VPN IPs rent at $0.001/day/IP.
- Datacenter IPs are free from cloud trial accounts.

So the per-claim attacker cost floor is roughly **$0.005**. If the faucet pays out more value per claim than that, someone will drain it — no matter how many layers you stack. The math is that simple.

**What actually works at scale.**

1. **Lower the per-claim payout** — often dramatically. Reach > claim size > attacker floor cost.
2. **Cap daily outflow** — have the server pause claims (or decline) once the wallet's sent more than a target amount today. Configurable via admin config.
3. **Trust connectors** (above) — raises the attacker floor from $0.005 to dollars per identity, not per claim.
4. **Manual review queue** — the `review` decision routes suspicious claims to an admin drawer; many false positives are better than leaking.
5. **Monitor the balance + claim rate** — alert when the balance drops faster than expected. See [docs/health-observability.md](./health-observability.md).
6. **Blocklist pattern matching** — when an attack is in progress, block the ASN, country, or address prefix; don't play whack-a-mole per-IP.

Claim amount, daily cap, and rate limits are all editable from the admin dashboard without restarting the server. Tune them under attack, tune them back afterwards.

---

## Operator playbook — "we're being abused"

1. **See it early.** Admin dashboard → **Overview** → watch `claims/hour`, `success rate`, `top rejection reasons`, and `wallet balance`. Sudden rate spike or balance drop = signal.
2. **Identify the vector.** Open **Claims** → filter by status=rejected or decision=review. Click into a row. The signal bundle shows which abuse layer scored highest. Check if the abusers share an ASN, country, or address prefix.
3. **Pattern-block.** **Abuse** page → add a blocklist entry for the shared feature (ASN, country, address prefix). Set `expiresAt` a day or two out so you don't permanently block a regular country.
4. **Tighten knobs.** **Config** page → turn up `rateLimitPerIpPerDay` (fewer claims per IP), turn up hashcash difficulty, toggle on any abuse layer that was off.
5. **Pause if needed.** Set `claimAmountLuna=0` — the faucet still responds but sends nothing. No financial loss while you investigate.
6. **Post-mortem.** Open **Logs** → audit trail of every admin action. Review what stopped the bleeding, adjust defaults, document in the incident log.

---

## Integrator playbook — add a trust connector

You're building an app, you integrate the faucet, your users get NIM. You can raise your users' trust score by integrating a real-identity provider **before** sending the claim.

Example with Next.js + Sign in with Apple:

```ts
import { useFaucetClaim } from '@nimiq-faucet/react';
import { signInWithApple } from './your-auth';
import { signHostContext } from './your-backend-api'; // calls your backend

async function claimForUser(address: string) {
  // 1. Your own Apple sign-in (returns the Apple `sub` identifier).
  const apple = await signInWithApple();
  const uidHash = sha256(`my-app:${apple.sub}`);

  // 2. Build the hostContext on your backend + sign it.
  //    (See docs/integrator-hmac.md for the HMAC scheme.)
  const hostContext = await signHostContext({
    uid: uidHash,
    kycLevel: 'email',
    verifiedIdentities: ['apple'],
    accountAgeDays: user.ageDays,
  });

  // 3. Faucet claim — signed context gets a trust bonus.
  const { claim } = useFaucetClaim({
    url: process.env.NEXT_PUBLIC_FAUCET_URL,
    address,
    hostContext,
  });
  await claim();
}
```

Same pattern for Google One Tap, GitHub OAuth, or any other identity provider you already use. See [docs/integrator-hmac.md](./integrator-hmac.md) for the signature scheme details.

---

## FAQ

**"Can you guarantee no abuse?"**
No. Nobody can. We guarantee defense in depth, full observability of every claim decision, and operator controls to respond in real time.

**"Is this as good as what $BIG_CAPTCHA_VENDOR offers?"**
We compose the same inputs they use (behavioral, reputation, proof-of-work) *plus* on-chain heuristics they can't see *plus* integrator-signed identity they don't have access to. Different threat model; complementary, not a substitute.

**"What about Sybil attacks via compromised SSO accounts?"**
Still possible. The defense is per-UID rate limiting + account-age signal + the `review` queue. Every layer has an escape; we stack them so no single escape drains the faucet.

**"What's the recommended minimum setup for production?"**
Always-on layers + Turnstile + hashcash + GeoIP allowlist aligned with your legal footprint + a reasonable daily cap. Start there. See [docs/deployment-production.md](./deployment-production.md) §6 "Hardening checklist".

---

## See also

- [docs/integrator-hmac.md](./integrator-hmac.md) — how to sign `hostContext` from your backend
- [docs/deployment-production.md](./deployment-production.md) — production hardening
- [docs/health-observability.md](./health-observability.md) — alerting on abuse waves
- [docs/admin-first-run.md](./admin-first-run.md) — operator onboarding
- [ROADMAP.md](../ROADMAP.md) — scheduled work including verified-identity scoring
- [docs/security/threat-model.md](./security/threat-model.md) — STRIDE analysis
