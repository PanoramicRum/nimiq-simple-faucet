# @faucet/abuse-ai

AI-scored abuse layer. Combines a deterministic rules engine with an
optional ONNX classifier to produce a final fraud score.

Implements `AbuseCheck` from [@faucet/core](../core/) — registered in
[`apps/server/src/abuse/pipeline.ts`](../../apps/server/src/abuse/pipeline.ts).

## Two-tier scoring

1. **Rules layer** (always on): velocity, signal entropy, timing
   regularity, hostContext freshness, integrator trust tier. Fast,
   deterministic, zero external dependencies.
2. **ONNX classifier** (optional): if `dataDir/ai/model.onnx` exists, the
   server loads it and feeds a feature vector per claim. Returns a
   probability in `[0, 1]` combined with the rules score.

## Config

| Env | Default | Purpose |
|-----|---------|---------|
| `FAUCET_AI_ENABLED` | `false` | Set `true` to enable |
| `FAUCET_AI_DENY_THRESHOLD` | `0.85` | Combined score ≥ this → deny |
| `FAUCET_AI_REVIEW_THRESHOLD` | `0.65` | Combined score ≥ this → review |

## Behaviour

- `deny` above deny threshold.
- `review` between review and deny thresholds.
- `allow` below review threshold, with top-3 contributing features
  returned in the signals bundle (useful for the admin explain drawer).
- Rules-only mode falls back gracefully when the ONNX model is absent.

## Training

Training a real model is out of scope for this package. The rules
engine is sufficient for the v0 use case; the classifier hook exists so
a better model can slot in without code changes.

## See also

- [@faucet/core](../core/) — `AbuseCheck` interface
- Admin `/admin/claims/:id/explain` route surfaces top contributing signals
