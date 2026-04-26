## syntax=docker/dockerfile:1.7
# Next.js claim page example — multi-stage build.
#
# Build context = repo root, e.g.
#   docker buildx build -f examples/nextjs-claim-page/Dockerfile -t nextjs-claim:test .
#
# Issue #116: see the matching note in examples/vue-claim-page/Dockerfile —
# the deps-only-cache pattern was broken because the root package.json
# devDependency on @faucet/abuse-hashcash makes pnpm require every
# workspace package.json at install time. Copy the full workspace and
# filter at install time instead.

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY . .
ARG NEXT_PUBLIC_FAUCET_URL=http://localhost:8080
ENV NEXT_PUBLIC_FAUCET_URL=${NEXT_PUBLIC_FAUCET_URL}
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @nimiq-faucet/example-nextjs...
RUN pnpm turbo run build --filter=@nimiq-faucet/example-nextjs

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/examples/nextjs-claim-page/.next/standalone ./
COPY --from=build /app/examples/nextjs-claim-page/.next/static ./examples/nextjs-claim-page/.next/static
# This example has no `public/` dir today. If you add one (e.g. for
# favicons), add `COPY --from=build /app/examples/nextjs-claim-page/public
# ./examples/nextjs-claim-page/public` back in.
EXPOSE 3000
CMD ["node", "examples/nextjs-claim-page/server.js"]
