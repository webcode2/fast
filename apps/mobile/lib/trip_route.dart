import 'package:latlong2/latlong.dart';

import 'booking_api.dart';

/// The part of a road route still ahead of [position]. Road points are only
/// ever dropped, so the line never cuts across the map.
List<LatLng> routeAhead(List<LatLng> path, LatLng? position) {
  if (position == null || path.length < 2) return path;
  const distance = Distance();
  var nearest = 0;
  var closest = double.infinity;
  for (var i = 0; i < path.length; i++) {
    final meters = distance(position, path[i]);
    if (meters < closest) {
      closest = meters;
      nearest = i;
    }
  }
  return path.sublist(nearest == path.length - 1 ? nearest - 1 : nearest);
}

double routeMeters(List<LatLng> path) {
  const distance = Distance();
  var total = 0.0;
  for (var i = 1; i < path.length; i++) {
    total += distance(path[i - 1], path[i]);
  }
  return total;
}

List<LatLng> parseRoutePath(Object? raw) => [
  for (final pair in raw as List? ?? const [])
    LatLng(((pair as List)[0] as num).toDouble(), (pair[1] as num).toDouble()),
];

/// Keeps a trip's road route current as the server replaces it.
class TripRouteFollower {
  TripRouteFollower(this.tripId);

  final String tripId;
  List<LatLng> path = const [];
  String? _version;
  bool _loaded = false;

  /// Returns true when an existing live route was replaced by a new one.
  Future<bool> sync(String? version) async {
    if (_loaded && version == _version) return false;
    try {
      final result = await bookingRequest('/trips/$tripId/route');
      final route = result['route'] as Map<String, dynamic>?;
      final rerouted = _version != null && version != _version;
      path = parseRoutePath(route?['path']);
      _version = version;
      _loaded = true;
      return rerouted;
    } catch (_) {
      // Keep the last road route, and try again on the next trip update.
      return false;
    }
  }
}
