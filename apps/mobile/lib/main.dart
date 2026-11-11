import 'package:flutter/material.dart';

import 'app_theme.dart';
import 'arrival_alerts.dart';
import 'auth_onboarding.dart';
import 'auth_pages.dart';
import 'signup_pages.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await loadAppearance();
  try {
    await ArrivalAlerts.init();
  } catch (_) {
    // The app works without alerts. Sharing location tells the rider they're off.
  }
  runApp(const FastLogisticsApp());
}

class FastLogisticsApp extends StatelessWidget {
  const FastLogisticsApp({super.key, this.initialRoute = '/'});

  final String initialRoute;

  @override
  Widget build(BuildContext context) => ValueListenableBuilder(
    valueListenable: appearance,
    builder: (context, mode, _) => MaterialApp(
      title: 'FAST',
      navigatorKey: appNavigatorKey,
      debugShowCheckedModeBanner: false,
      theme: appTheme(Brightness.light),
      darkTheme: appTheme(Brightness.dark),
      themeMode: mode,
      initialRoute: initialRoute,
      routes: {
        '/': (context) => const SessionEntry(),
        '/home': (context) => const HomeEntry(),
        '/signup': (context) => _auth(const SignupChoice()),
        '/signup/customer': (context) =>
            _auth(const RegistrationPage(role: 'customer')),
        '/signup/rider': (context) =>
            _auth(const RegistrationPage(role: 'rider')),
        '/login': (context) => _auth(const LoginPage()),
        '/reset': (context) => _auth(const ResetPage()),
        '/recover': (context) => _auth(const RecoverAccountPage()),
        '/delete-account': (context) => const DeleteAccountPage(),
        '/account': (context) => const AccountPage(),
      },
    ),
  );
}

Widget _auth(Widget page) => Theme(data: authTheme, child: page);
