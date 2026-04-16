# @faucet/abuse-hashcash

Hashcash (client-side SHA-256 puzzle) abuse layer. Raises the cost of
automated claim spam without requiring a captcha.

Implements `AbuseCheck` from [@faucet/core](../core/) — registered in
[`apps/server/src/abuse/pipeline.ts`](../../apps/server/src/abuse/pipeline.ts).

## What it checks

The client must have solved a server-issued challenge before the claim
is accepted. Each challenge is HMAC-signed, TTL-bounded, and
single-use (via a nonce cache).

## Config

| Env | Default | Purpose |
|-----|---------|---------|
| `FAUCET_HASHCASH_SECRET` | — | HMAC secret for challenge minting (enables this layer when set) |
| `FAUCET_HASHCASH_DIFFICULTY` | `20` | Leading zero bits required (SHA-256) |
| `FAUCET_HASHCASH_TTL_MS` | `300000` | Challenge validity window (5 min default) |

## Behaviour

- Returns `deny` if the solution doesn't verify or is replayed.
- Returns `allow` + a low score when valid.
- Fast (≪1 ms verify on server; ~1 s solve on modern hardware at 20 bits).

## Naming note

Despite solving SHA-256 puzzles this layer is **not** "proof-of-work" —
the Nimiq chain itself is proof-of-stake (Albatross). The name follows
the original Hashcash RFC to avoid the blockchain-consensus implication.

## See also

- [@faucet/core](../core/) — `AbuseCheck` interface
- [docs/integrator-hmac.md](../../docs/integrator-hmac.md) — signing flow
