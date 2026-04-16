## syntax=docker/dockerfile:1.7
# Nimiq Simple Faucet — single-image build.
# Stages: deps → server+packages build → UI build → runtime.
# Default profile runs SQLite at /data/faucet.db. Both UIs (public claim UI + admin dashboard)
# are baked into the image and served by Fastify at `/` and `/admin/`.

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json tsconfig.base.json turbo.json ./
COPY apps/server/package.json apps/server/
COPY apps/claim-ui/package.json apps/claim-ui/
COPY apps/dashboard/package.json apps/dashboard/
COPY packages/core/package.json packages/core/
COPY packages/driver-nimiq-rpc/package.json packages/driver-nimiq-rpc/
COPY packages/driver-nimiq-wasm/package.json packages/driver-nimiq-wasm/
COPY packages/abuse-hashcash/package.json packages/abuse-hashcash/
COPY packages/abuse-hcaptcha/package.json packages/abuse-hcaptcha/
COPY packages/abuse-geoip/package.json packages/abuse-geoip/
COPY packages/abuse-fingerprint/package.json packages/abuse-fingerprint/
COPY packages/abuse-onchain-nimiq/package.json packages/abuse-onchain-nimiq/
COPY packages/abuse-ai/package.json packages/abuse-ai/
COPY packages/sdk-ts/package.json packages/sdk-ts/
COPY packages/sdk-react/package.json packages/sdk-react/
COPY packages/sdk-vue/package.json packages/sdk-vue/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile=false

FROM deps AS build
COPY packages packages
COPY apps/server apps/server
COPY apps/claim-ui apps/claim-ui
COPY apps/dashboard apps/dashboard
RUN pnpm turbo run build --filter=@faucet/server --filter=@nimiq-faucet/claim-ui --filter=@nimiq-faucet/dashboard

FROM base AS runtime
ENV NODE_ENV=production
ENV FAUCET_DATA_DIR=/data
RUN mkdir -p /data && chown -R node:node /data
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/packages /app/packages
COPY --from=build /app/apps/server /app/apps/server
COPY --from=build /app/apps/claim-ui/dist /app/apps/claim-ui/dist
COPY --from=build /app/apps/dashboard/dist /app/apps/dashboard/dist
COPY --from=build /app/package.json /app/package.json
USER node
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/server/dist/index.js"]
