# Flutter

The `nimiq_faucet` pub package mirrors the TypeScript SDK surface and runs on
Android, iOS, web, macOS, and Windows.

## Install

```bash
flutter pub add nimiq_faucet
```

## Add a claim button

```dart
import 'package:flutter/material.dart';
import 'package:nimiq_faucet/nimiq_faucet.dart';

class ClaimButton extends StatefulWidget {
  const ClaimButton({super.key, required this.address});

  final String address;

  @override
  State<ClaimButton> createState() => _ClaimButtonState();
}

class _ClaimButtonState extends State<ClaimButton> {
  final _client = FaucetClient(url: const String.fromEnvironment('FAUCET_URL'));
  String _status = 'idle';

  Future<void> _claim() async {
    setState(() => _status = 'pending');
    try {
      final claim = await _client.claim(
        widget.address,
        hostContext: const HostContext(kycLevel: KycLevel.none),
      );
      final result = await _client.waitForConfirmation(claim.id);
      setState(() => _status = result.status.name);
    } catch (e) {
      setState(() => _status = 'error: $e');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        ElevatedButton(
          onPressed: _status == 'pending' ? null : _claim,
          child: Text(_status == 'pending' ? 'Claiming...' : 'Claim free NIM'),
        ),
        Text('Status: $_status'),
      ],
    );
  }
}
```

The client reads `device_info_plus` when available and populates
`deviceIdHash`, `platform`, and `osVersion` automatically.

## Live snippet URL

| Version | URL | Notes |
| --- | --- | --- |
| `latest` | `/snippets/flutter` | TODO: generated at release (M9). |
