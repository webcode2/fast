import 'package:fast_logistics/booking_payment_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('payment sheet returns the selected payment method', (
    tester,
  ) async {
    String? method;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => TextButton(
              onPressed: () async =>
                  method = await chooseBookingPayment(context, 'cash'),
              child: const Text('Choose payment'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Choose payment'));
    await tester.pumpAndSettle();
    expect(
      tester.widget<ListTile>(find.widgetWithText(ListTile, 'Cash')).selected,
      isTrue,
    );
    await tester.tap(find.text('Card via Bachs'));
    await tester.pumpAndSettle();
    expect(method, 'digital');
  });
}
