import 'auth_api.dart';

final _api = AuthApi();

Future<Map<String, dynamic>> bookingRequest(
  String path, {
  String method = 'GET',
  Map<String, Object?>? data,
  String? idempotencyKey,
}) => _api.request(
  path,
  prefix: '',
  method: method,
  authenticated: true,
  data: data,
  idempotencyKey: idempotencyKey,
);

int? parseFareKobo(String raw) {
  final match = RegExp(r'^(\d{1,8})(?:\.(\d{1,2}))?$').firstMatch(raw.trim());
  if (match == null) return null;
  final whole = int.parse(match[1]!);
  final fraction = int.parse((match[2] ?? '').padRight(2, '0'));
  final kobo = whole * 100 + fraction;
  return kobo > 0 && kobo <= 2147483647 ? kobo : null;
}

String displayFare(int kobo) => displayNaira(BigInt.from(kobo));

/// Whole naira shows no kobo: ₦1,500 and ₦150.05.
String displayNaira(BigInt kobo) {
  final hundred = BigInt.from(100);
  final whole = (kobo ~/ hundred).toString().replaceAllMapped(
    RegExp(r'\B(?=(\d{3})+$)'),
    (_) => ',',
  );
  final fraction = (kobo % hundred).toInt();
  return fraction == 0
      ? '₦$whole'
      : '₦$whole.${fraction.toString().padLeft(2, '0')}';
}
