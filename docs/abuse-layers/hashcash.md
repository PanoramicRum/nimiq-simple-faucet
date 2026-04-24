# Hashcash (Client Puzzle)

Self-hosted SHA-256 client puzzle that adds a computational cost to every claim. No third-party dependency — the faucet server mints and verifies challenges using HMAC-signed tokens.

> **Naming note:** This layer is named "hashcash" after the [Hashcash RFC](http://www.hashcash.org/), not blockchain proof-of-work. Nimiq is a proof-of-stake blockchain; the terminology is deliberately distinct.

## How it works

1. Client requests a challenge via `POST /v1/challenge`
2. Server mints an HMAC-signed challenge with configurable difficulty and TTL
3. Client brute-forces SHA-256 hashes to find a nonce satisfying the difficulty (leading zero bits)
4. Client submits the solution with the claim request as `hashcashSolution`
5. Server verifies the HMAC signature, TTL, and nonce — rejects replayed solutions

## Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `FAUCET_HASHCASH_SECRET` | _(unset = disabled)_ | HMAC secret for challenge minting |
| `FAUCET_HASHCASH_DIFFICULTY` | `20` | Leading zero bits required (range 8-30) |
| `FAUCET_HASHCASH_TTL_MS` | `300000` | Challenge validity window (5 minutes) |

Setting `FAUCET_HASHCASH_SECRET` enables the layer. Use a random string of at least 32 characters.

### Difficulty tuning

| Difficulty | Browser (single Worker) | Script (parallel workers) | Use case |
|-----------|------------------------|--------------------------|----------|
| 8 | <100ms | <10ms | Testing / development |
| 16 | ~500ms | ~30ms | Low-friction, dev only |
| 20 | ~1-2s | ~170ms | Minimum for production |
| 22 | ~4-8s | ~700ms | Recommended production |
| 24 | ~15-30s | ~3s | High-value faucets |
| 30 | ~minutes | ~minutes | Maximum friction |

> **Important:** Hashcash alone is not sufficient for public-facing faucets. A Python script with 7 CPU workers can solve difficulty 20 in ~0.17 seconds. For real protection against automated scripts, combine hashcash with at least one additional layer — either a CAPTCHA provider (Turnstile/hCaptcha/FCaptcha), `FAUCET_REQUIRE_BROWSER=true` (Sec-Fetch header enforcement), or both.

## Decision logic

- **No solution provided:** `challenge` (client must solve and retry)
- **Invalid HMAC, expired TTL, or replayed nonce:** `deny`
- **Valid solution:** `allow` with low score

## ClaimUI experience

The ClaimUI renders a `HashcashRunner` component when hashcash is enabled. The flow:

1. User enters a valid address → the runner mounts and requests a challenge from `POST /v1/challenge`
2. A Web Worker brute-forces SHA-256 hashes in the background
3. A progress bar shows linear progress: `attempts / 2^difficulty` (capped at 90% until verified)
4. A "computations" counter shows the work done
5. When solved, the progress bar fills to 100% and the claim button activates

The progress bar uses a CSS transition for smooth animation. At difficulty 20, expect ~1-2 seconds on modern hardware.

User-facing messages are customizable in `src/i18n/en.ts`:

| Key | Default | Purpose |
|-----|---------|---------|
| `challenge.solving` | "Running a quick anti-spam check ..." | Shown during solving |
| `challenge.attempts` | "{{n}} computations" | Counter below the progress bar |
| `challenge.ready` | "Verification complete." | Shown when solved |

## Trade-offs

- **Zero external dependencies** — entirely self-hosted
- **Effective against scripted flooding** — bots must spend CPU per claim
- **Transparent to users** — the ClaimUI runs the solver in a Web Worker with a progress bar
- **Not effective against** dedicated attackers with GPU farms (but raises their cost)

## SDK support

All frontend SDKs include a `HashcashRunner` component that automatically requests a challenge, solves it in a Web Worker, and passes the solution to the claim request. Backend SDKs (Python, Go) include `solveHashcash()` / `SolveAndClaim()` helpers.

3 of 6 examples currently demonstrate hashcash (Vue, Capacitor, Go). Adding hashcash to the remaining examples (Next.js, Flutter, Python) is tracked in [ROADMAP §3.0.7](../../ROADMAP.md).
