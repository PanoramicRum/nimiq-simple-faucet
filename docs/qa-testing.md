# QA testing walkthrough

Hands-on, phased walkthrough of the entire Nimiq Simple Faucet so you can
exercise every feature, catch regressions, and collect UX feedback.
Written so a human tester **or** an AI coding agent can run it.

Each phase has:

- A time estimate
- Prerequisites from earlier phases
- Concrete commands to run
- Expected outcome + "looks wrong" flags
- An **"Ask your AI"** prompt you can paste into Claude Code / Cursor / Cody

When you hit something rough (confusing UI, error message you don't
understand, docs gap), file a GitHub issue with label `ux-polish` or
`qa-finding` — we'll sweep them in a polish release.

---

## Prerequisites

- Node 22+, pnpm 9+, Docker (with buildx), openssl
- Optional: Dart 3+ (for the Flutter example), Go 1.22+ (for the Go example), k6 (load tests)
- A public Nimiq testnet faucet URL to fund your generated wallet (e.g. https://faucet.pos.nimiq-testnet.com)
- ~2 hours end-to-end if you run every phase

---

## Phase 0 — Orientation (2 min)

**Goal:** know what you're looking at before you start clicking.

1. Open [docs/README.md](./README.md) — it's the audience-grouped index.
2. Skim [../AGENTS.md](../AGENTS.md) — structural overview of apps, packages, SDKs.
3. Glance at [../ROADMAP.md](../ROADMAP.md) so you know what's in-scope for 1.x vs. later.

### Ask your AI
> "Give me a 30-second tour of this repo. Tell me: what does the faucet do, what's in `apps/` vs `packages/` vs `examples/`, and what should I try first?"

---

## Phase 1 — Install + build + unit tests (5 min)

**Goal:** confirm the tree compiles and all 53 unit/integration tests pass on your machine.

```bash
pnpm install
pnpm build       # 22 turbo tasks — all green
pnpm typecheck   # strict TS across the workspace
pnpm test        # 53 vitest tests, excludes @nimiq-faucet/e2e by design
```

**Expected:** every step exits 0. `pnpm test` reports `Tests: 53 passed`.

**If it fails:** check Node/pnpm versions (`node -v && pnpm -v`), then look at the failing package and open its test output.

### Ask your AI
> "Run `pnpm install && pnpm build && pnpm test` in the repo root and report any failure. Pay extra attention to the server test suite."

---

## Phase 2 — Generate + fund a testnet wallet (10 min)

**Goal:** a testnet address the faucet can send FROM. Without this the faucet has no balance to dispense.

```bash
pnpm generate:wallet
```

This writes `.wallet.local.json` in the repo root (0600 perms, gitignored) and prints the address + funding instructions. Copy the **address** from the output.

Fund the address from the public testnet faucet:
- https://faucet.pos.nimiq-testnet.com

Wait a few seconds for the tx to confirm. Verify the balance on https://test.nimiq.watch/ if you want.

### Ask your AI
> "Run `pnpm generate:wallet`, capture the address that was generated, and tell me what I need to do to fund it."

---

## Phase 3 — Start the stack (5 min)

**Goal:** local faucet running at http://localhost:8080 with a real funded wallet.

```bash
cd deploy/compose
cp .env.example .env
```

Edit `.env`:

```bash
FAUCET_NETWORK=test
FAUCET_SIGNER_DRIVER=wasm
FAUCET_WALLET_ADDRESS="<address from Phase 2>"
FAUCET_PRIVATE_KEY=<privateKey from .wallet.local.json>
FAUCET_ADMIN_PASSWORD=dev-admin-pw-xxxxxxxx
FAUCET_KEY_PASSPHRASE=dev-passphrase-xxxxxxxx
FAUCET_HASHCASH_DIFFICULTY=16   # lower = faster local tests
FAUCET_DEV=1                    # relaxes TLS + CORS checks
FAUCET_CORS_ORIGINS=*
```

Start the stack:

```bash
docker compose up -d --build
```

Verify:

```bash
curl http://localhost:8080/healthz                  # → "ok" or {"ok":true}
curl http://localhost:8080/v1/config | jq .         # → network:test, claimAmountLuna, abuseLayers
```

**Expected:** both endpoints return 200. `network: "test"`.

**Looks wrong:** server won't start, curl connection-refused, or `/v1/config` says `"main"`.

### Ask your AI
> "Bring up the docker-compose stack in `deploy/compose/` and confirm `GET /healthz` and `GET /v1/config` both return 200. If anything fails, pull the faucet container logs and summarise the root cause."

---

## Phase 4 — Smoke test a real claim (5 min)

**Goal:** a real testnet tx, confirmed on-chain, mediated by the faucet.

```bash
cd ../..   # back to repo root
FAUCET_BASE_URL=http://localhost:8080 pnpm smoke:testnet
```

**Expected output:**
```
[smoke] base url: http://localhost:8080
[smoke] network=test, hashcash=true
[smoke] generated fresh recipient: NQ…
[smoke] solving hashcash (difficulty=16)…
[smoke] hashcash solved
[smoke] claim accepted: id=… status=broadcast
[smoke] confirmed tx: <64-char hex>
[smoke] explorer: https://test.nimiq.watch/#<txid>
```

Open the explorer URL. You should see the transaction.

**Looks wrong:** "claim rejected" (check reason in logs), "not confirmed in 120000ms" (check wallet balance), or script errors (run once more — WASM consensus can take ~60s on cold start).

### Ask your AI
> "Run `pnpm smoke:testnet` against the local faucet and tell me the confirmed tx hash. If the script fails, explain why and propose a fix."

---

## Phase 5 — Admin dashboard tour (20 min)

**Goal:** click through every admin page, run the key actions, notice anything confusing.

Open http://localhost:8080/admin/login.

### Login + TOTP enrolment
1. Enter the `FAUCET_ADMIN_PASSWORD` you set in `.env`.
2. On first login: a TOTP provisioning QR is shown. Scan with Google Authenticator / Authy / 1Password.
3. Enter the 6-digit code to confirm enrolment.
4. You should land on `/admin/overview`.

### Overview page
- **Balance** matches Phase 2's funding amount minus any Phase 4 claim.
- **Claims/hour** shows 1 (the Phase 4 smoke claim).
- **Success rate** shows 100%.

### Claims page
- Table includes the Phase 4 claim with `status: confirmed`.
- Click the row → explain drawer opens with the full abuse-pipeline signal bundle.
- Try the manual **Allow** / **Deny** buttons against a test claim.

### Config page
- All the 7 abuse-layer toggles are visible.
- Try editing `claimAmountLuna` → save → refresh — the persisted override is reflected in `/v1/config`.

### Abuse page
- Blocklist is empty by default. Add an entry: kind=`ip`, value=`192.0.2.1`, reason=`test`, expiresAt in 5 min. Saved → shows in list → deletable.

### Integrators page
- Click **Create integrator** → enter name → API key + HMAC secret shown **once**. Copy them if you want to test [docs/integrator-hmac.md](./integrator-hmac.md).
- Rotate → new pair shown → old is invalid.

### Account page
- Shows your faucet wallet address + balance.
- Try **Send Luna** (TOTP step-up required). Send 1 NIM to a throwaway address.
- **Rotate TOTP** — requires current TOTP + re-confirm.

### Logs page
- Every admin action you just took is in the audit log.
- Log streams live (SSE) — refresh the page; new claims appear without manual refresh.

### "Ask your AI"
> "Walk through every admin page at http://localhost:8080/admin and tell me which ones feel confusing or broken. Flag any error message that says nothing useful."

---

## Phase 6 — Public claim UI (10 min)

**Goal:** exercise the public `/` claim page end-to-end, hitting every state.

Open http://localhost:8080/ in an incognito/private window (to avoid dashboard session cookies interfering).

### Path A — happy path
1. Paste a fresh Nimiq address (use `pnpm generate:wallet` again to get one).
2. Hashcash progress bar fills to 100%.
3. Click **Claim**.
4. Status transitions: `pending` → `broadcast` → `confirmed`.
5. Explorer link appears.

### Path B — invalid address
1. Paste `NQ00 00` (too short).
2. Inline validation error appears; submit button stays disabled.

### Path C — rate-limited
1. Fire multiple claims in a row (or drop `rateLimitPerIpPerDay` to 1 in the admin Config page).
2. The 2nd claim returns status `rejected` with a friendly message.

### Path D — captcha (optional)
If you configured Turnstile, hCaptcha, or FCaptcha in `.env`, verify the widget renders, returns a token, and the server accepts it. If you haven't, skip this.

### Path E — WS vs polling
Kill the WebSocket in DevTools. The status should still converge via the `GET /v1/claim/:id` polling fallback.

### Ask your AI
> "Open http://localhost:8080/ and exercise the claim form with a valid address, then with an invalid address, then by hammering it to trigger the rate limit. Screenshot or describe each state and tell me anything that looks broken."

---

## Phase 7 — Example apps (30 min)

**Goal:** every example runs and can claim against the local faucet.

From the repo root:

```bash
docker compose -f deploy/compose/docker-compose.yml -f examples/docker-compose.yml up --build -d
```

Verify each example:

| Example | URL | Expected |
|---------|-----|----------|
| nextjs-claim-page | http://localhost:3001 | Next.js page, claim works |
| vue-claim-page | http://localhost:3002 | Vue page, claim works |
| capacitor-mobile-app (web preview) | http://localhost:3003 | Capacitor React app, claim works |
| go-backend-integration | `curl -X POST http://localhost:3005/claim -d '{"address":"NQ…"}'` | Returns `{"status":"confirmed","txId":…}` |
| flutter-mobile-app (CLI) | `docker compose … logs example-flutter` | CLI logs show claim + confirmation |

For each: click / curl, confirm a claim lands on-chain, look at the example's README for the intended demo.

### Ask your AI
> "Start all five examples via `docker compose -f deploy/compose/docker-compose.yml -f examples/docker-compose.yml up`. For each one, verify it can claim against the local faucet and report anything that doesn't work."

---

## Phase 8 — SDK integration spot-checks (15 min)

**Goal:** confirm each SDK can be imported + call the faucet.

### TypeScript / Node
```bash
cd /tmp && mkdir sdk-check && cd sdk-check
pnpm init -y
pnpm add @nimiq-faucet/sdk
node -e "
const { FaucetClient } = require('@nimiq-faucet/sdk');
const c = new FaucetClient({ url: 'http://localhost:8080' });
c.config().then(console.log);
"
```

Expected: prints `{ network: 'test', claimAmountLuna: '100000', abuseLayers: {…}, … }`.

### React / Vue / Capacitor / React Native
Use the corresponding example app (Phase 7) — it's already a working SDK integration.

### Go
```bash
cd /tmp && mkdir go-check && cd go-check
go mod init sdk-check
go get github.com/PanoramicRum/nimiq-simple-faucet/packages/sdk-go
cat > main.go <<'EOF'
package main
import (
  "context"; "fmt"
  faucet "github.com/PanoramicRum/nimiq-simple-faucet/packages/sdk-go"
)
func main() {
  c := faucet.New(faucet.Config{URL: "http://localhost:8080"})
  cfg, err := c.Config(context.Background())
  if err != nil { panic(err) }
  fmt.Printf("%+v\n", cfg)
}
EOF
go run main.go
```

### Flutter / Dart
Already covered by Phase 7's flutter example CLI log.

### Ask your AI
> "Write a minimal script that imports `@nimiq-faucet/sdk`, hits the local faucet's `/v1/config`, and prints the result. Do the same for the Go SDK. Flag any import error."

---

## Phase 9 — CLI tools (5 min)

**Goal:** the repo-local CLI / script commands all work.

```bash
pnpm generate:wallet --force             # regenerate a throwaway wallet (force = overwrite)
# Optional: edit .wallet.local.json away if you want to keep the Phase 2 one.

pnpm -F @faucet/server freeze:openapi    # regenerates packages/openapi/openapi.{yaml,json}
git diff packages/openapi/                # diff should be empty if the spec is up to date
```

Also confirm the MCP inspector route is up:

```bash
curl http://localhost:8080/mcp            # GET returns the MCP discovery endpoint
```

### Ask your AI
> "Run `pnpm -F @faucet/server freeze:openapi` and tell me whether the regenerated spec differs from what's committed."

---

## Phase 10 — MCP server (15 min)

**Goal:** talk to the faucet's MCP endpoint like an AI coding agent would.

Easiest: **MCP Inspector**.

```bash
npx @modelcontextprotocol/inspector http://localhost:8080/mcp
```

Point your browser at the printed URL and:

1. **List tools** — you should see `faucet.status`, `faucet.recent_claims`, `faucet.stats` (public) and the admin-scoped ones.
2. **Call `faucet.stats`** — returns the same stats as `GET /v1/stats`.
3. **Call `faucet.recent_claims`** with `limit: 5` — returns the last 5 claims.
4. **Call `faucet.explain_decision`** with the claim id from Phase 4 — returns the full signal bundle.
5. **Admin tools** — set `FAUCET_ADMIN_MCP_TOKEN` on the server side and provide it as `X-Faucet-Admin-Token`; try `faucet.balance`.

Alternative: point Claude Code at the MCP URL and ask it questions like "show me the last 5 claims".

### Ask your AI
> "Connect to http://localhost:8080/mcp via the MCP Inspector or your built-in MCP client. List the available tools, then call `faucet.stats` and `faucet.explain_decision` against the last claim id. Summarise the result."

---

## Phase 11 — Abuse layers in action (30 min)

**Goal:** trigger each abuse layer deliberately and confirm it rejects (or scores down) the expected requests.

Work through each layer. After each deliberate rejection, check the admin dashboard's **Claims** page — the claim appears with `decision: deny` and the signal bundle shows which layer flagged it.

### Per-IP rate limit
- In `.env`, set `FAUCET_RATE_LIMIT_PER_IP_PER_DAY=1` → `docker compose restart faucet`.
- Submit 2 claims rapidly. Second one `rejected` with rate-limit reason.

### Blocklist
- In the admin **Abuse** page, add blocklist entry kind=`ip`, value=`127.0.0.1` (your loopback).
- Submit a claim. Should be denied.
- Remove the entry to unblock.

### Hashcash
- Submit a claim without solving the puzzle (i.e., manually POST `/v1/claim` with no `hashcashSolution` after disabling the UI solver). Rejected.
- Try submitting with a bogus solution. Rejected.

### Captcha (optional)
- Configure Turnstile (free at Cloudflare), fail the captcha on purpose, confirm rejection.

### GeoIP (optional — needs MaxMind DB or IPinfo key)
- Enable `FAUCET_GEOIP_BACKEND=ipinfo` + a token.
- Set `FAUCET_GEOIP_DENY_VPN=true`. Submit from a known VPN IP. Rejected.

### Fingerprint correlation
- Set `FAUCET_FINGERPRINT_ENABLED=true` + `FAUCET_FINGERPRINT_MAX_VISITORS_PER_UID=1`.
- Submit 2 claims with the same `uid` but 2 different `visitorId`s (via curl). Second one goes to `review`.

### On-chain heuristics
- `FAUCET_ONCHAIN_ENABLED=true`. Submit a claim for an address you know has recent sweeper activity on testnet. Should get scored down / denied.

### AI scoring
- `FAUCET_AI_ENABLED=true`. Submit unusual request patterns (velocity bursts, weird entropy in hostContext). Score rises.

### Ask your AI
> "Help me trigger each of the 10 abuse layers deliberately so I can see them in action. For each one, tell me what flag to set, what request to send, and what the expected rejection reason should look like in the admin claims drawer."

---

## Phase 12 — UX review (30+ min, open-ended)

**Goal:** the feedback phase. Note what's rough, file issues.

### Admin dashboard checklist
- [ ] Login flow: is the TOTP enrolment clear on first login?
- [ ] Overview: do the numbers update without manual refresh? Are they labeled?
- [ ] Claims drawer: signals readable? Can you tell at a glance which layer rejected a claim?
- [ ] Config page: are any field labels unclear? Any values that could be destructive and lack confirmation?
- [ ] Audit log: does live streaming reconnect after a dropped WS? Is the JSON signals blob too wall-of-text?
- [ ] Accessibility: keyboard-only tab order, focus rings visible, ARIA on modals, contrast on disabled buttons.
- [ ] Mobile: does the dashboard work at 375px width? Any horizontal scroll?
- [ ] Errors: are they always actionable? (i.e. "invalid password" → fine; "Error 500" → bad)

### Example apps checklist
- [ ] `pnpm install && pnpm dev` just works for each JS example?
- [ ] READMEs accurate — commands match what actually runs?
- [ ] Error states surfaced, or do they just hang?
- [ ] Is it obvious how to point the example at your own faucet URL?

### Docs checklist
- [ ] All links in `docs/README.md` resolve?
- [ ] Does the order of Phase N in this doc match what someone actually needs to do?
- [ ] Any command that doesn't run verbatim anymore?

### Output
File everything at https://github.com/PanoramicRum/nimiq-simple-faucet/issues with label `ux-polish` (create the label if it doesn't exist yet). One issue per finding; be specific about what you saw and what you expected.

### Ask your AI
> "You just ran Phases 5, 6, 7 of `docs/qa-testing.md`. Make a punchy list of everything that could be improved — confusing labels, missing confirmation dialogs, broken links, slow pages, anything. One bullet per finding. Top 10 priority items first."

---

## What next

- File `ux-polish` issues from Phase 12 — these drive the [ROADMAP](../ROADMAP.md) 1.0.x / 1.1 polish buckets.
- If you want to formalise testing further, see the [QA program](../ROADMAP.md#qa) planned in Beyond 1.x.
- For running the faucet in production, see [deployment-production.md](./deployment-production.md).
- For backend integration with HMAC-signed hostContext, see [integrator-hmac.md](./integrator-hmac.md).
- For the anti-fraud story (share with non-engineers), see [fraud-prevention.md](./fraud-prevention.md).
