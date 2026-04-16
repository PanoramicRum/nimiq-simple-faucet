# nimiq_faucet

Dart/Flutter client for the Nimiq Simple Faucet. Mirrors `@nimiq-faucet/sdk`.

## Install

`pubspec.yaml`:

```yaml
dependencies:
  nimiq_faucet: ^0.0.1
```

Then `flutter pub get` (or `dart pub get`).

## Usage

```dart
import 'package:nimiq_faucet/nimiq_faucet.dart';

final client = FaucetClient(url: 'https://faucet.example.com');
final resp = await client.claim(
  address,
  const ClaimOptions(hostContext: HostContext(uid: 'user-hash')),
);
final result = await client.waitForConfirmation(resp.id);
```

### Server-to-server HMAC

```dart
final client = FaucetClient(url: url, apiKey: 'ak_...', hmacSecret: 'sk_...');
```

### Hashcash

```dart
final resp = await client.solveAndClaim(address);
```

### WebSocket events

```dart
final unsubscribe = client.subscribe((event) => print(event));
// later:
unsubscribe();
```

API: `claim`, `status`, `waitForConfirmation`, `config`, `requestChallenge`, `solveAndClaim`, `subscribe`, plus package-level `solveHashcash`, `signHmac`, `canonicalString`. Throws `FaucetException` on non-2xx.
