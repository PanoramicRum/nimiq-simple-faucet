import 'package:nimiq_faucet/nimiq_faucet.dart';

Future<void> main() async {
  final client = FaucetClient(url: 'http://localhost:3000');
  try {
    final cfg = await client.config();
    // ignore: avoid_print
    print('network=${cfg.network} amount=${cfg.claimAmountLuna}');

    final resp = await client.claim(
      'NQ00 0000 0000 0000 0000 0000 0000 0000 0000',
      const ClaimOptions(hostContext: HostContext(uid: 'demo-user')),
    );
    // ignore: avoid_print
    print('claim id=${resp.id} status=${resp.status} tx=${resp.txId}');

    final confirmed = await client.waitForConfirmation(resp.id);
    // ignore: avoid_print
    print('final status=${confirmed.status}');
  } finally {
    client.close();
  }
}
