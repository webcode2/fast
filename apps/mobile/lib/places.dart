import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';

import 'booking_api.dart';
import 'preview_api.dart';
import 'rider_location.dart';

class Place {
  const Place({required this.name, this.detail = '', required this.point});

  factory Place.fromJson(Map<String, dynamic> json) => Place(
    name: json['name'] as String,
    detail: json['detail'] as String? ?? '',
    point: LatLng(
      (json['latitude'] as num).toDouble(),
      (json['longitude'] as num).toDouble(),
    ),
  );

  final String name;
  final String detail;
  final LatLng point;

  Map<String, Object> toJson() => {
    'name': name,
    'detail': detail,
    'latitude': point.latitude,
    'longitude': point.longitude,
  };
}

const pinnedLocationName = 'Pinned location';

Future<List<Place>> searchPlaces(String text, {LatLng? near}) async {
  final query = Uri(
    queryParameters: {
      'q': text,
      if (near != null) 'latitude': '${near.latitude}',
      if (near != null) 'longitude': '${near.longitude}',
    },
  ).query;
  final result = await bookingRequest('/places/search?$query');
  return [
    for (final raw in result['places'] as List)
      Place.fromJson(raw as Map<String, dynamic>),
  ];
}

/// Names a map position, falling back to a generic name so booking continues
/// when the lookup fails.
Future<Place> placeAt(LatLng point) async {
  try {
    final result = await bookingRequest(
      '/places/reverse?latitude=${point.latitude}&longitude=${point.longitude}',
    );
    final place = result['place'] as Map<String, dynamic>?;
    if (place != null) {
      return Place(
        name: place['name'] as String,
        detail: place['detail'] as String? ?? '',
        point: point,
      );
    }
  } catch (_) {
    // A pin is still a valid location without a street name.
  }
  return Place(name: pinnedLocationName, point: point);
}

Future<LatLng> deviceLocation({required bool askPermission}) async {
  if (previewMode) return previewDeviceLocation;
  await ensureRiderLocationPermission(askPermission: askPermission);
  final position = await Geolocator.getCurrentPosition(
    locationSettings: const LocationSettings(
      accuracy: LocationAccuracy.high,
      timeLimit: Duration(seconds: 12),
    ),
  );
  return LatLng(position.latitude, position.longitude);
}

const _storage = FlutterSecureStorage();
const _recentsKey = 'fast_logistics_recent_places';
const _recentLimit = 5;

Future<List<Place>> recentPlaces() async {
  if (previewMode) return previewRecentPlaces();
  try {
    final raw = await _storage.read(key: _recentsKey);
    if (raw == null) return [];
    return [
      for (final item in jsonDecode(raw) as List)
        Place.fromJson(item as Map<String, dynamic>),
    ];
  } catch (_) {
    return [];
  }
}

Future<void> rememberPlace(Place place) async {
  if (previewMode || place.name == pinnedLocationName) return;
  try {
    final recents = await recentPlaces();
    final updated = [
      place,
      ...recents.where((recent) => recent.point != place.point),
    ].take(_recentLimit).map((recent) => recent.toJson()).toList();
    await _storage.write(key: _recentsKey, value: jsonEncode(updated));
  } catch (_) {
    // Recents are a convenience and never block a booking.
  }
}
