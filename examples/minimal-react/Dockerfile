## syntax=docker/dockerfile:1.7
# Minimal React + Vite faucet example — multi-stage build.
#
# Build context = repo root, e.g.
#   docker buildx build -f examples/minimal-react/Dockerfile -t minimal-react:test .
#
# Same workspace-wide install pattern as the other example Dockerfiles
# (see examples/vue-claim-page/Dockerfile, issue #116): copy the full
# workspace and let `pnpm install --filter <example>...` prune the graph,
# rather than the deps-only-cache pattern that breaks the lockfile.

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
    pnpm install --frozen-lockfile --filter @nimiq-faucet/example-minimal-react...
RUN pnpm turbo run build --filter=@nimiq-faucet/example-minimal-react

FROM nginx:alpine AS runtime
COPY --from=build /app/examples/minimal-react/dist /usr/share/nginx/html
COPY examples/minimal-react/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
