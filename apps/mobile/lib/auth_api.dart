import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

import 'preview_api.dart';

class AuthException implements Exception {
  const AuthException(this.message, [this.status]);

  final String message;
  final int? status;
}

class AuthApi {
  static const _storage = FlutterSecureStorage(
    iOptions: IOSOptions(
      accessibility: KeychainAccessibility.unlocked_this_device,
    ),
  );
  static const _tokenKey = 'fast_logistics_session';

  Future<String?> get token async =>
      previewMode ? previewSession : _storage.read(key: _tokenKey);

  Future<void> saveToken(String value) async {
    if (previewMode) {
      previewSession = value;
      return;
    }
    await _storage.write(key: _tokenKey, value: value);
  }

  Future<void> clearToken() async {
    if (previewMode) {
      previewSession = null;
      return;
    }
    await _storage.delete(key: _tokenKey);
  }

  Uri apiOrigin() {
    const configured = String.fromEnvironment('AUTH_API_URL');
    final local = defaultTargetPlatform == TargetPlatform.android
        ? 'http://10.0.2.2:8080'
        : 'http://127.0.0.1:8080';
    final base = configured.isEmpty && kDebugMode ? local : configured;
    final uri = Uri.tryParse(base);
    if (uri == null ||
        uri.host.isEmpty ||
        uri.userInfo.isNotEmpty ||
        (uri.scheme != 'https' &&
            !(kDebugMode &&
                uri.scheme == 'http' &&
                ['127.0.0.1', '10.0.2.2', 'localhost'].contains(uri.host)))) {
      throw const AuthException('Configure a secure authentication API URL.');
    }

    return uri;
  }

  Future<Map<String, dynamic>> request(
    String path, {
    String method = 'POST',
    Map<String, Object?>? data,
    String prefix = '/auth',
    String? idempotencyKey,
    bool authenticated = false,
  }) async {
    if (previewMode) return previewRequest('$prefix$path', method, data);
    final uri = apiOrigin();
    final endpoint = Uri.parse(path);
    final session = authenticated ? await token : null;
    if (authenticated && session == null) {
      throw const AuthException('Sign in required.', 401);
    }
    final client = http.Client();
    try {
      final request = http.Request(
        method,
        uri.replace(path: '$prefix${endpoint.path}', query: endpoint.query),
      )..followRedirects = false;
      if (idempotencyKey != null) {
        request.headers['Idempotency-Key'] = idempotencyKey;
      }
      if (session != null) request.headers['Authorization'] = 'Bearer $session';
      if (data != null) {
        request.headers['Content-Type'] = 'application/json';
        request.body = jsonEncode(data);
      }
      final response = await client
          .send(request)
          .then(http.Response.fromStream)
          .timeout(const Duration(seconds: 10));
      final body = jsonDecode(response.body) as Map<String, dynamic>;
      if (response.statusCode >= 300) {
        throw AuthException(
          body['error'] as String? ?? 'Request failed.',
          response.statusCode,
        );
      }
      return body;
    } on AuthException {
      rethrow;
    } catch (_) {
      throw const AuthException('Could not reach the authentication service.');
    } finally {
      client.close();
    }
  }
}
