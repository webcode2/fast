import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:latlong2/latlong.dart';

import 'auth_api.dart';
import 'places.dart';

/// Runs the real screens against sample data, with no backend, for design
/// review. Never active in release builds.
const previewMode = !kReleaseMode && bool.fromEnvironment('APP_PREVIEW');

const previewDeviceLocation = LatLng(4.8396, 7.0167);

String? previewSession;
String _role = 'customer';
String _registeredRole = 'customer';
bool _available = false;
String? _activeRiderTrip;
int _sequence = 100;

const _samplePlaces = [
  Place(
    name: 'Rivers State University',
    detail: 'Nkpolu-Oroworukwo, Port Harcourt',
    point: LatLng(4.7986, 6.9823),
  ),
  Place(
    name: 'Rumuokoro Motor Park',
    detail: 'Ikwerre Road, Port Harcourt',
    point: LatLng(4.8722, 6.9987),
  ),
  Place(
    name: 'Port Harcourt Pleasure Park',
    detail: 'Aba Road, Port Harcourt',
    point: LatLng(4.8237, 7.0274),
  ),
  Place(
    name: 'Mile 1 Market',
    detail: 'Ikwerre Road, Diobu',
    point: LatLng(4.7936, 6.9947),
  ),
  Place(
    name: 'Garrison Junction',
    detail: 'Aba Road, Port Harcourt',
    point: LatLng(4.8066, 7.0213),
  ),
  Place(
    name: 'Rumuola Road',
    detail: 'Rumuola, Port Harcourt',
    point: LatLng(4.8347, 7.0014),
  ),
];

List<Place> previewRecentPlaces() => _samplePlaces.take(2).toList();

Map<String, double> _json(LatLng point) => {
  'latitude': point.latitude,
  'longitude': point.longitude,
};

LatLng _point(Object? value) {
  final map = value as Map;
  return LatLng(
    (map['latitude'] as num).toDouble(),
    (map['longitude'] as num).toDouble(),
  );
}

// Public demo router, for this preview only. Production routes come from the API.
Future<({int meters, List<List<double>> path})> _road(
  LatLng from,
  LatLng to,
) async {
  try {
    final response = await http
        .get(
          Uri.parse(
            'https://router.project-osrm.org/route/v1/driving/'
            '${from.longitude},${from.latitude};${to.longitude},${to.latitude}'
            '?overview=full&geometries=geojson',
          ),
        )
        .timeout(const Duration(seconds: 10));
    final route = (jsonDecode(response.body)['routes'] as List).first;
    return (
      meters: (route['distance'] as num).ceil(),
      path: [
        for (final pair in route['geometry']['coordinates'] as List)
          [(pair[1] as num).toDouble(), (pair[0] as num).toDouble()],
      ],
    );
  } catch (_) {
    throw const AuthException('Street routing temporarily unavailable', 503);
  }
}

Future<void> _ensureRoad(Map<String, dynamic> order) async {
  if (order['path'] != null) return;
  final road = await _road(_point(order['pickup']), _point(order['dropoff']));
  order.addAll({
    'path': road.path,
    'distanceMeters': road.meters,
    'fareFloorKobo': road.meters * 15,
  });
}

Map<String, dynamic> _order(
  String id,
  String status,
  DateTime created, {
  required Place pickup,
  required Place dropoff,
  required int offer,
  String payment = 'cash',
}) => {
  'id': id,
  'status': status,
  'createdAt': created.toIso8601String(),
  'biddingExpiresAt': created
      .add(const Duration(seconds: 60))
      .toIso8601String(),
  'distanceMeters': 0,
  'fareFloorKobo': 0,
  'offeredFareKobo': offer,
  'paymentMethod': payment,
  'pickupLabel': pickup.name,
  'dropoffLabel': dropoff.name,
  'pickup': _json(pickup.point),
  'dropoff': _json(dropoff.point),
  'bids': <Map<String, dynamic>>[],
};

final _orders = <Map<String, dynamic>>[
  _order(
    'a1000000-0000-4000-8000-000000000001',
    'completed',
    DateTime.now().subtract(const Duration(days: 1, hours: 3)),
    pickup: _samplePlaces[5],
    dropoff: _samplePlaces[0],
    offer: 180000,
  )..addAll({'agreedFareKobo': 200000}),
  _order(
    'a1000000-0000-4000-8000-000000000002',
    'expired',
    DateTime.now().subtract(const Duration(days: 4)),
    pickup: _samplePlaces[2],
    dropoff: _samplePlaces[1],
    offer: 150000,
  ),
];

final _riderOrders = <Map<String, dynamic>>[
  _order(
    'b1000000-0000-4000-8000-000000000001',
    'pending_dispatch',
    DateTime.now(),
    pickup: _samplePlaces[5],
    dropoff: _samplePlaces[3],
    offer: 145000,
  )..addAll({'pickupDistanceMeters': 650}),
  _order(
    'b1000000-0000-4000-8000-000000000002',
    'pending_dispatch',
    DateTime.now(),
    pickup: _samplePlaces[2],
    dropoff: _samplePlaces[1],
    offer: 240000,
    payment: 'digital',
  )..addAll({'pickupDistanceMeters': 1800}),
];

final _messages = <String, List<Map<String, dynamic>>>{};
final _feedback = <String, Map<String, dynamic>>{};

Map<String, dynamic> _find(String id) =>
    [..._orders, ..._riderOrders].firstWhere((order) => order['id'] == id);

// Sample riders answer over time so the waiting state is visible.
List<Map<String, dynamic>> _bids(Map<String, dynamic> order) {
  final age = DateTime.now()
      .difference(DateTime.parse(order['createdAt'] as String))
      .inSeconds;
  final offer = order['offeredFareKobo'] as int;
  return [
        if (age >= 3) (id: 'bid-1', fare: offer + 20000),
        if (age >= 6) (id: 'bid-2', fare: offer),
        if (age >= 10) (id: 'bid-3', fare: offer + 50000),
      ]
      .map(
        (bid) => {
          'id': bid.id,
          'riderId': 'c${bid.id}-sample',
          'fareKobo': bid.fare,
        },
      )
      .toList();
}

const _riderMetersPerSecond = 40.0;
const _reviewRiderMetersPerSecond = 150.0;
const _arriveAtPickupSeconds = 5;
const _noShowWaitSeconds = 20;
const _missedTurnAfterSeconds = 18;
const _missedTurnOffsetDegrees = .0012;

List<double> _pointAlong(List<dynamic> path, double meters) {
  const distance = Distance();
  var left = meters;
  for (var i = 1; i < path.length; i++) {
    final from = LatLng(path[i - 1][0] as double, path[i - 1][1] as double);
    final to = LatLng(path[i][0] as double, path[i][1] as double);
    final step = distance(from, to);
    if (left <= step && step > 0) {
      final part = left / step;
      return [
        from.latitude + (to.latitude - from.latitude) * part,
        from.longitude + (to.longitude - from.longitude) * part,
      ];
    }
    left -= step;
  }
  return (path.last as List).cast<double>();
}

// Sample riders travel fast so the arrival can be reached during a review.
double _ridden(Map<String, dynamic> order) {
  final riding = _riderOrders.contains(order);
  if (riding && order['status'] == 'assigned') return 0;
  return DateTime.now()
          .difference(DateTime.parse(order['liveFrom'] as String))
          .inMilliseconds /
      1000 *
      (riding ? _reviewRiderMetersPerSecond : _riderMetersPerSecond);
}

String? _atStop(Map<String, dynamic> order, List<double>? position) {
  if (position == null) return null;
  if (order['status'] == 'assigned') {
    final age = DateTime.now()
        .difference(DateTime.parse(order['assignedAt'] as String))
        .inSeconds;
    return _riderOrders.contains(order) && age >= _arriveAtPickupSeconds
        ? 'pickup'
        : null;
  }
  final meters = const Distance()(
    LatLng(position[0], position[1]),
    _point(order['dropoff']),
  );
  if (meters > 100) return null;
  order['noShowEligibleAt'] ??= DateTime.now()
      .add(const Duration(seconds: _noShowWaitSeconds))
      .toIso8601String();
  return 'dropoff';
}

// Starts the sample ride along the road, and once sends the rider past a turn
// so the new route can be seen.
Future<void> _advance(Map<String, dynamic> order) async {
  if (!['assigned', 'picked_up'].contains(order['status'])) return;
  await _ensureRoad(order);
  order['livePath'] ??= order['path'];
  order['liveFrom'] ??= order['assignedAt'];
  order['routeUpdatedAt'] ??= order['assignedAt'];
  final age = DateTime.now()
      .difference(DateTime.parse(order['assignedAt'] as String))
      .inSeconds;
  if (_orders.contains(order) && order['status'] == 'assigned' && age > 12) {
    order['status'] = 'picked_up';
  }
  if (_riderOrders.contains(order) && order['status'] == 'assigned') return;
  if (age < _missedTurnAfterSeconds || order['missedTurn'] == true) return;
  order['missedTurn'] = true;
  final position = _pointAlong(order['livePath'] as List, _ridden(order));
  final road = await _road(
    LatLng(
      position[0] + _missedTurnOffsetDegrees,
      position[1] + _missedTurnOffsetDegrees,
    ),
    _point(order['dropoff']),
  );
  order.addAll({
    'livePath': road.path,
    'liveFrom': DateTime.now().toIso8601String(),
    'routeUpdatedAt': DateTime.now().toIso8601String(),
  });
}

Map<String, dynamic> _trip(Map<String, dynamic> order) {
  final active =
      ['assigned', 'picked_up'].contains(order['status']) &&
      order['livePath'] != null;
  final position = active
      ? _pointAlong(order['livePath'] as List, _ridden(order))
      : null;
  return {
    ...order,
    'paymentPending': false,
    'trackingDropout': false,
    'atStop': _atStop(order, position),
    'riderLocation': position == null
        ? null
        : {
            'latitude': position[0],
            'longitude': position[1],
            'recordedAt': DateTime.now().toIso8601String(),
          },
  };
}

Map<String, dynamic> _comms(String id) {
  final order = _find(id);
  final account = 'preview-$_role';
  final other = _role == 'rider' ? 'preview-customer' : 'preview-rider';
  final messages = _messages.putIfAbsent(
    id,
    () => [
      {
        'id': '2',
        'senderId': other,
        'body': _role == 'rider'
            ? 'Please call me when you reach the gate.'
            : 'On my way to pick up your parcel.',
      },
      {'id': '1', 'senderId': account, 'body': 'Hello'},
    ],
  );
  return {
    'assignment': 'assignment-$id',
    'status': order['status'],
    'accountId': account,
    'active': ['assigned', 'picked_up'].contains(order['status']),
    'messages': messages,
    'call': null,
  };
}

Future<Map<String, dynamic>> previewRequest(
  String path,
  String method,
  Map<String, Object?>? data,
) async {
  await Future<void>.delayed(const Duration(milliseconds: 250));
  final uri = Uri.parse(path);
  final parts = uri.pathSegments;
  final route = uri.path;

  if (route.startsWith('/auth/')) return _auth(route, method, data);
  if (route == '/places/search') {
    final text = uri.queryParameters['q']!.toLowerCase();
    return {
      'places': [
        for (final place in _samplePlaces)
          if (place.name.toLowerCase().contains(text) ||
              place.detail.toLowerCase().contains(text))
            place.toJson(),
      ],
    };
  }
  if (route == '/places/reverse') {
    final point = LatLng(
      double.parse(uri.queryParameters['latitude']!),
      double.parse(uri.queryParameters['longitude']!),
    );
    final nearest = [..._samplePlaces]
      ..sort(
        (a, b) => const Distance()(
          a.point,
          point,
        ).compareTo(const Distance()(b.point, point)),
      );
    return {
      'place': const Distance()(nearest.first.point, point) < 900
          ? nearest.first.toJson()
          : {
              'name':
                  '${(point.latitude * 9000 % 90).floor() + 1} Ikwerre Road',
              'detail': 'Port Harcourt',
              ..._json(point),
            },
    };
  }
  if (route == '/orders/quote') {
    final road = await _road(_point(data!['pickup']), _point(data['dropoff']));
    return {
      'distanceMeters': road.meters,
      'fareFloorKobo': road.meters * 15,
      'currency': 'NGN',
      'path': road.path,
    };
  }
  if (route == '/orders') {
    if (method == 'GET') {
      return {
        'orders': [
          for (final order in _orders)
            if (order['status'] == 'assigned') _trip(order) else order,
        ],
      };
    }
    final id = 'a${_sequence++}0000-0000-4000-8000-000000000000';
    final order = {
      ..._order(
        id,
        'pending_dispatch',
        DateTime.now(),
        pickup: Place(
          name: data!['pickupLabel'] as String? ?? pinnedLocationName,
          point: _point(data['pickup']),
        ),
        dropoff: Place(
          name: data['dropoffLabel'] as String? ?? pinnedLocationName,
          point: _point(data['dropoff']),
        ),
        offer: data['offeredFareKobo'] as int,
        payment: data['paymentMethod'] as String? ?? 'cash',
      ),
    };
    await _ensureRoad(order);
    _orders.insert(0, order);
    return {'order': order};
  }
  if (route == '/dispatch/availability') {
    if (method == 'PUT') _available = data!['available'] == true;
    return {
      'available': _available,
      'identityApproved': true,
      'commissionOverdue': false,
      'activeTripId': _activeRiderTrip,
    };
  }
  if (route == '/dispatch/nearby') {
    await Future.wait(_riderOrders.map(_ensureRoad));
    return {
      'orders': _riderOrders
          .where((order) => order['status'] == 'pending_dispatch')
          .toList(),
    };
  }
  if (route == '/trips/active') {
    final mine = _role == 'rider' ? _riderOrders : _orders;
    return {
      'trips': mine
          .where((o) => ['assigned', 'picked_up'].contains(o['status']))
          .toList(),
    };
  }
  if (route == '/trips/feedback') {
    return {
      'trips': _orders
          .where((order) => order['status'] == 'completed')
          .map((order) => {...order, 'disputeStatus': null})
          .toList(),
    };
  }
  if (route == '/cash-commission') {
    return {'outstandingKobo': '42000', 'overdueKobo': '0', 'blocked': false};
  }
  if (route == '/identity/rider') {
    return {'approved': true, 'available': true, 'checks': const []};
  }
  if (parts.length >= 3 && parts[0] == 'orders') {
    final order = _find(parts[1]);
    switch (parts[2]) {
      case 'bids' when method == 'GET':
        final status = order['status'];
        return {
          'order': {
            ...order,
            'bids': status == 'pending_dispatch' ? _bids(order) : const [],
          },
        };
      case 'bids':
        return {};
      case 'accept':
        order.addAll({
          'status': 'assigned',
          'agreedFareKobo': data!['fareKobo'],
          'assignedAt': DateTime.now().toIso8601String(),
        });
        return {'assignment': order};
      case 'claim':
        order.addAll({
          'status': 'assigned',
          'agreedFareKobo': order['offeredFareKobo'],
          'assignedAt': DateTime.now().toIso8601String(),
        });
        _activeRiderTrip = parts[1];
        _available = false;
        return {'assignment': order};
    }
  }
  if (parts.length >= 2 && parts[0] == 'trips') {
    final id = parts[1];
    final order = _find(id);
    final action = parts.length > 2 ? parts[2] : null;
    await _advance(order);
    switch (action) {
      case null:
        return {'trip': _trip(order)};
      case 'route':
        return {
          'route': {
            'target': 'dropoff',
            'path': order['livePath'] ?? order['path'],
            'distanceMeters': order['distanceMeters'],
            'updatedAt': order['routeUpdatedAt'],
          },
        };
      case 'pickup':
        order['status'] = 'picked_up';
        order['liveFrom'] = DateTime.now().toIso8601String();
        return {'trip': _trip(order)};
      case 'complete':
        order['status'] = 'completed';
        _activeRiderTrip = null;
        return {'trip': _trip(order)};
      case 'location':
      case 'issues':
        return {};
      case 'no-show':
        order['status'] = 'customer_unavailable';
        _activeRiderTrip = null;
        return {'status': 'customer_unavailable'};
      case 'cancel':
        if (order['status'] == 'picked_up') {
          return {'status': 'support_requested'};
        }
        order['status'] = 'pending_dispatch';
        _activeRiderTrip = null;
        return {'status': 'pending_dispatch'};
      case 'payment':
        return {'collected': true};
      case 'feedback':
        return _feedback[id] ?? {'review': null, 'dispute': null};
      case 'review':
        _feedback[id] = {
          ...?_feedback[id],
          'review': {'rating': data!['rating'], 'comment': data['comment']},
          'dispute': _feedback[id]?['dispute'],
        };
        return {};
      case 'dispute':
        _feedback[id] = {
          'review': _feedback[id]?['review'],
          'dispute': {'status': 'open', 'details': data!['details']},
        };
        return {};
      case 'comms':
        final sub = parts.length > 3 ? parts[3] : null;
        if (sub == 'messages' && method == 'POST') {
          _comms(id);
          _messages[id]!.insert(0, {
            'id': '${_sequence++}',
            'senderId': 'preview-$_role',
            'body': data!['body'],
          });
          return {};
        }
        if (sub == 'ice') {
          throw const AuthException(
            'Voice calls need two real devices. They are off in this preview.',
          );
        }
        return _comms(id);
    }
  }
  return {};
}

Map<String, dynamic> _auth(
  String route,
  String method,
  Map<String, Object?>? data,
) {
  switch (route) {
    case '/auth/login':
      _role = '${data!['email']}'.contains('rider') ? 'rider' : _registeredRole;
      return {'token': 'preview-session'};
    case '/auth/register':
      _registeredRole = data!['role'] as String;
      return {};
    default:
      return {
        'user': {
          'id': 'preview-$_role',
          'name': _role == 'rider' ? 'Sample Rider' : 'Sample Customer',
          'role': _role,
          'email': 'sample@example.test',
          'phone': '+2348000000000',
          'email_verified': true,
          'phone_verified': true,
        },
      };
  }
}
