import 'dart:convert';
import 'package:crypto/crypto.dart';
import 'package:nimiq_faucet/nimiq_faucet.dart';
import 'package:test/test.dart';

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

void main() {
  group('hashcash', () {
    test('solves a low-difficulty challenge', () {
      final nonce = solveHashcash('hello', 4);
      expect(nonce, isNotEmpty);
      final digest = sha256.convert(utf8.encode('hello:$nonce')).bytes;
      expect(_leadingZeroBits(digest), greaterThanOrEqualTo(4));
    });

    test('different challenges yield different nonces', () {
      final a = solveHashcash('a', 4);
      final b = solveHashcash('b', 4);
      // Two independent solutions under difficulty 4: effectively never equal.
      expect(a == b, isFalse);
    });
  });

  group('hmac', () {
    test('canonicalString matches the server format exactly', () {
      final got =
          canonicalString('post', '/v1/claim', '1700000000000', 'abc', '{"address":"x"}');
      expect(got, 'POST\n/v1/claim\n1700000000000\nabc\n{"address":"x"}');
    });

    test('signHmac is deterministic and 64 hex chars', () {
      final a = signHmac('secret', 'payload');
      final b = signHmac('secret', 'payload');
      expect(a, b);
      expect(a.length, 64);
      expect(RegExp(r'^[0-9a-f]+$').hasMatch(a), isTrue);
    });

    test('signHmac matches a known vector', () {
      // Cross-checked with `openssl dgst -sha256 -hmac secret`.
      final got = signHmac('secret', 'data');
      expect(got, '1b2c16b75bd2a870c114153ccda5bcfca63314bc722fa160d690de133ccbb9db');
    });
  });

  group('FaucetException', () {
    test('toString includes status, code, and decision when present', () {
      const err = FaucetException('denied', status: 403, code: 'abuse', decision: 'deny');
      final s = err.toString();
      expect(s, contains('403'));
      expect(s, contains('denied'));
      expect(s, contains('abuse'));
      expect(s, contains('deny'));
    });
  });
}
