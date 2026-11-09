import 'package:fast_logistics/trip_call_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('each call phase shows its own actions', (tester) async {
    var actions = 0;
    void tap() => actions++;
    Future<void> show(TripCallPhase phase, {bool muted = false}) =>
        tester.pumpWidget(
          MaterialApp(
            home: TripCallScreen(
              phase: phase,
              answer: tap,
              end: tap,
              toggleMute: tap,
              muted: muted,
            ),
          ),
        );

    await show(TripCallPhase.incoming);
    expect(find.text('Incoming call'), findsOneWidget);
    expect(find.text('Decline'), findsOneWidget);
    expect(find.text('Mute'), findsNothing);
    await tester.tap(find.text('Answer'));

    await show(TripCallPhase.outgoing);
    expect(find.text('Outgoing call'), findsOneWidget);
    expect(find.text('Answer'), findsNothing);
    await tester.tap(find.text('Cancel call'));

    await show(TripCallPhase.active, muted: true);
    expect(find.text('On a call'), findsOneWidget);
    await tester.tap(find.text('Unmute'));
    await tester.tap(find.text('End call'));
    expect(actions, 4);
  });
}
