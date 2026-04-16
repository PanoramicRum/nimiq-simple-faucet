## syntax=docker/dockerfile:1.7
# Vue claim page example — multi-stage build.
# Build context must be the repo root.

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages/sdk-ts/package.json packages/sdk-ts/
COPY packages/sdk-vue/package.json packages/sdk-vue/
COPY examples/vue-claim-page/package.json examples/vue-claim-page/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile=false

FROM deps AS build
COPY packages/sdk-ts packages/sdk-ts
COPY packages/sdk-vue packages/sdk-vue
COPY examples/vue-claim-page examples/vue-claim-page
ARG VITE_FAUCET_URL=http://localhost:8080
ENV VITE_FAUCET_URL=${VITE_FAUCET_URL}
RUN pnpm turbo run build --filter=@nimiq-faucet/example-vue

FROM nginx:alpine AS runtime
COPY --from=build /app/examples/vue-claim-page/dist /usr/share/nginx/html
COPY examples/vue-claim-page/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
