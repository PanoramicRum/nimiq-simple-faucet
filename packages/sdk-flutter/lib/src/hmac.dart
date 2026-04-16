import 'dart:convert';
import 'package:crypto/crypto.dart';

/// Canonical string to HMAC-sign, matching apps/server/src/hmac.ts:
///   "<METHOD>\n<path>\n<timestamp>\n<nonce>\n<body>"
String canonicalString(
  String method,
  String path,
  String timestamp,
  String nonce,
  String body,
) {
  return [method.toUpperCase(), path, timestamp, nonce, body].join('\n');
}

/// Lower-case hex HMAC-SHA256.
String signHmac(String secret, String data) {
  final mac = Hmac(sha256, utf8.encode(secret));
  return mac.convert(utf8.encode(data)).toString();
}
