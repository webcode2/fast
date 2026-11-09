import 'package:fast_logistics/rider_dispatch.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('rider offer shows fare and payment and exposes both actions', (
    tester,
  ) async {
    var claimed = false;
    var countered = false;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: RiderOfferCard(
            order: {
              'pickupDistanceMeters': 1500,
              'distanceMeters': 4100,
              'offeredFareKobo': 150000,
              'paymentMethod': 'cash',
            },
            claim: () => claimed = true,
            counter: () => countered = true,
          ),
        ),
      ),
    );

    expect(find.text('₦1,500'), findsOneWidget);
    expect(find.text('Cash'), findsOneWidget);
    await tester.tap(find.text('Counteroffer'));
    expect(countered, isTrue);
    expect(claimed, isFalse);
    await tester.tap(find.text('Claim'));
    expect(claimed, isTrue);
  });
}
