## syntax=docker/dockerfile:1.7
# Capacitor mobile app — web preview build.
# Build context must be the repo root.

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/sdk-ts/package.json packages/sdk-ts/
COPY packages/sdk-react/package.json packages/sdk-react/
COPY packages/sdk-capacitor/package.json packages/sdk-capacitor/
COPY examples/capacitor-mobile-app/package.json examples/capacitor-mobile-app/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile=false

FROM deps AS build
COPY packages/core packages/core
COPY packages/sdk-ts packages/sdk-ts
COPY packages/sdk-react packages/sdk-react
COPY packages/sdk-capacitor packages/sdk-capacitor
COPY examples/capacitor-mobile-app examples/capacitor-mobile-app
ARG VITE_FAUCET_URL=http://localhost:8080
ENV VITE_FAUCET_URL=${VITE_FAUCET_URL}
RUN pnpm turbo run build --filter=@nimiq-faucet/example-capacitor

FROM nginx:alpine AS runtime
COPY --from=build /app/examples/capacitor-mobile-app/dist /usr/share/nginx/html
COPY examples/capacitor-mobile-app/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
