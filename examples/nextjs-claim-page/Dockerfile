## syntax=docker/dockerfile:1.7
# Next.js claim page example — multi-stage build.
# Build context must be the repo root.

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages/sdk-ts/package.json packages/sdk-ts/
COPY packages/sdk-react/package.json packages/sdk-react/
COPY examples/nextjs-claim-page/package.json examples/nextjs-claim-page/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile=false

FROM deps AS build
COPY packages/sdk-ts packages/sdk-ts
COPY packages/sdk-react packages/sdk-react
COPY examples/nextjs-claim-page examples/nextjs-claim-page
ARG NEXT_PUBLIC_FAUCET_URL=http://localhost:8080
ENV NEXT_PUBLIC_FAUCET_URL=${NEXT_PUBLIC_FAUCET_URL}
RUN pnpm turbo run build --filter=@nimiq-faucet/example-nextjs

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/examples/nextjs-claim-page/.next/standalone ./
COPY --from=build /app/examples/nextjs-claim-page/.next/static ./examples/nextjs-claim-page/.next/static
COPY --from=build /app/examples/nextjs-claim-page/public ./examples/nextjs-claim-page/public
EXPOSE 3000
CMD ["node", "examples/nextjs-claim-page/server.js"]
