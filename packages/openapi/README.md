# @faucet/openapi

Published OpenAPI 3.1 snapshot of the Nimiq Simple Faucet HTTP surface.

## How this package is produced

This file is **not hand-edited**. At release time a script fetches
`GET /openapi.json` from a running server, converts it to YAML, and commits the
result here. The checked-in copy is the canonical artefact SDK generators and
third-party docs tools consume.

## For developers

- The live spec source of truth is `apps/server/src/openapi/` in this repo.
- To regenerate locally: run the server (`pnpm --filter @faucet/server dev`)
  and `curl http://localhost:8080/openapi.yaml > packages/openapi/openapi.yaml`.
- CI enforces that the checked-in file matches the server output on release.

## Viewing the docs

A running faucet serves `/docs/api` (Stoplight Elements, CDN-loaded) when
`FAUCET_DEV=true` or `FAUCET_OPENAPI_PUBLIC=true`.
