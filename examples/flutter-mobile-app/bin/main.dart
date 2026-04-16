import 'dart:io';
import 'package:nimiq_faucet/nimiq_faucet.dart';

Future<void> main(List<String> args) async {
  final url = Platform.environment['FAUCET_URL'] ?? 'http://localhost:8080';
  final address = args.isNotEmpty
      ? args.first
      : Platform.environment['CLAIM_ADDRESS'] ??
          'NQ00 0000 0000 0000 0000 0000 0000 0000 0000';

  print('Faucet URL: $url');
  print('Address:    $address');
  print('');

  final client = FaucetClient(url: url);
  try {
    // Fetch config
    final cfg = await client.config();
    print('Network: ${cfg.network}');
    print('Claim amount: ${cfg.claimAmountLuna} luna');
    print('');

    // Submit claim
    print('Submitting claim...');
    final resp = await client.claim(
      address,
      const ClaimOptions(hostContext: HostContext(uid: 'dart-cli-example')),
    );
    print('Claim ID: ${resp.id}');
    print('Status:   ${resp.status}');
    if (resp.txId != null) print('TX:       ${resp.txId}');
    print('');

    // Wait for confirmation
    if (resp.status == 'queued' || resp.status == 'broadcast') {
      print('Waiting for confirmation...');
      final confirmed = await client.waitForConfirmation(resp.id);
      print('Final status: ${confirmed.status}');
      if (confirmed.txId != null) print('TX: ${confirmed.txId}');
    }

    print('');
    print('Done.');
  } on FaucetException catch (e) {
    print('Faucet error: ${e.message} (status=${e.status}, code=${e.code})');
    exit(1);
  } finally {
    client.close();
  }
}
