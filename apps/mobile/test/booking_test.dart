import 'package:fast_logistics/booking_api.dart';
import 'package:fast_logistics/booking_widgets.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('fare input uses exact kobo and rejects unsupported amounts', () {
    expect(parseFareKobo('150'), 15000);
    expect(parseFareKobo(' 150.05 '), 15005);
    expect(parseFareKobo('1.2'), 120);
    expect(parseFareKobo('1.001'), isNull);
    expect(parseFareKobo('0'), isNull);
    expect(parseFareKobo('21474836.48'), isNull);
  });

  test('fares group thousands and hide zero kobo', () {
    expect(displayFare(15005), '₦150.05');
    expect(displayFare(150000), '₦1,500');
    expect(displayFare(123456789), '₦1,234,567.89');
    expect(displayNaira(BigInt.zero), '₦0');
  });

  test('offers open at a round amount and never drop below the floor', () {
    expect(openingOffer(75015), 80000);
    expect(openingOffer(75000), 75000);
    expect(lowerOffer(80000, 75015), 75015);
    expect(lowerOffer(100000, 75015), 90000);
  });

  test('search highlight marks every match without changing the text', () {
    const style = TextStyle(color: Color(0xFF0000FF));
    final spans = highlightMatch('RSU, near rsu gate', 'rsu', style);
    expect(spans.map((span) => span.text).join(), 'RSU, near rsu gate');
    expect(spans.where((span) => span.style == style).length, 2);
  });

  testWidgets('stepper lowers no further at the fare floor', (tester) async {
    int? changed;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: FareStepper(
            offerKobo: 75015,
            floorKobo: 75015,
            onChanged: (value) => changed = value,
          ),
        ),
      ),
    );
    await tester.tap(find.byTooltip('Lower your offer'));
    expect(changed, isNull);
    await tester.tap(find.byTooltip('Raise your offer'));
    expect(changed, 85015);
  });
}
