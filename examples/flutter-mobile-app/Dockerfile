## syntax=docker/dockerfile:1.7
# Dart CLI demo of the nimiq_faucet SDK.
# Build context must be the repo root.

FROM dart:stable AS build
WORKDIR /app
COPY packages/sdk-flutter packages/sdk-flutter
COPY examples/flutter-mobile-app examples/flutter-mobile-app
WORKDIR /app/examples/flutter-mobile-app
RUN dart pub get
RUN dart compile exe bin/main.dart -o /app/faucet-demo

FROM alpine:3.19 AS runtime
RUN apk add --no-cache gcompat
COPY --from=build /app/faucet-demo /usr/local/bin/faucet-demo
ENTRYPOINT ["faucet-demo"]
