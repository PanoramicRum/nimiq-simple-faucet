# Build FCaptcha (server-node) from upstream.
#
# Issue #117: the previous fcaptcha.yml referenced
# `ghcr.io/webdecoy/fcaptcha:latest`, which is not publicly pullable —
# `docker pull` returns "unauthorized". The image simply doesn't exist
# in any public registry, so following the documented compose Quick
# Start silently failed.
#
# Solution: build from upstream source, pinned to a specific tagged
# release (v1.7.0 → commit 85ea4127). Re-pin by bumping FCAPTCHA_REF
# to a different tag or commit; `docker compose build --no-cache fcaptcha`
# re-clones cleanly.
#
# Also patches the server to expose `/fcaptcha.js` (the widget bundle the
# browser needs). Upstream `server-node/server.js` only registers verify
# / score / challenge endpoints; it doesn't serve the client bundle in
# `client/`. Until that's fixed upstream, the operator's deployment has
# to host the widget alongside the verify API. Two-line `sed` patch keeps
# us close to the upstream source — no fork to maintain.

FROM node:20-alpine AS build
ARG FCAPTCHA_REF=v1.7.0
WORKDIR /src
RUN apk add --no-cache git
RUN git clone --depth 1 --branch "${FCAPTCHA_REF}" \
    https://github.com/WebDecoy/FCaptcha.git .
WORKDIR /src/server-node
RUN npm ci --omit=dev || npm install --omit=dev

FROM node:20-alpine
WORKDIR /app
COPY --from=build /src/server-node /app
# `/app/client/fcaptcha.js` is the widget bundle the browser fetches as
# <FAUCET_FCAPTCHA_PUBLIC_URL>/fcaptcha.js. Until upstream serves it,
# we add a static-file route via a one-line sed patch.
COPY --from=build /src/client /app/client
RUN sed -i \
    "s|app.use(express.json());|app.use(express.json());\\napp.use('/fcaptcha.js', express.static('/app/client/fcaptcha.js'));|" \
    server.js
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
