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

| Difficulty | Approximate client solve time | Use case |
|-----------|------------------------------|----------|
| 8 | <100ms | Testing / development |
| 16 | ~500ms | Low-friction production |
| 20 | ~1-2s | Standard production |
| 24 | ~10-30s | High-value faucets |
| 30 | ~minutes | Maximum friction |

## Decision logic

- **No solution provided:** `challenge` (client must solve and retry)
- **Invalid HMAC, expired TTL, or replayed nonce:** `deny`
- **Valid solution:** `allow` with low score

## Trade-offs

- **Zero external dependencies** — entirely self-hosted
- **Effective against scripted flooding** — bots must spend CPU per claim
- **Transparent to users** — the ClaimUI runs the solver in a Web Worker with a progress bar
- **Not effective against** dedicated attackers with GPU farms (but raises their cost)

## SDK support

All frontend SDKs include a `HashcashRunner` component that automatically requests a challenge, solves it in a Web Worker, and passes the solution to the claim request. Backend SDKs (Python, Go) include `solveHashcash()` / `SolveAndClaim()` helpers.
