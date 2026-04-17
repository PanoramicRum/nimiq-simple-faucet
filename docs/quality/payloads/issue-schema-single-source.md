## Summary
OpenAPI request/response schemas and runtime route validators currently drift because we maintain parallel Zod shapes in multiple places.

## Evidence
- `apps/server/src/openapi/schemas.ts` defines route-facing DTOs (for OpenAPI generation).
- Route handlers still define their own schemas in place (example: `apps/server/src/routes/admin/config.ts` defines `PatchBody` independently).
- The new parity guard (`apps/server/test/openapi-parity.test.ts`) checks path coverage only; it does not protect request/response schema parity.

## Why this matters
- Same contract is implemented twice, so behavior can diverge without compile-time protection.
- Documentation can be technically "present" but semantically wrong.
- Every route update costs extra maintenance and review time.

## Proposed direction
Create one server-side contract source of truth and consume it from both runtime routes and OpenAPI generation.

Suggested approach:
1. Introduce shared contract modules (e.g. `apps/server/src/contracts/*`).
2. Route handlers import those schemas for request validation.
3. `openapi/schemas.ts` and `openapi/document.ts` import the same contract objects.
4. Extend parity tests to assert critical schema parity (not only paths).

## Acceptance criteria
- No duplicated route-level payload schemas between route files and OpenAPI registry modules for targeted admin/public routes.
- Contract updates require editing one schema definition.
- Test coverage prevents route/schema drift regressions.

## Duplicate check
No overlap with open issues `#52`, `#53`, `#54`, `#55` (those are security findings in runtime behavior, not schema-source architecture).
