// Nimiq Faucet Dart CLI demo with full abuse-layer support:
// HMAC-signed hostContext + automatic hashcash via solveAndClaim.
//
// Usage:
//   dart run bin/main.dart [<address>]
//
// Env vars:
//   FAUCET_URL              — faucet base URL (default http://localhost:8080)
//   FAUCET_INTEGRATOR_ID    — integrator identifier (default 'dart-cli-example')
//   FAUCET_HMAC_SECRET      — server-only HMAC secret. With this set, the
//                             demo signs hostContext so the faucet treats
//                             asserted user-state fields as load-bearing.
//                             Without it the claim still works but the
//                             asserted fields don't carry weight.
//   CLAIM_ADDRESS           — claim recipient (also positional arg)
//   CLAIM_USER_ID           — uid for hostContext.uid (default INTEGRATOR_ID)
//   CLAIM_KYC_LEVEL         — 'none' | 'email' | 'phone' | 'id'
//   CLAIM_ACCOUNT_AGE_DAYS  — integer

import 'dart:io';
import 'package:nimiq_faucet/nimiq_faucet.dart';

Future<void> main(List<String> args) async {
  final url = Platform.environment['FAUCET_URL'] ?? 'http://localhost:8080';
  final integratorId = Platform.environment['FAUCET_INTEGRATOR_ID'] ?? 'dart-cli-example';
  final hmacSecret = Platform.environment['FAUCET_HMAC_SECRET'];
  final userId = Platform.environment['CLAIM_USER_ID'] ?? integratorId;
  final kycLevel = Platform.environment['CLAIM_KYC_LEVEL'];
  final accountAgeDays = int.tryParse(Platform.environment['CLAIM_ACCOUNT_AGE_DAYS'] ?? '');
  final address = args.isNotEmpty
      ? args.first
      : Platform.environment['CLAIM_ADDRESS'] ?? 'NQ00 0000 0000 0000 0000 0000 0000 0000 0000';

  print('Faucet URL:    $url');
  print('Address:       $address');
  print('Integrator:    $integratorId');
  print('Signed ctx:    ${hmacSecret != null}');
  print('');

  final client = FaucetClient(url: url);
  try {
    final cfg = await client.config();
    print('Network:       ${cfg.network}');
    print('Claim amount:  ${cfg.claimAmountLuna} luna');
    print('Captcha:       ${cfg.captcha?.provider ?? 'disabled'}');
    print('Hashcash:      ${cfg.hashcash != null ? '${cfg.hashcash!.difficulty} bits' : 'disabled'}');
    print('');

    // Build a hostContext from the values you (the integrator) attest to.
    var hc = HostContext(
      uid: userId,
      kycLevel: kycLevel,
      accountAgeDays: accountAgeDays,
    );
    // Sign hostContext if a secret is configured. Without a signature
    // the faucet IGNORES the asserted fields (claim still works, but
    // falls back to default abuse scoring on the unsigned-context path).
    if (hmacSecret != null) {
      hc = signHostContext(hc, integratorId, hmacSecret);
    }

    // solveAndClaim auto-handles the hashcash round-trip when the
    // server requires it; it's a plain claim() otherwise.
    print('Submitting claim...');
    final resp = await client.solveAndClaim(
      address,
      ClaimOptions(hostContext: hc),
    );
    print('Claim ID:      ${resp.id}');
    print('Status:        ${resp.status}');
    if (resp.txId != null) print('TX:            ${resp.txId}');
    print('');

    if (resp.status == 'queued' || resp.status == 'broadcast') {
      print('Waiting for confirmation...');
      final confirmed = await client.waitForConfirmation(resp.id);
      print('Final status:  ${confirmed.status}');
      if (confirmed.txId != null) print('TX:            ${confirmed.txId}');
      if (confirmed.status == 'rejected' && confirmed.reason != null) {
        print('Reason:        ${confirmed.reason}');
      }
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
