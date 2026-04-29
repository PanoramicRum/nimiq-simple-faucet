## syntax=docker/dockerfile:1.7
# Nimiq Simple Faucet — single-image build.
# Stages: deps → server+packages build → UI build → runtime.
# Default profile runs SQLite at /data/faucet.db. Both UIs (public claim UI + admin dashboard)
# are baked into the image and served by Fastify at `/` and `/admin/`.

# Audit finding #006 / issue #92: pin the base image by digest, not just
# tag. Tags are mutable on Docker Hub — `node:22-bookworm-slim` rolls
# forward when upstream republishes, so a `docker pull` at build time
# could fetch a different image than the one CI tested. Dependabot's
# `docker` ecosystem will bump both digest and the trailing tag comment
# together (see .github/dependabot.yml).
FROM node:22-bookworm-slim@sha256:d415caac2f1f77b98caaf9415c5f807e14bc8d7bdea62561ea2fef4fbd08a73c AS base
ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"
RUN corepack enable
WORKDIR /app

FROM base AS deps
# Python + build tools so pnpm can compile optional native bindings
# (bufferutil, utf-8-validate) under multi-arch buildx/QEMU.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY deploy/docker/pnpm-workspace.docker.yaml pnpm-workspace.yaml
COPY package.json tsconfig.base.json turbo.json pnpm-lock.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/claim-ui/package.json apps/claim-ui/
COPY apps/dashboard/package.json apps/dashboard/
COPY apps/nimiq-pow-ui/package.json apps/nimiq-pow-ui/
COPY packages/core/package.json packages/core/
COPY packages/driver-nimiq-rpc/package.json packages/driver-nimiq-rpc/
COPY packages/driver-nimiq-wasm/package.json packages/driver-nimiq-wasm/
COPY packages/abuse-fcaptcha/package.json packages/abuse-fcaptcha/
COPY packages/abuse-hashcash/package.json packages/abuse-hashcash/
COPY packages/abuse-hcaptcha/package.json packages/abuse-hcaptcha/
COPY packages/abuse-geoip/package.json packages/abuse-geoip/
COPY packages/abuse-fingerprint/package.json packages/abuse-fingerprint/
COPY packages/abuse-onchain-nimiq/package.json packages/abuse-onchain-nimiq/
COPY packages/abuse-ai/package.json packages/abuse-ai/
COPY packages/sdk-ts/package.json packages/sdk-ts/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS build
COPY packages packages
COPY apps/server apps/server
COPY apps/claim-ui apps/claim-ui
COPY apps/dashboard apps/dashboard
COPY apps/nimiq-pow-ui apps/nimiq-pow-ui
RUN pnpm turbo run build \
    --filter=@faucet/server \
    --filter=@nimiq-faucet/claim-ui \
    --filter=@nimiq-faucet/dashboard \
    --filter=@nimiq-faucet/nimiq-pow-ui

FROM build AS prune
# Produce a self-contained production deployment for the server.
# `pnpm deploy --prod` walks @faucet/server's PRODUCTION dependency
# graph only, so dev-only tools (esbuild via vite/drizzle-kit/tsx/
# vitest, etc.) are excluded by construction.
#
# Scripts MUST run here — `better-sqlite3` fetches / compiles its
# native .node binding via its install script; without it the runtime
# image can't open the database. Earlier attempts with
# `--ignore-scripts + pnpm rebuild better-sqlite3` did not write the
# binding to the deploy tree layout that `bindings` searches, so we
# take the straightforward path instead.
RUN pnpm --filter=@faucet/server deploy --prod /deployed-server

FROM base AS runtime
ENV NODE_ENV=production
ENV FAUCET_DATA_DIR=/data
# Pull in the latest Debian security patches on top of the node:22
# bookworm-slim base. Keeps the image small (no build tools) but
# addresses OS-level CVEs the base image hasn't picked up yet.
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get upgrade -y \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*
# Strip the npm CLI bundled with the Node image. We use pnpm/node at
# runtime, never npm — but npm ships its own copy of picomatch, tar,
# etc. which drag in CVEs we can't patch (they live in upstream Node
# releases). Deleting the dir is the cleanest fix.
RUN rm -rf /usr/local/lib/node_modules/npm \
    /usr/local/bin/npm /usr/local/bin/npx
RUN mkdir -p /data && chown -R node:node /data
# Deployed server: self-contained node_modules + package.json + dist.
COPY --from=prune /deployed-server /app/apps/server
# Static UI bundles served by Fastify at / and /admin/. Themes live
# under /app/themes/<slug>/dist so FAUCET_CLAIM_UI_THEME=<slug> can
# flip between them at runtime — no rebuild. Adding a new theme is a
# Dockerfile one-liner per app/server/src/themes.ts entry; the
# registry's `distInImage` field documents the expected path.
COPY --from=build /app/apps/claim-ui/dist /app/themes/porcelain-vault/dist
COPY --from=build /app/apps/nimiq-pow-ui/dist /app/themes/nimiq-pow/dist
# Backwards compat: keep the legacy /app/apps/claim-ui/dist path so any
# operator who hardcoded FAUCET_CLAIM_UI_DIR=/app/apps/claim-ui/dist
# in their deployment continues to work. Remove in the next major.
COPY --from=build /app/apps/claim-ui/dist /app/apps/claim-ui/dist
COPY --from=build /app/apps/dashboard/dist /app/apps/dashboard/dist
# Workspace marker (kept to satisfy `node` resolution from monorepo root).
COPY --from=build /app/package.json /app/package.json
USER node
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/server/dist/index.js"]
