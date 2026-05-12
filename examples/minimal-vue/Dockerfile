## syntax=docker/dockerfile:1.7
# Minimal Vue 3 + Vite faucet example — multi-stage build.
#
# Build context = repo root, e.g.
#   docker buildx build -f examples/minimal-vue/Dockerfile -t minimal-vue:test .
#
# Same workspace-wide install pattern as the other example Dockerfiles
# (see examples/vue-claim-page/Dockerfile, issue #116).

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
    pnpm install --frozen-lockfile --filter @nimiq-faucet/example-minimal-vue...
RUN pnpm turbo run build --filter=@nimiq-faucet/example-minimal-vue

FROM nginx:alpine AS runtime
COPY --from=build /app/examples/minimal-vue/dist /usr/share/nginx/html
COPY examples/minimal-vue/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
