import 'package:fast_logistics/auth_onboarding.dart';
import 'package:fast_logistics/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('signup routes customers and riders separately', (tester) async {
    await tester.pumpWidget(const FastLogisticsApp(initialRoute: '/signup'));
    await tester.tap(find.text('Get started'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('I want to send a package'));
    await tester.pumpAndSettle();
    expect(find.text('You name the price'), findsOneWidget);

    await tester.pageBack();
    await tester.pumpAndSettle();
    await tester.tap(find.text('Get started'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('I want to deliver packages'));
    await tester.pumpAndSettle();
    expect(find.text('Deliver when it suits you'), findsOneWidget);
  });

  testWidgets('onboarding steps lead to the sign-up form', (tester) async {
    await tester.pumpWidget(
      const FastLogisticsApp(initialRoute: '/signup/rider'),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Skip'));
    await tester.pumpAndSettle();
    expect(find.text('Let’s get you started'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'Create account'), findsOneWidget);
  });

  test('Nigerian phone input becomes international format', () {
    const phone = '+2348060000000';
    expect(normalizeNigerianPhone('0806 000 0000'), phone);
    expect(normalizeNigerianPhone('806-000-0000'), phone);
    expect(normalizeNigerianPhone('2348060000000'), phone);
    expect(normalizeNigerianPhone('+2348060000000'), phone);
    expect(normalizeNigerianPhone('+447700900000'), '+447700900000');
    expect(normalizeNigerianPhone('12345'), isNull);
    expect(normalizeNigerianPhone('0806000000a'), isNull);
  });

  testWidgets('code boxes show each digit and accept only digits', (
    tester,
  ) async {
    final code = TextEditingController();
    addTearDown(code.dispose);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: StatefulBuilder(
            builder: (context, setState) =>
                CodeBoxes(controller: code, onChanged: () => setState(() {})),
          ),
        ),
      ),
    );
    await tester.enterText(find.byType(TextField), '12a3456789');
    await tester.pump();
    expect(code.text, '123456');
    expect(find.text('6'), findsOneWidget);
  });
}
