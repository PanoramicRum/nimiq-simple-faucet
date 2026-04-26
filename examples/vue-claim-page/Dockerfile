## syntax=docker/dockerfile:1.7
# Vue claim page example — multi-stage build.
#
# Build context = repo root, e.g.
#   docker buildx build -f examples/vue-claim-page/Dockerfile -t vue-claim:test .
#
# Issue #116: the previous deps-only-cache pattern copied only a sliver
# of `package.json` files and tried to `pnpm install --frozen-lockfile=false`.
# pnpm validates the lockfile against every workspace member named in the
# root devDependencies (e.g. @faucet/abuse-hashcash), so install failed
# with `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`. The fix is to copy the full
# workspace and let `pnpm install --filter <example>...` prune unused
# graphs at install time. We trade per-layer cache granularity for
# correctness; the BuildKit pnpm-store mount keeps cold installs fast.

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY . .
ARG VITE_FAUCET_URL=http://localhost:8080
ENV VITE_FAUCET_URL=${VITE_FAUCET_URL}
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @nimiq-faucet/example-vue...
RUN pnpm turbo run build --filter=@nimiq-faucet/example-vue

FROM nginx:alpine AS runtime
COPY --from=build /app/examples/vue-claim-page/dist /usr/share/nginx/html
COPY examples/vue-claim-page/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
