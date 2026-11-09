import 'package:geolocator/geolocator.dart';

import 'auth_api.dart';
import 'preview_api.dart';

Future<void> ensureRiderLocationPermission({
  required bool askPermission,
}) async {
  if (!await Geolocator.isLocationServiceEnabled()) {
    throw const AuthException(
      'Turn on location services to share your position.',
    );
  }
  var permission = await Geolocator.checkPermission();
  if (askPermission && permission == LocationPermission.denied) {
    permission = await Geolocator.requestPermission();
  }
  if (permission != LocationPermission.whileInUse &&
      permission != LocationPermission.always) {
    throw const AuthException(
      'Allow location access in device settings to share your position.',
    );
  }
}

Future<Map<String, double>> riderLocation({required bool askPermission}) async {
  if (previewMode) {
    return {
      'latitude': previewDeviceLocation.latitude,
      'longitude': previewDeviceLocation.longitude,
    };
  }
  await ensureRiderLocationPermission(askPermission: askPermission);
  final position = await Geolocator.getCurrentPosition(
    locationSettings: const LocationSettings(
      accuracy: LocationAccuracy.high,
      timeLimit: Duration(seconds: 12),
    ),
  );
  if (position.isMocked) {
    throw const AuthException('Turn off mock location before going available.');
  }
  return {'latitude': position.latitude, 'longitude': position.longitude};
}
