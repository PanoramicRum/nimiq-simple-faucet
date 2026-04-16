/// Wire types for the Nimiq Simple Faucet. Field names mirror the TS SDK
/// one-for-one so JSON round-trips cleanly.

/// Integrator-provided context about the end user. All fields optional.
class HostContext {
  final String? uid;
  final String? cookieHash;
  final String? sessionHash;
  final num? accountAgeDays;
  final String? emailDomainHash;
  /// One of: 'none' | 'email' | 'phone' | 'id'.
  final String? kycLevel;
  final List<String>? tags;
  final String? signature;

  const HostContext({
    this.uid,
    this.cookieHash,
    this.sessionHash,
    this.accountAgeDays,
    this.emailDomainHash,
    this.kycLevel,
    this.tags,
    this.signature,
  });

  Map<String, dynamic> toJson() {
    final map = <String, dynamic>{};
    if (uid != null) map['uid'] = uid;
    if (cookieHash != null) map['cookieHash'] = cookieHash;
    if (sessionHash != null) map['sessionHash'] = sessionHash;
    if (accountAgeDays != null) map['accountAgeDays'] = accountAgeDays;
    if (emailDomainHash != null) map['emailDomainHash'] = emailDomainHash;
    if (kycLevel != null) map['kycLevel'] = kycLevel;
    if (tags != null) map['tags'] = tags;
    if (signature != null) map['signature'] = signature;
    return map;
  }
}

class FingerprintBundle {
  final String? visitorId;
  final double? confidence;
  final Map<String, dynamic>? components;

  const FingerprintBundle({this.visitorId, this.confidence, this.components});

  Map<String, dynamic> toJson() {
    final map = <String, dynamic>{};
    if (visitorId != null) map['visitorId'] = visitorId;
    if (confidence != null) map['confidence'] = confidence;
    if (components != null) map['components'] = components;
    return map;
  }
}

class ClaimOptions {
  final HostContext? hostContext;
  final FingerprintBundle? fingerprint;
  final String? captchaToken;
  final String? hashcashSolution;
  final String? uid;
  final void Function(int attempts)? onProgress;

  const ClaimOptions({
    this.hostContext,
    this.fingerprint,
    this.captchaToken,
    this.hashcashSolution,
    this.uid,
    this.onProgress,
  });

  ClaimOptions copyWith({
    HostContext? hostContext,
    FingerprintBundle? fingerprint,
    String? captchaToken,
    String? hashcashSolution,
    String? uid,
    void Function(int)? onProgress,
  }) {
    return ClaimOptions(
      hostContext: hostContext ?? this.hostContext,
      fingerprint: fingerprint ?? this.fingerprint,
      captchaToken: captchaToken ?? this.captchaToken,
      hashcashSolution: hashcashSolution ?? this.hashcashSolution,
      uid: uid ?? this.uid,
      onProgress: onProgress ?? this.onProgress,
    );
  }
}

class ClaimResponse {
  final String id;
  /// One of: 'queued' | 'broadcast' | 'confirmed' | 'rejected' | 'challenged'.
  final String status;
  final String? txId;
  /// One of: 'allow' | 'challenge' | 'review' | 'deny'.
  final String? decision;
  final String? reason;

  const ClaimResponse({
    required this.id,
    required this.status,
    this.txId,
    this.decision,
    this.reason,
  });

  factory ClaimResponse.fromJson(Map<String, dynamic> json) => ClaimResponse(
        id: json['id'] as String,
        status: json['status'] as String,
        txId: json['txId'] as String?,
        decision: json['decision'] as String?,
        reason: json['reason'] as String?,
      );
}

class HashcashChallenge {
  final String challenge;
  final int difficulty;
  final int expiresAt;

  const HashcashChallenge({
    required this.challenge,
    required this.difficulty,
    required this.expiresAt,
  });

  factory HashcashChallenge.fromJson(Map<String, dynamic> json) =>
      HashcashChallenge(
        challenge: json['challenge'] as String,
        difficulty: (json['difficulty'] as num).toInt(),
        expiresAt: (json['expiresAt'] as num).toInt(),
      );
}

class FaucetConfig {
  final String network; // 'main' | 'test'
  final String claimAmountLuna;
  final Map<String, bool> abuseLayers;
  final CaptchaConfig? captcha;
  final HashcashConfig? hashcash;

  const FaucetConfig({
    required this.network,
    required this.claimAmountLuna,
    required this.abuseLayers,
    this.captcha,
    this.hashcash,
  });

  factory FaucetConfig.fromJson(Map<String, dynamic> json) {
    final rawLayers = (json['abuseLayers'] as Map?)?.cast<String, dynamic>() ?? const {};
    final layers = <String, bool>{
      for (final e in rawLayers.entries) e.key: e.value == true,
    };
    final captcha = json['captcha'] as Map<String, dynamic>?;
    final hashcash = json['hashcash'] as Map<String, dynamic>?;
    return FaucetConfig(
      network: json['network'] as String,
      claimAmountLuna: json['claimAmountLuna'] as String,
      abuseLayers: layers,
      captcha: captcha == null ? null : CaptchaConfig.fromJson(captcha),
      hashcash: hashcash == null ? null : HashcashConfig.fromJson(hashcash),
    );
  }
}

class CaptchaConfig {
  final String provider; // 'turnstile' | 'hcaptcha'
  final String siteKey;
  const CaptchaConfig({required this.provider, required this.siteKey});

  factory CaptchaConfig.fromJson(Map<String, dynamic> json) => CaptchaConfig(
        provider: json['provider'] as String,
        siteKey: json['siteKey'] as String,
      );
}

class HashcashConfig {
  final int difficulty;
  final int ttlMs;
  const HashcashConfig({required this.difficulty, required this.ttlMs});

  factory HashcashConfig.fromJson(Map<String, dynamic> json) => HashcashConfig(
        difficulty: (json['difficulty'] as num).toInt(),
        ttlMs: (json['ttlMs'] as num).toInt(),
      );
}

/// Thrown for non-2xx server responses.
class FaucetException implements Exception {
  final int status;
  final String message;
  final String? code;
  final String? decision;

  const FaucetException(this.message, {required this.status, this.code, this.decision});

  @override
  String toString() =>
      'FaucetException($status: $message${code != null ? ' code=$code' : ''}${decision != null ? ' decision=$decision' : ''})';
}
