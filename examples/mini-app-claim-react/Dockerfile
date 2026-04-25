# syntax=docker/dockerfile:1.7
# Production build of the React mini app — static bundle served by nginx.
# Build context = repo root. See ../mini-app-claim-vue/Dockerfile for the
# rationale on copying the entire workspace at once.

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
    pnpm install --frozen-lockfile --filter @nimiq-faucet/example-mini-app-react...
RUN pnpm turbo run build --filter=@nimiq-faucet/example-mini-app-react

FROM nginxinc/nginx-unprivileged:alpine AS runtime
COPY --from=build /app/examples/mini-app-claim-react/dist /usr/share/nginx/html
COPY examples/mini-app-claim-react/nginx.conf /etc/nginx/conf.d/default.conf
# nginx-unprivileged runs as user `nginx` and listens on 8080 by default
# so the container can run with no root capabilities.
EXPOSE 8080
