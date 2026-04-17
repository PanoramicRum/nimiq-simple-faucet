## Summary
Runtime config shape and key mappings are duplicated across server config loading, admin APIs, OpenAPI schema declarations, and dashboard form models.

## Evidence
- `apps/server/src/config.ts` contains core config schema + `ENV_KEYS` mapping.
- `apps/server/src/routes/admin/config.ts` re-declares patch payload shape and builds a separate `base` response mapping.
- `apps/server/src/openapi/schemas.ts` re-declares `AdminConfigPatch` and `AdminConfigResponse`.
- `apps/dashboard/src/views/ConfigView.vue` duplicates config response and patch types.

## Why this matters
- Key-name and constraint drift is likely as settings evolve.
- Operator UX and API docs can silently diverge from runtime behavior.
- Adding/changing config keys currently requires touching many files.

## Proposed direction
Create a central config catalog that defines:
- logical key name
- type/validation constraints
- env var name
- serialization/parsing strategy for persisted overrides
- admin API exposure metadata (read-only, restart-required, hot-reload)

Then derive admin route schemas, OpenAPI DTOs, and dashboard TS types from that catalog.

## Acceptance criteria
- Config key metadata is centralized and reused.
- Admin patch/get and OpenAPI config schema are generated from shared metadata.
- Dashboard config types are imported/generated from shared API schema, not handwritten duplicates.

## Duplicate check
No overlap with open security issues `#52`, `#53`, `#54`, `#55`.
