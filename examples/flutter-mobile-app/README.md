# Flutter / Dart SDK Demo

CLI app demonstrating the `nimiq_faucet` Dart SDK. Runs as a compiled binary in Docker.

## What this demonstrates

- `FaucetClient` instantiation
- `config()` to fetch faucet configuration
- `claim()` submission with `HostContext`
- `waitForConfirmation()` polling
- Error handling via `FaucetException`

## Run locally

```bash
cd examples/flutter-mobile-app
dart pub get
FAUCET_URL=http://localhost:8080 dart run bin/main.dart "NQ00 0000 0000 0000 0000 0000 0000 0000 0000"
```

## Run with Docker

```bash
# From repo root — starts faucet + runs this demo
docker compose -f deploy/compose/docker-compose.yml -f examples/docker-compose.yml up --build example-flutter
# The container runs the claim and exits. Check logs:
docker compose -f deploy/compose/docker-compose.yml -f examples/docker-compose.yml logs example-flutter
```

## For a real Flutter mobile app

This example is a Dart CLI to prove the SDK works in Docker. For a real Flutter mobile app:

1. `flutter create my_app && cd my_app`
2. Add `nimiq_faucet` to `pubspec.yaml`
3. Use `FaucetClient` in your widgets (see `packages/sdk-flutter/example/main.dart`)
