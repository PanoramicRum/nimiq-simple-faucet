## Summary
React and Vue SDK packages implement near-identical faucet hook logic independently.

## Evidence
- `packages/sdk-react/src/index.ts` and `packages/sdk-vue/src/index.ts` both implement:
  - `useFaucetClaim` lifecycle orchestration
  - `useFaucetStatus` polling behavior
  - `useFaucetStream` subscription wiring
- Logic duplication includes request orchestration, confirmation polling, error/status transitions, and timer behavior.

## Why this matters
- Bug fixes and behavior improvements must be duplicated across frameworks.
- Subtle divergence risk grows over time (especially in pending/retry/error semantics).
- Harder to guarantee equivalent SDK behavior across ecosystems.

## Proposed direction
Extract a framework-agnostic hook engine (state machine + effects) and keep framework wrappers thin.

Suggested shape:
1. Add shared controller primitives in `@nimiq-faucet/sdk` (or dedicated shared package).
2. React/Vue wrappers bind framework-specific reactivity around that shared engine.
3. Add contract tests shared across wrappers to verify lifecycle equivalence.

## Acceptance criteria
- Claim/status/stream core logic exists in one reusable implementation.
- React/Vue wrappers primarily adapt to framework APIs.
- Cross-wrapper tests prove equivalent lifecycle behavior.

## Duplicate check
No overlap with open security issues `#52`, `#53`, `#54`, `#55`.
