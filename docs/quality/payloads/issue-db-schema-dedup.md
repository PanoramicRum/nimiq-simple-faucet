## Summary
SQLite and Postgres Drizzle schemas are maintained as two mostly duplicated files.

## Evidence
- `apps/server/src/db/schema.sqlite.ts` and `apps/server/src/db/schema.pg.ts` define the same tables/columns by hand.
- New columns or constraints require two synchronized edits and two review surfaces.
- Changelog/documentation already calls out mirrored schema maintenance burden.

## Why this matters
- High drift risk when evolving data model.
- Review overhead and test surface increase for every schema change.
- Duplicate schema definitions obscure intent and make future backend additions harder.

## Proposed direction
Introduce a shared table/column descriptor layer and dialect adapters to emit SQLite/PG Drizzle definitions from one model.

Possible incremental path:
1. Define canonical entity descriptors (`claims`, `blocklist`, etc.).
2. Provide adapter helpers to materialize sqliteTable/pgTable definitions.
3. Migrate one or two tables first as a proof of pattern, then roll out.

## Acceptance criteria
- Reduced duplicated schema declarations between sqlite and pg files.
- New column additions can be made once with dialect-specific details isolated.
- Existing migrations and runtime behavior remain unchanged.

## Duplicate check
No overlap with open security issues `#52`, `#53`, `#54`, `#55`.
