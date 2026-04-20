# AI Anomaly Scoring

Two-tier scoring system combining deterministic rules with an optional ONNX machine learning classifier. Runs entirely locally with zero external dependencies.

## How it works

### Tier 1: Rules engine (always on when enabled)

A set of deterministic checks that analyze claim patterns:

- **Velocity:** How fast claims arrive from the same IP/address
- **Signal entropy:** Low entropy across multiple signals suggests automated behavior
- **Timing regularity:** Machine-generated requests tend to arrive at regular intervals
- **HostContext freshness:** Stale or reused hostContext data suggests replay
- **Integrator trust tier:** Claims from verified integrators get a trust bonus

### Tier 2: ONNX classifier (optional)

If a trained ONNX model exists at `{dataDir}/ai/model.onnx`, the layer loads it and feeds a feature vector per claim. The model returns a probability in [0, 1] which is combined with the rules score.

Training the model is out of scope for the package. The ONNX hook allows you to train a classifier externally and slot it in without code changes.

## Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `FAUCET_AI_ENABLED` | `false` | Enable AI scoring layer |
| `FAUCET_AI_DENY_THRESHOLD` | `0.85` | Combined score >= this → deny |
| `FAUCET_AI_REVIEW_THRESHOLD` | `0.65` | Combined score >= this → review |

## Decision logic

- **Combined score >= deny threshold (0.85):** `deny`
- **Combined score >= review threshold (0.65):** `review`
- **Below review threshold:** `allow` with top-3 contributing features in signals

The signals bundle includes the top 3 features that contributed most to the score, visible in the admin dashboard's "explain" drawer for each claim.

## Trade-offs

- **Zero external dependencies** — rules engine is fully deterministic
- **CPU-only ONNX inference** — no GPU required
- **Graceful fallback** — works in rules-only mode without an ONNX model
- **Requires training data** for the classifier to be effective — initial deployment should use rules-only
- **Transparent scoring** — top features are always reported for admin inspection
