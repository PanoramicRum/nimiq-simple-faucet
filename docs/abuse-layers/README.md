---
layers:
  - number: 1
    icon: "🚫"
    name: Blocklist
    details: "Admin-maintained IP, address, UID, ASN, or country deny-list with optional expiry."
    enabledBy: "Always on (managed via admin dashboard)"
    link: /abuse-layers/blocklist
  - number: 2
    icon: "⏱️"
    name: Rate Limiting
    details: "Per-IP daily claim cap preventing the same IP from claiming too many times."
    enabledBy: "Always on (FAUCET_RATE_LIMIT_PER_IP_PER_DAY)"
    link: /abuse-layers/rate-limiting
  - number: 3
    icon: "☁️"
    name: Cloudflare Turnstile
    details: "Invisible human-presence challenge via Cloudflare's Turnstile API."
    enabledBy: "FAUCET_TURNSTILE_SITE_KEY"
    link: /abuse-layers/turnstile
  - number: 4
    icon: "🤖"
    name: hCaptcha
    details: "Human verification challenge via the hCaptcha service."
    enabledBy: "FAUCET_HCAPTCHA_SITE_KEY"
    link: /abuse-layers/hcaptcha
  - number: 5
    icon: "⛏️"
    name: Hashcash
    details: "Self-hosted SHA-256 client puzzle — no third-party dependency."
    enabledBy: "FAUCET_HASHCASH_SECRET"
    link: /abuse-layers/hashcash
  - number: 6
    icon: "🌍"
    name: GeoIP / ASN
    details: "Country, ASN, VPN, Tor, and datacenter detection with pluggable providers."
    enabledBy: "FAUCET_GEOIP_BACKEND"
    link: /abuse-layers/geoip
  - number: 7
    icon: "🔍"
    name: Device Fingerprint
    details: "Browser fingerprint correlation to detect multi-account farming."
    enabledBy: "FAUCET_FINGERPRINT_ENABLED"
    link: /abuse-layers/fingerprint
  - number: 8
    icon: "⛓️"
    name: On-Chain Heuristics
    details: "Sweeper detection, fresh-address scoring, sibling-faucet analysis."
    enabledBy: "FAUCET_ONCHAIN_ENABLED"
    link: /abuse-layers/on-chain
  - number: 9
    icon: "🧠"
    name: AI Anomaly Scoring
    details: "Deterministic rules engine with optional ONNX classifier hook."
    enabledBy: "FAUCET_AI_ENABLED"
    link: /abuse-layers/ai-scoring
---

# Abuse Prevention Layers

The Nimiq Simple Faucet uses 9 pluggable abuse-prevention layers arranged in a defense-in-depth pipeline. Rate limiting is on by default; all other layers are opt-in via environment variables.

## How the pipeline works

Every claim request passes through all enabled layers. Each layer returns:

- A **score** between 0 (clean) and 1 (certain abuse)
- **Signals** — structured evidence (country, ASN, fingerprint match, etc.)
- An optional hard **decision**: `allow`, `challenge`, `review`, or `deny`

Hard decisions short-circuit the pipeline. If no layer issues a hard decision, the weighted scores are aggregated and compared against configurable thresholds.

| Decision | HTTP status | What happens |
|----------|------------|--------------|
| `allow` | 200 | Transaction is broadcast |
| `challenge` | 202 | Client must solve an additional challenge and retry |
| `review` | 202 | Held for manual admin review |
| `deny` | 403 | Rejected with reason |

## Layer summary

| # | Layer | What it catches | Cost | Enabled by |
|---|-------|----------------|------|-----------|
| 1 | [Blocklist](./blocklist.md) | Known bad actors | Free | Always on |
| 2 | [Rate Limiting](./rate-limiting.md) | Volume abuse | Free | Always on |
| 3 | [Cloudflare Turnstile](./turnstile.md) | Bots | Free tier available | `FAUCET_TURNSTILE_SITE_KEY` |
| 4 | [hCaptcha](./hcaptcha.md) | Bots | Free tier available | `FAUCET_HCAPTCHA_SITE_KEY` |
| 5 | [Hashcash](./hashcash.md) | Scripted flooding | Free (self-hosted) | `FAUCET_HASHCASH_SECRET` |
| 6 | [GeoIP / ASN](./geoip.md) | Geo-evasion, VPN, datacenter | Free (DB-IP) or paid | `FAUCET_GEOIP_BACKEND` |
| 7 | [Device Fingerprint](./fingerprint.md) | Multi-account farming | Free (client-side) | `FAUCET_FINGERPRINT_ENABLED` |
| 8 | [On-Chain Heuristics](./on-chain.md) | Sweeper wallets, faucet clusters | Free (RPC queries) | `FAUCET_ONCHAIN_ENABLED` |
| 9 | [AI Anomaly Scoring](./ai-scoring.md) | Novel attack patterns | Free (local CPU) | `FAUCET_AI_ENABLED` |

## Recommended production setup

At minimum, enable:

1. **Rate limiting** (always on) — caps claims per IP per day
2. **Turnstile or hCaptcha** — blocks automated scripts
3. **Hashcash** — adds CPU cost to every claim
4. **GeoIP** with country allowlist — restricts to your target regions

For higher-value faucets, add fingerprint correlation, on-chain heuristics, and AI scoring.

## Adding your own abuse layer

The abuse pipeline is designed for extensibility. Any module that implements the `AbuseCheck` interface can be plugged in.

### Step 1: Create the package

```bash
mkdir packages/abuse-mycheck
cd packages/abuse-mycheck
pnpm init
```

### Step 2: Implement the AbuseCheck interface

```typescript
import type { AbuseCheck, CheckResult, ClaimRequest } from '@faucet/core';

export interface MyCheckConfig {
  threshold: number;
}

export function myCheck(config: MyCheckConfig): AbuseCheck {
  return {
    id: 'my-check',
    description: 'My custom abuse check',
    weight: 1,
    async check(req: ClaimRequest): Promise<CheckResult> {
      // Your logic here — inspect req.ip, req.address,
      // req.hostContext, req.fingerprint, etc.
      const suspicious = /* ... */ false;
      return {
        score: suspicious ? 0.8 : 0,
        signals: { reason: 'example' },
        decision: suspicious ? 'deny' : undefined,
        reason: suspicious ? 'failed my check' : undefined,
      };
    },
  };
}
```

### Step 3: Register in the pipeline

In `apps/server/src/abuse/pipeline.ts`, import your check and add it conditionally:

```typescript
import { myCheck } from '@faucet/abuse-mycheck';

// Inside buildPipeline():
if (config.myCheckEnabled) {
  checks.push(myCheck({ threshold: config.myCheckThreshold }));
}
```

### Step 4: Add config + env vars

In `apps/server/src/config.ts`, add your config fields and env var mappings:

```typescript
// In ServerConfigSchema:
myCheckEnabled: z.coerce.boolean().default(false),
myCheckThreshold: z.coerce.number().default(0.5),

// In ENV_KEYS:
myCheckEnabled: 'FAUCET_MY_CHECK_ENABLED',
myCheckThreshold: 'FAUCET_MY_CHECK_THRESHOLD',
```

### Step 5: Test

Add tests in your package and in `apps/server/test/` following the pattern of existing abuse layer tests (e.g., `geoip.e2e.test.ts`, `hashcash.e2e.test.ts`).

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the full development workflow.
