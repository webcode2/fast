import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:latlong2/latlong.dart';

import 'preview_api.dart';
import 'trip_comms.dart';

/// Matches `arrivalMeters` in apps/api/src/trips.ts.
const arrivalMeters = 100.0;

const _channelId = 'trip_arrivals';
const _categoryId = 'trip_arrival';
const _callAction = 'call';
const _messageAction = 'message';
const _pickupNotificationId = 7101;
const _dropoffNotificationId = 7102;

final appNavigatorKey = GlobalKey<NavigatorState>();

/// The stop the rider has reached, if any, for the trip's current stage.
String? stopReached(
  String? status,
  LatLng position, {
  required LatLng? pickup,
  required LatLng? dropoff,
}) {
  final (stop, point) = switch (status) {
    'assigned' => ('pickup', pickup),
    'picked_up' => ('dropoff', dropoff),
    _ => (null, null),
  };
  if (point == null) return null;
  return const Distance()(position, point) <= arrivalMeters ? stop : null;
}

/// GPS drifts in and out near a stop, so each stop alerts only once.
class ArrivalTracker {
  final _announced = <String>{};

  bool isNew(String? stop) => stop != null && _announced.add(stop);
}

/// The screen a notification button opens. A plain tap only opens the app.
Widget? pageForAction(String? actionId, String? tripId) {
  if (tripId == null) return null;
  return switch (actionId) {
    _callAction => TripCommsPage(tripId: tripId, startCall: true),
    _messageAction => TripCommsPage(tripId: tripId),
    _ => null,
  };
}

/// Local lock-screen alerts. They need no push service because the rider's
/// background GPS stream keeps the app running during a trip.
class ArrivalAlerts {
  const ArrivalAlerts._();

  static final _plugin = FlutterLocalNotificationsPlugin();
  static bool _ready = false;

  static bool get _supported =>
      !kIsWeb &&
      !previewMode &&
      (defaultTargetPlatform == TargetPlatform.android ||
          defaultTargetPlatform == TargetPlatform.iOS);

  static void _open(String? actionId, String? tripId) {
    final page = pageForAction(actionId, tripId);
    if (page == null) return;
    appNavigatorKey.currentState?.push(
      MaterialPageRoute<void>(builder: (_) => page),
    );
  }

  static Future<void> init() async {
    if (!_supported || _ready) return;
    _ready =
        await _plugin.initialize(
          settings: InitializationSettings(
            android: const AndroidInitializationSettings('@mipmap/ic_launcher'),
            iOS: DarwinInitializationSettings(
              requestAlertPermission: false,
              requestBadgePermission: false,
              requestSoundPermission: false,
              notificationCategories: [
                DarwinNotificationCategory(
                  _categoryId,
                  actions: [
                    DarwinNotificationAction.plain(
                      _callAction,
                      'Call',
                      options: {DarwinNotificationActionOption.foreground},
                    ),
                    DarwinNotificationAction.plain(
                      _messageAction,
                      'Message',
                      options: {DarwinNotificationActionOption.foreground},
                    ),
                  ],
                ),
              ],
            ),
          ),
          onDidReceiveNotificationResponse: (response) =>
              _open(response.actionId, response.payload),
        ) ==
        true;
    if (!_ready) return;
    // A button pressed after the app stopped starts it again.
    final launch = await _plugin.getNotificationAppLaunchDetails();
    final response = launch?.notificationResponse;
    if (launch?.didNotificationLaunchApp == true && response != null) {
      WidgetsBinding.instance.addPostFrameCallback(
        (_) => _open(response.actionId, response.payload),
      );
    }
  }

  /// Returns false when alerts cannot reach the rider.
  static Future<bool> requestPermission() async {
    if (!_supported) return true;
    await init();
    if (!_ready) return false;
    final granted = defaultTargetPlatform == TargetPlatform.android
        ? await _plugin
              .resolvePlatformSpecificImplementation<
                AndroidFlutterLocalNotificationsPlugin
              >()
              ?.requestNotificationsPermission()
        : await _plugin
              .resolvePlatformSpecificImplementation<
                IOSFlutterLocalNotificationsPlugin
              >()
              ?.requestPermissions(alert: true, sound: true);
    return granted == true;
  }

  static Future<void> show(String tripId, String stop) async {
    if (!_ready) return;
    final pickup = stop == 'pickup';
    await _plugin.show(
      id: pickup ? _pickupNotificationId : _dropoffNotificationId,
      title: pickup
          ? 'You’ve arrived at the pickup'
          : 'You’ve arrived at the drop-off',
      // This shows on the lock screen, so it never includes the address.
      body: 'Call or message the customer.',
      payload: tripId,
      notificationDetails: const NotificationDetails(
        android: AndroidNotificationDetails(
          _channelId,
          'Trip arrivals',
          channelDescription: 'Tells you when you reach a pickup or drop-off.',
          importance: Importance.high,
          priority: Priority.high,
          visibility: NotificationVisibility.public,
          actions: [
            AndroidNotificationAction(
              _callAction,
              'Call',
              showsUserInterface: true,
            ),
            AndroidNotificationAction(
              _messageAction,
              'Message',
              showsUserInterface: true,
            ),
          ],
        ),
        iOS: DarwinNotificationDetails(categoryIdentifier: _categoryId),
      ),
    );
  }

  static Future<void> cancel(String stop) async {
    if (!_ready) return;
    await _plugin.cancel(
      id: stop == 'pickup' ? _pickupNotificationId : _dropoffNotificationId,
    );
  }

  // Cancels by id so the location-sharing notification stays in place.
  static Future<void> cancelAll() async {
    await cancel('pickup');
    await cancel('dropoff');
  }
}
