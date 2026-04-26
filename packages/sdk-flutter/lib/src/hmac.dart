import 'dart:convert';
import 'package:crypto/crypto.dart';

import 'types.dart';

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

/// Fields included in the hostContext signature, in the exact order the
/// server canonicalizes them. Must mirror `CANONICAL_FIELDS` in
/// packages/core/src/hostContext.ts.
const _canonicalHostContextFields = <String>[
  'uid',
  'cookieHash',
  'sessionHash',
  'accountAgeDays',
  'emailDomainHash',
  'kycLevel',
  'tags',
  'verifiedIdentities',
];

/// Canonical JSON for HMAC-signing a [HostContext]. Mirrors
/// `canonicalizeHostContext` in packages/core/src/hostContext.ts: a JSON
/// array of `[key, value]` pairs in [_canonicalHostContextFields] order,
/// with array values lexicographically sorted.
String _canonicalizeHostContext(HostContext ctx) {
  final values = <String, dynamic>{};
  if (ctx.uid != null) values['uid'] = ctx.uid;
  if (ctx.cookieHash != null) values['cookieHash'] = ctx.cookieHash;
  if (ctx.sessionHash != null) values['sessionHash'] = ctx.sessionHash;
  if (ctx.accountAgeDays != null) values['accountAgeDays'] = ctx.accountAgeDays;
  if (ctx.emailDomainHash != null) {
    values['emailDomainHash'] = ctx.emailDomainHash;
  }
  if (ctx.kycLevel != null) values['kycLevel'] = ctx.kycLevel;
  if (ctx.tags != null && ctx.tags!.isNotEmpty) {
    final sorted = List<String>.from(ctx.tags!)..sort();
    values['tags'] = sorted;
  }
  // verifiedIdentities not yet on the Dart HostContext; the canonical
  // order below already accounts for it so once added it lines up.
  final entries = <List<dynamic>>[];
  for (final k in _canonicalHostContextFields) {
    final v = values[k];
    if (v == null) continue;
    entries.add([k, v]);
  }
  return jsonEncode(entries);
}

/// Sign a [HostContext] with an integrator HMAC secret and return a copy
/// whose `signature` is set to `<integratorId>:<base64-hmac>`. Mirrors
/// `FaucetClient.signHostContext` in packages/sdk-ts/src/index.ts and
/// `SignHostContext` in packages/sdk-go/hmac.go (closes audit
/// Improvement #104).
///
/// Run this on your BACKEND — never expose [hmacSecret] to the device.
/// Pass the signed context through to the on-device SDK's claim() call.
HostContext signHostContext(
  HostContext ctx,
  String integratorId,
  String hmacSecret,
) {
  final canonical = _canonicalizeHostContext(ctx);
  final mac = Hmac(sha256, utf8.encode(hmacSecret));
  final digest = mac.convert(utf8.encode(canonical));
  final sig = '$integratorId:${base64.encode(digest.bytes)}';
  return HostContext(
    uid: ctx.uid,
    cookieHash: ctx.cookieHash,
    sessionHash: ctx.sessionHash,
    accountAgeDays: ctx.accountAgeDays,
    emailDomainHash: ctx.emailDomainHash,
    kycLevel: ctx.kycLevel,
    tags: ctx.tags,
    signature: sig,
  );
}
