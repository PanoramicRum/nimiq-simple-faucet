# Contributing

Thanks for your interest in contributing to Nimiq Simple Faucet!

## Prerequisites

- **Node.js 22+**
- **pnpm 9+** (corepack: `corepack enable`)
- **Docker** (for compose / integration tests)
- Optional: **Dart 3+** (for the Flutter SDK example), **Go 1.22+** (for the Go example)

## Getting started

```bash
git clone https://github.com/nimiq/simple-faucet.git
cd simple-faucet
pnpm install
pnpm build
pnpm test          # 53 vitest cases
pnpm test:e2e      # Playwright (install browsers first: pnpm test:e2e:install)
```

## Repository layout

```
apps/server/         Fastify API + abuse pipeline + admin routes
apps/claim-ui/       Public claim page (Vue 3 + Vite)
apps/dashboard/      Admin dashboard (Vue 3 + Vite)
apps/docs/           VitePress docs site
packages/core/       Driver + abuse interfaces (framework-agnostic)
packages/driver-*/   Nimiq signer drivers (RPC, WASM)
packages/abuse-*/    Abuse-prevention layers
packages/sdk-*/      Client SDKs (TS, React, Vue, Capacitor, React Native, Flutter, Go)
examples/            Integration examples with Dockerfiles
deploy/              Docker, Compose, Helm deployment configs
tests/               E2E (Playwright) and load tests (k6)
```

## Development workflow

1. Create a branch from `main`.
2. Make your changes. Run `pnpm typecheck` and `pnpm test` often.
3. Commit using [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, etc.).
4. Open a pull request against `main`. CI will run build, typecheck, test, and Docker build.

## Code style

- **TypeScript strict mode** (`exactOptionalPropertyTypes: true`).
- **Prettier** for formatting: `pnpm format`.
- No `any` types in production code. Type assertions only when unavoidable, with a comment explaining why.
- Never log secrets, keys, tokens, cookies, or TOTP codes.

## Adding a new package

1. Create the directory under `packages/` (or `apps/` for apps).
2. Add a `package.json`, `tsconfig.json`, and `llms.txt` describing the package surface.
3. If it's a workspace member, it's automatically picked up by `pnpm-workspace.yaml` globs.
4. Abuse-prevention packages must implement the `AbuseCheck` contract from `@faucet/core`.
5. Every new env var goes in `.env.example` with a one-line description.

## Running the full stack locally

```bash
# Option 1: Docker Compose (Postgres + Redis)
cd deploy/compose
cp .env.example .env    # edit as needed
docker compose up -d

# Option 2: Dev mode (SQLite, hot reload)
pnpm dev
```

## Tests

- **Unit / integration**: `pnpm test` (vitest, runs across all packages)
- **E2E**: `pnpm test:e2e` (Playwright against a stub driver — no real chain needed)
- **Load**: `cd tests/load && k6 run claim.js` (requires k6)

## Security

If you find a vulnerability, **do not open a public issue**. See [SECURITY.md](SECURITY.md) for reporting instructions.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
