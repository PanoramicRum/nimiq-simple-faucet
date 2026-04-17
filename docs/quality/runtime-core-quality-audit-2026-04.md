# Runtime Core Quality Audit (2026-04)

## Audit Metadata
- Date: 2026-04-17
- Scope: `apps/server`, `packages/core`, `packages/driver-*`, `packages/sdk-*`, and root quality scripts/checks.
- Baseline branch/commit: `origin/main` @ `1a58c48`.
- Audit branch: `chore/runtime-core-quality-audit-2026-04`.
- Tooling used: `rg`, `git`, `gh`, Docker (`node:22-bookworm`), `corepack`/`pnpm@10.17.0`, `turbo`, `vitest`, `playwright`.
- Execution mode: runtime quality gates (`build`, `typecheck`, `test`, `test:e2e`) executed inside Docker containers.

## Findings Register
| ID | Finding | Classification | Rationale | Disposition |
| --- | --- | --- | --- | --- |
| F1 | Nimiq address regex/normalization duplicated across drivers and UI validator | `fix-now` | Low-risk simplification with immediate drift reduction | Implemented in audit PR candidate |
| F2 | Server fake drivers duplicated across many tests | `fix-now` | Repeated boilerplate raised maintenance cost and inconsistency risk | Implemented in audit PR candidate |
| F3 | No automated guard for OpenAPI path parity vs runtime route registration | `fix-now` | Drift risk can silently ship broken/undocumented contracts | Implemented in audit PR candidate |
| F4 | Missing OpenAPI docs for admin routes (`/admin/account/rotate-key`, `/admin/claims/{id}/allow`, `/admin/claims/{id}/deny`) | `fix-now` | Public contract incomplete despite implemented runtime endpoints | Implemented in audit PR candidate |
| F5 | OpenAPI DTO schemas and route validators are maintained in parallel | `issue` | Requires broader refactor to shared contract source; not low-risk | Filed as #57 |
| F6 | Runtime config mappings duplicated across server/admin/openapi/dashboard | `issue` | Multi-surface refactor with cross-package impact; too large for low-risk tranche | Filed as #58 |
| F7 | SQLite/Postgres schema declarations are duplicated | `issue` | Requires schema abstraction and migration-safety design work | Filed as #59 |
| F8 | React/Vue SDK hook engines duplicate lifecycle logic | `issue` | Framework-wide architecture work; exceeds low-risk tranche scope | Filed as #60 |
| F9 | Security findings already tracked as open issues (`#52`-`#55`) | `no-action` | Avoid duplicate filing; security backlog already active | Mapped to existing issues only |

## PR Ledger
| PR | Title | Purpose | Risk | Test evidence | Merge status |
| --- | --- | --- | --- | --- | --- |
| [#61](https://github.com/PanoramicRum/nimiq-simple-faucet/pull/61) | Runtime core quality audit (low-risk simplification tranche) | Implement F1-F4 plus report deliverables | Low | Docker: `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` | Open |

## Issue Ledger
| Issue | Problem statement | Why deferred from PR | Priority | Recommended owner |
| --- | --- | --- | --- | --- |
| [#57](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/57) | OpenAPI/runtime schemas not single-source | Cross-cutting contract refactor across routing + docs | P1 | Server platform maintainer |
| [#58](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/58) | Runtime config mapping duplicated across layers | Requires shared config catalog + derived DTO/types | P1 | Server + dashboard maintainers |
| [#59](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/59) | SQLite/Postgres schema duplication | Requires dialect abstraction and careful rollout | P2 | Persistence/DB maintainer |
| [#60](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/60) | React/Vue hook engine duplication | Requires shared lifecycle engine and wrapper adaptation | P2 | SDK maintainer |

## Recommendation Ledger
| Recommendation | Impact | Effort | Dependency | Disposition |
| --- | --- | --- | --- | --- |
| Introduce shared Nimiq address normalize/validate helper in `@faucet/core` | High drift reduction | Low | None | `implemented` |
| Reuse shared address helper from RPC/wasm drivers and claim UI | High consistency gain | Low | Shared helper | `implemented` |
| Deduplicate server test fake driver scaffolding | Medium maintainability gain | Low | Shared test helper | `implemented` |
| Add OpenAPI/runtime path parity guard test | Medium contract-safety gain | Low | Route/document parser test | `implemented` |
| Add missing admin route docs to OpenAPI | Medium API correctness gain | Low | OpenAPI document update | `implemented` |
| Refactor schemas to single source of truth | High long-term safety | Medium/High | Contract module design | `filed` (#57) |
| Deduplicate runtime config mapping definitions | High operator/API consistency | High | Shared config catalog | `filed` (#58) |
| Reduce SQLite/Postgres schema duplication | Medium maintainability gain | High | Schema descriptor abstraction | `filed` (#59) |
| Unify React/Vue SDK hook engines | Medium cross-SDK consistency | Medium | Shared lifecycle engine | `filed` (#60) |
| Keep existing security backlog tracked without duplicate filing | High signal/noise improvement | Low | Existing issues #52-#55 | `deferred` |

## Duplicate Check
### Existing open issues reviewed
- [#52](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/52) Per-IP rate limit bypassable via concurrent requests (TOCTOU).
- [#53](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/53) Concurrent integrator key rotation overwrite race.
- [#54](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/54) Source maps served in production.
- [#55](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/55) Login endpoint password correctness enumeration.

### Existing open PRs reviewed for overlap
- Dependabot update PRs currently open (`#24`-`#31`) were reviewed; no overlap with this runtime-core audit tranche.

### Finding-to-existing-ID mapping
- F9 maps to existing security backlog `#52`-`#55`.
- No duplicate issue was created for any finding already covered by those open issues.

## Validation Evidence
All commands below were executed in Docker (`node:22-bookworm`) with workspace mounted at `/workspace/repo`:
- `pnpm install --frozen-lockfile=false`
- `pnpm build` ✅
- `pnpm typecheck` ✅
- `pnpm test` ✅
- `pnpm test:e2e:install` ✅
- `pnpm test:e2e` ✅ (42 passed)

## Next-Step Execution Order (Top 5)
1. Execute #57 (schema single-source refactor) before adding new admin/public endpoints.
2. Execute #58 (config catalog unification) to reduce operator/API/dashboard drift.
3. Prioritize security fixes from #55 and #52 (highest exploitability) on the hardening track.
4. Execute #59 (schema duplication reduction) once #57/#58 contract work stabilizes.
5. Execute #60 (SDK hook engine unification) with shared lifecycle conformance tests.
