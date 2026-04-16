import 'dart:convert';
import 'dart:math';
import 'package:crypto/crypto.dart';

/// Brute-force a nonce such that SHA-256(`$challenge:$nonce`) has at least
/// `difficulty` leading zero bits. Matches `solveHashcash` in the TS SDK and
/// `solveChallenge` in `@faucet/abuse-hashcash`.
///
/// `onProgress` is invoked every ~2048 attempts so UIs can show progress.
String solveHashcash(
  String challenge,
  int difficulty, {
  void Function(int attempts)? onProgress,
}) {
  final rng = Random();
  var attempts = 0;
  while (true) {
    final nonce =
        '${attempts.toRadixString(36)}.${rng.nextInt(1 << 32).toRadixString(36)}';
    final digest = sha256.convert(utf8.encode('$challenge:$nonce')).bytes;
    if (_leadingZeroBits(digest) >= difficulty) return nonce;
    attempts++;
    if (onProgress != null && attempts % 2048 == 0) onProgress(attempts);
  }
}

int _leadingZeroBits(List<int> bytes) {
  var bits = 0;
  for (final b in bytes) {
    if (b == 0) {
      bits += 8;
      continue;
    }
    for (var mask = 0x80; mask > 0; mask >>= 1) {
      if ((b & mask) != 0) return bits;
      bits++;
    }
    return bits;
  }
  return bits;
}
