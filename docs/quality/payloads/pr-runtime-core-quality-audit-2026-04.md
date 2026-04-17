## Summary
Implements the low-risk runtime-core quality tranche from the April 2026 audit:
- adds shared Nimiq address normalization/validation in `@faucet/core`
- rewires runtime + UI paths to use shared address helpers
- deduplicates server fake-driver test scaffolding
- adds OpenAPI/runtime route parity guard test
- documents missing admin routes in OpenAPI
- adds the canonical audit report under `docs/quality/`

## Why
Reduce duplicated logic and contract drift without breaking runtime APIs.

## Changes
1. Shared address helper
- Added `packages/core/src/nimiqAddress.ts`
- Exported via `packages/core/src/index.ts`
- Replaced duplicated regex parsing in:
  - `packages/driver-nimiq-rpc/src/index.ts`
  - `packages/driver-nimiq-wasm/src/index.ts`
  - `apps/claim-ui/src/lib/validate.ts`

2. Server test dedupe
- Added `apps/server/test/helpers/testDriver.ts`
- Refactored e2e/unit tests to extend `BaseTestDriver` and shared helpers

3. OpenAPI parity/drift reduction
- Added missing OpenAPI docs for:
  - `POST /admin/account/rotate-key`
  - `POST /admin/claims/{id}/allow`
  - `POST /admin/claims/{id}/deny`
- Added `apps/server/test/openapi-parity.test.ts` to assert runtime path parity with OpenAPI registrations

4. Audit report
- Added `docs/quality/runtime-core-quality-audit-2026-04.md`
- Linked report from `docs/README.md`

## Risk
Low. Behavior-preserving refactors plus docs/test parity guards.

## Validation (Docker)
- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:e2e`

## Deferred refactors (filed as follow-up issues)
- #57 Refactor OpenAPI/runtime route schemas to a single source of truth
- #58 Deduplicate runtime config mapping across server/admin/openapi/dashboard
- #59 Reduce duplicated SQLite/Postgres DB schema declarations
- #60 Unify React/Vue SDK hook engines to prevent lifecycle drift

## Overlap check
Reviewed open issues `#52`–`#55`; no duplicates were filed from this audit tranche.
