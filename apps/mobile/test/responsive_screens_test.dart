import 'package:fast_logistics/app_theme.dart';
import 'package:fast_logistics/auth_onboarding.dart';
import 'package:fast_logistics/customer_home.dart';
import 'package:fast_logistics/rider_dispatch.dart';
import 'package:fast_logistics/signup_pages.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Future<void> show(
  WidgetTester tester,
  Widget page, {
  required Size size,
  required double textScale,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      theme: appTheme(Brightness.dark),
      home: MediaQuery(
        data: MediaQueryData(
          size: size,
          textScaler: TextScaler.linear(textScale),
        ),
        child: page,
      ),
    ),
  );
  await tester.pump();
  expect(tester.takeException(), isNull);
  await tester.pumpWidget(const SizedBox());
  await tester.pump(const Duration(seconds: 1));
}

void main() {
  const user = {'name': 'Ada', 'role': 'customer'};
  for (final (size, scale) in const [
    (Size(320, 568), 1.0),
    (Size(320, 568), 2.0),
    (Size(412, 915), 1.5),
    (Size(800, 600), 1.0),
  ]) {
    testWidgets('home fits $size at text scale $scale', (tester) async {
      await show(
        tester,
        const CustomerHomePage(user: user),
        size: size,
        textScale: scale,
      );
    });

    testWidgets('signup fits $size at text scale $scale', (tester) async {
      await show(tester, const SignupChoice(), size: size, textScale: scale);
    });

    testWidgets('onboarding fits $size at text scale $scale', (tester) async {
      await show(
        tester,
        const RegistrationPage(role: 'customer'),
        size: size,
        textScale: scale,
      );
    });

    testWidgets('phone code fits $size at text scale $scale', (tester) async {
      await show(
        tester,
        const VerifyPhonePage(phone: '+2348060000000'),
        size: size,
        textScale: scale,
      );
    });

    testWidgets('rider offer fits $size at text scale $scale', (tester) async {
      await show(
        tester,
        Scaffold(
          body: SingleChildScrollView(
            child: RiderOfferCard(
              order: const {
                'pickupDistanceMeters': 1500,
                'distanceMeters': 4100,
                'offeredFareKobo': 150000,
                'paymentMethod': 'digital',
                'pickupLabel': 'A very long pickup place name in Port Harcourt',
                'dropoffLabel': 'A very long drop-off place name in Diobu',
              },
              claim: () {},
              counter: () {},
            ),
          ),
        ),
        size: size,
        textScale: scale,
      );
    });
  }
}
