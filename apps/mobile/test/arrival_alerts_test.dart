import 'package:fast_logistics/arrival_alerts.dart';
import 'package:fast_logistics/trip_comms.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:latlong2/latlong.dart';

void main() {
  const pickup = LatLng(4.8100, 7.0100);
  const dropoff = LatLng(4.8200, 7.0200);
  // About 89 m north of each stop.
  const nearPickup = LatLng(4.8108, 7.0100);
  const nearDropoff = LatLng(4.8208, 7.0200);
  // About 133 m north of the pickup.
  const pastPickup = LatLng(4.8112, 7.0100);

  String? stop(String? status, LatLng position) =>
      stopReached(status, position, pickup: pickup, dropoff: dropoff);

  test('assigned riders reach only the pickup', () {
    expect(stop('assigned', nearPickup), 'pickup');
    expect(stop('assigned', nearDropoff), isNull);
    expect(stop('assigned', pastPickup), isNull);
  });

  test('riders with the parcel reach only the drop-off', () {
    expect(stop('picked_up', nearDropoff), 'dropoff');
    expect(stop('picked_up', nearPickup), isNull);
  });

  test('finished trips and unknown stops never announce an arrival', () {
    expect(stop('completed', nearDropoff), isNull);
    expect(stop(null, nearPickup), isNull);
    expect(
      stopReached('assigned', nearPickup, pickup: null, dropoff: dropoff),
      isNull,
    );
  });

  test('each stop alerts once, even when GPS drifts in and out', () {
    final tracker = ArrivalTracker();
    expect(tracker.isNew(null), isFalse);
    expect(tracker.isNew('pickup'), isTrue);
    expect(tracker.isNew('pickup'), isFalse);
    expect(tracker.isNew(null), isFalse);
    expect(tracker.isNew('pickup'), isFalse);
    expect(tracker.isNew('dropoff'), isTrue);
    expect(tracker.isNew('dropoff'), isFalse);
  });

  test('notification buttons open calling and messaging for the trip', () {
    final call = pageForAction('call', 'trip-1') as TripCommsPage;
    expect(call.tripId, 'trip-1');
    expect(call.startCall, isTrue);

    final message = pageForAction('message', 'trip-1') as TripCommsPage;
    expect(message.tripId, 'trip-1');
    expect(message.startCall, isFalse);
  });

  test('a plain tap or a missing trip opens no extra screen', () {
    expect(pageForAction(null, 'trip-1'), isNull);
    expect(pageForAction('call', null), isNull);
  });
}
