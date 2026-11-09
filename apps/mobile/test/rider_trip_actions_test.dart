import 'package:fast_logistics/rider_trip_actions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final now = DateTime.utc(2026, 11, 9, 12);

  Future<List<String>> show(
    WidgetTester tester, {
    required String status,
    DateTime? eligible,
  }) async {
    final taps = <String>[];
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: RiderTripActions(
              status: status,
              noShowEligibleAt: eligible,
              now: now,
              onCall: () => taps.add('call'),
              onMessage: () => taps.add('message'),
              onNavigate: () => taps.add('navigate'),
              onReport: () => taps.add('report'),
              onCustomerUnavailable: () => taps.add('unavailable'),
              onCancel: () => taps.add('cancel'),
              onEmergency: () => taps.add('emergency'),
            ),
          ),
        ),
      ),
    );
    return taps;
  }

  testWidgets('before pickup, cancelling is offered and no-show is not', (
    tester,
  ) async {
    final taps = await show(tester, status: 'assigned');
    expect(find.text('Customer not available'), findsNothing);
    expect(find.text('Navigate to pickup'), findsOneWidget);
    await tester.tap(find.text('Cancel this delivery'));
    expect(taps, ['cancel']);
  });

  testWidgets('no-show stays locked until the drop-off wait ends', (
    tester,
  ) async {
    var taps = await show(
      tester,
      status: 'picked_up',
      eligible: now.add(const Duration(seconds: 150)),
    );
    expect(find.text('Available in 3 min'), findsOneWidget);
    await tester.tap(find.text('Customer not available'));
    expect(taps, isEmpty);

    taps = await show(
      tester,
      status: 'picked_up',
      eligible: now.subtract(const Duration(seconds: 1)),
    );
    await tester.tap(find.text('Customer not available'));
    expect(taps, ['unavailable']);
  });

  testWidgets('after pickup, cancelling asks support instead', (tester) async {
    final taps = await show(tester, status: 'picked_up');
    expect(find.text('Cancel this delivery'), findsNothing);
    await tester.tap(find.text('I can’t finish this delivery'));
    await tester.tap(find.text('Emergency: call 112'));
    expect(taps, ['cancel', 'emergency']);
  });

  testWidgets('arrival card names the stop and offers call and message', (
    tester,
  ) async {
    final taps = <String>[];
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ArrivalCard(
            stop: 'dropoff',
            place: 'Mile 1 Market',
            onCall: () => taps.add('call'),
            onMessage: () => taps.add('message'),
          ),
        ),
      ),
    );
    expect(find.text('You’ve arrived at the drop-off'), findsOneWidget);
    await tester.tap(find.text('Call'));
    await tester.tap(find.text('Message'));
    expect(taps, ['call', 'message']);
  });
}
