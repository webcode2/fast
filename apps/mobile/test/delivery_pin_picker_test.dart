import 'package:fast_logistics/delivery_pin_picker.dart';
import 'package:fast_logistics/places.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:latlong2/latlong.dart';

void main() {
  testWidgets('pickup picker confirms the named point under the pin', (
    tester,
  ) async {
    Place? selected;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () async {
                selected = await Navigator.of(context).push<Place>(
                  MaterialPageRoute(
                    builder: (_) => const DeliveryPinPicker(
                      label: 'Pickup',
                      selected: Place(
                        name: 'Mile 1 Market',
                        point: LatLng(4.7936, 6.9947),
                      ),
                    ),
                  ),
                );
              },
              child: const Text('Open picker'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Open picker'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Set pickup'));
    await tester.pumpAndSettle();
    expect(selected?.name, 'Mile 1 Market');
    expect(selected?.point, const LatLng(4.7936, 6.9947));
  });
}
