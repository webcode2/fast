import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';

import 'arrival_alerts.dart';
import 'auth_api.dart';
import 'booking_api.dart';
import 'preview_api.dart';
import 'rider_location.dart';
import 'trip_location_queue.dart';

class RiderTripLocation {
  RiderTripLocation(this.tripId, this._onStatus, {this.onPosition});

  final String tripId;
  final void Function(String) _onStatus;
  final void Function(LatLng)? onPosition;
  final _queue = TripLocationQueue();
  StreamSubscription<Position>? _positions;
  Timer? _retry;
  DateTime? _lastAttempt;
  bool _active = false;
  bool _closed = false;
  bool _alertsOff = false;

  bool get active => _active;

  // Status lines replace each other, so the warning repeats to stay visible.
  void onStatus(String status) => _onStatus(
    _alertsOff
        ? '$status Arrival alerts are off. Turn on notifications in your phone settings.'
        : status,
  );

  Future<void> start() async {
    if (_active || _closed) return;
    if (previewMode) {
      _active = true;
      onStatus('Location shared.');
      return;
    }
    await ensureRiderLocationPermission(askPermission: true);
    if (_closed) return;
    final lifecycle = WidgetsBinding.instance.lifecycleState;
    if (lifecycle != null && lifecycle != AppLifecycleState.resumed) {
      throw const AuthException(
        'Open the assigned delivery screen to start sharing.',
      );
    }
    try {
      _alertsOff = !await ArrivalAlerts.requestPermission();
    } catch (_) {
      _alertsOff = true;
    }
    if (_closed) return;
    final settings = switch (defaultTargetPlatform) {
      TargetPlatform.android => AndroidSettings(
        accuracy: LocationAccuracy.high,
        intervalDuration: const Duration(seconds: 5),
        foregroundNotificationConfig: const ForegroundNotificationConfig(
          notificationTitle: 'Delivery location sharing',
          notificationText: 'FAST is sharing your location for this active delivery.',
          setOngoing: true,
        ),
      ),
      TargetPlatform.iOS => AppleSettings(
        accuracy: LocationAccuracy.high,
        pauseLocationUpdatesAutomatically: false,
        allowBackgroundLocationUpdates: true,
        showBackgroundLocationIndicator: true,
      ),
      _ => const LocationSettings(accuracy: LocationAccuracy.high),
    };
    _active = true;
    onStatus('Waiting for a GPS update…');
    _positions = Geolocator.getPositionStream(locationSettings: settings)
        .listen(
          (position) {
            if (!_active) return;
            if (position.isMocked) {
              onStatus('Mock GPS update ignored.');
              return;
            }
            onPosition?.call(LatLng(position.latitude, position.longitude));
            _queue.offer(
              TripLocationSample(
                position.latitude,
                position.longitude,
                position.timestamp,
              ),
            );
            unawaited(_flush());
          },
          onError: (Object error) {
            unawaited(stop());
            onStatus(
              'Location sharing stopped. Check permissions and try again.',
            );
          },
        );
    _retry = Timer.periodic(
      const Duration(seconds: 5),
      (_) => unawaited(_flush()),
    );
  }

  Future<void> _flush() async {
    if (!_active) return;
    final last = _lastAttempt;
    if (last != null &&
        DateTime.now().difference(last) < const Duration(seconds: 4)) {
      return;
    }
    await _queue.flush((sample) async {
      if (!_active) return true;
      _lastAttempt = DateTime.now();
      try {
        await bookingRequest(
          '/trips/$tripId/location',
          method: 'POST',
          data: sample.toJson(),
        );
        if (_active) onStatus('Location shared.');
        return true;
      } on AuthException catch (error) {
        if (!_active) return true;
        if (error.status == 401 || error.status == 403 || error.status == 404) {
          await stop();
          onStatus('Location sharing stopped because trip access changed.');
          return true;
        }
        if (error.status == 400 || error.status == 409) {
          onStatus(
            'GPS update was not accepted. Waiting for a newer position.',
          );
          return true;
        }
        onStatus('Connection interrupted. Retrying the latest position.');
        return false;
      } catch (_) {
        if (_active) onStatus('Could not send location. Retrying.');
        return false;
      }
    });
  }

  Future<void> stop() async {
    _active = false;
    _retry?.cancel();
    _retry = null;
    final positions = _positions;
    _positions = null;
    _queue.clear();
    _lastAttempt = null;
    await positions?.cancel();
  }

  Future<void> close() async {
    _closed = true;
    await stop();
  }
}
