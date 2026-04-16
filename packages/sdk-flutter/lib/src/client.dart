import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:http/http.dart' as http;
// `web_socket_channel` 3.x keeps the canonical import here.
// If upgrading, check the package's CHANGELOG: some minor versions restructure
// this path (see README and `nimiq_faucet.dart`).
import 'package:web_socket_channel/web_socket_channel.dart';

import 'hashcash.dart';
import 'hmac.dart';
import 'types.dart';

/// Faucet HTTP + WebSocket client. Mirrors `@nimiq-faucet/sdk`'s `FaucetClient`:
/// `claim`, `status`, `waitForConfirmation`, `config`, `requestChallenge`,
/// `solveAndClaim`, `subscribe`.
class FaucetClient {
  final String baseUrl;
  final String? apiKey;
  final String? hmacSecret;
  final http.Client _http;
  final bool _ownsHttp;

  FaucetClient({
    required String url,
    this.apiKey,
    this.hmacSecret,
    http.Client? httpClient,
  })  : baseUrl = _stripTrailingSlashes(url),
        _http = httpClient ?? http.Client(),
        _ownsHttp = httpClient == null;

  static String _stripTrailingSlashes(String url) {
    var end = url.length;
    while (end > 0 && url.codeUnitAt(end - 1) == 0x2f) {
      end--;
    }
    return url.substring(0, end);
  }

  /// Release the underlying HTTP client if we own it. Safe to skip.
  void close() {
    if (_ownsHttp) _http.close();
  }

  Future<FaucetConfig> config() async {
    final res = await _get('/v1/config');
    return FaucetConfig.fromJson(res as Map<String, dynamic>);
  }

  Future<ClaimResponse> claim(String address, [ClaimOptions? options]) async {
    final opts = options ?? const ClaimOptions();
    final body = <String, dynamic>{'address': address};
    if (opts.captchaToken != null) body['captchaToken'] = opts.captchaToken;
    if (opts.hashcashSolution != null) body['hashcashSolution'] = opts.hashcashSolution;
    if (opts.fingerprint != null) body['fingerprint'] = opts.fingerprint!.toJson();
    if (opts.hostContext != null) body['hostContext'] = opts.hostContext!.toJson();
    final res = await _post('/v1/claim', body);
    return ClaimResponse.fromJson(res as Map<String, dynamic>);
  }

  Future<ClaimResponse> status(String id) async {
    final res = await _get('/v1/claim/${Uri.encodeComponent(id)}');
    return ClaimResponse.fromJson(res as Map<String, dynamic>);
  }

  /// Request a signed hashcash challenge (POST /v1/challenge).
  Future<HashcashChallenge> requestChallenge({String? uid}) async {
    final body = uid != null ? {'uid': uid} : <String, dynamic>{};
    final res = await _post('/v1/challenge', body);
    return HashcashChallenge.fromJson(res as Map<String, dynamic>);
  }

  /// Request a challenge, brute-force a solution, submit the claim.
  Future<ClaimResponse> solveAndClaim(String address, [ClaimOptions? options]) async {
    final opts = options ?? const ClaimOptions();
    final uid = opts.uid ?? opts.hostContext?.uid;
    final challenge = await requestChallenge(uid: uid);
    final nonce = solveHashcash(
      challenge.challenge,
      challenge.difficulty,
      onProgress: opts.onProgress,
    );
    return claim(address, opts.copyWith(hashcashSolution: '${challenge.challenge}#$nonce'));
  }

  /// Poll until status is `confirmed` or `rejected`. Throws `FaucetException`
  /// with status 408 if `timeout` elapses first.
  Future<ClaimResponse> waitForConfirmation(
    String id, {
    Duration timeout = const Duration(seconds: 60),
  }) async {
    final deadline = DateTime.now().add(timeout);
    while (DateTime.now().isBefore(deadline)) {
      final s = await status(id);
      if (s.status == 'confirmed' || s.status == 'rejected') return s;
      await Future<void>.delayed(const Duration(seconds: 2));
    }
    throw FaucetException(
      'Claim $id not confirmed in ${timeout.inMilliseconds}ms',
      status: 408,
    );
  }

  /// Open a WebSocket stream of faucet events. Returns a function that, when
  /// called, closes the socket. `onEvent` receives already-decoded JSON.
  void Function() subscribe(void Function(dynamic event) onEvent) {
    final wsUrl = _toWsUrl('$baseUrl/v1/stream');
    final channel = WebSocketChannel.connect(Uri.parse(wsUrl));
    final sub = channel.stream.listen((dynamic frame) {
      try {
        final parsed = frame is String ? jsonDecode(frame) : frame;
        onEvent(parsed);
      } catch (_) {
        // ignore malformed frames
      }
    });
    return () {
      sub.cancel();
      channel.sink.close();
    };
  }

  // --- internal transport ----------------------------------------------

  Uri _uri(String path) => Uri.parse('$baseUrl$path');

  Future<dynamic> _get(String path) async {
    final res = await _http.get(_uri(path));
    return _handle(res);
  }

  Future<dynamic> _post(String path, Map<String, dynamic> body) async {
    final bodyText = jsonEncode(body);
    final headers = <String, String>{'content-type': 'application/json'};
    if (apiKey != null && hmacSecret != null) {
      final ts = DateTime.now().millisecondsSinceEpoch.toString();
      final nonce = _randomNonce();
      final sig = signHmac(hmacSecret!, canonicalString('POST', path, ts, nonce, bodyText));
      headers['x-faucet-api-key'] = apiKey!;
      headers['x-faucet-timestamp'] = ts;
      headers['x-faucet-nonce'] = nonce;
      headers['x-faucet-signature'] = sig;
    }
    final res = await _http.post(_uri(path), headers: headers, body: bodyText);
    return _handle(res);
  }

  dynamic _handle(http.Response res) {
    final text = res.body;
    dynamic parsed;
    if (text.isNotEmpty) {
      try {
        parsed = jsonDecode(text);
      } catch (_) {
        parsed = text;
      }
    }
    if (res.statusCode >= 400) {
      var message = 'HTTP ${res.statusCode}';
      String? code;
      String? decision;
      if (parsed is Map<String, dynamic>) {
        final err = parsed['error'];
        if (err is String) message = err;
        final c = parsed['code'];
        if (c is String) code = c;
        final d = parsed['decision'];
        if (d is String) decision = d;
      }
      throw FaucetException(message, status: res.statusCode, code: code, decision: decision);
    }
    return parsed;
  }

  static String _randomNonce() {
    final rng = Random.secure();
    final bytes = List<int>.generate(16, (_) => rng.nextInt(256));
    final sb = StringBuffer();
    for (final b in bytes) {
      sb.write(b.toRadixString(16).padLeft(2, '0'));
    }
    return sb.toString();
  }

  static String _toWsUrl(String httpUrl) {
    if (httpUrl.startsWith('https://')) return 'wss://${httpUrl.substring(8)}';
    if (httpUrl.startsWith('http://')) return 'ws://${httpUrl.substring(7)}';
    return httpUrl;
  }
}
