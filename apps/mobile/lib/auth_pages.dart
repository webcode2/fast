import 'package:flutter/material.dart';

import 'app_theme.dart';
import 'auth_api.dart';
import 'auth_art.dart';
import 'auth_form.dart';
import 'customer_home.dart';
import 'rider_dispatch.dart';
import 'signup_pages.dart';
import 'ui_kit.dart';

final authApi = AuthApi();

void openLogin(BuildContext context) =>
    Navigator.pushNamedAndRemoveUntil(context, '/login', (_) => false);

class LoginPage extends StatelessWidget {
  const LoginPage({super.key});

  @override
  Widget build(BuildContext context) => AuthPage(
    title: 'Welcome back',
    header: const Padding(
      padding: EdgeInsets.only(bottom: 20),
      child: SizedBox(height: 170, child: ScooterArt()),
    ),
    children: [
      AuthForm(
        button: 'Sign in',
        fields: const [emailField, passwordField],
        submit: (data) async {
          final result = await authApi.request(
            '/login',
            data: {...data, 'client': 'mobile'},
          );
          final token = result['token'] as String;
          await authApi.saveToken(token);
          if (context.mounted) {
            Navigator.pushNamedAndRemoveUntil(context, '/home', (_) => false);
          }
          return null;
        },
      ),
      TextButton(
        onPressed: () => Navigator.pushNamed(context, '/reset'),
        child: const Text('Forgot password?'),
      ),
      TextButton(
        onPressed: () => Navigator.pushNamed(context, '/recover'),
        child: const Text('Recover a deleted account'),
      ),
      TextButton(
        onPressed: () => Navigator.pushNamed(context, '/signup'),
        child: const Text('Create an account'),
      ),
    ],
  );
}

class RecoverAccountPage extends StatelessWidget {
  const RecoverAccountPage({super.key});

  @override
  Widget build(BuildContext context) => AuthPage(
    title: 'Recover account',
    children: [
      const Text(
        'You can recover your account within 30 days of requesting deletion.',
      ),
      const SizedBox(height: 16),
      AuthForm(
        button: 'Recover account',
        fields: const [emailField, passwordField],
        submit: (data) async {
          await authApi.request('/recover', data: data);
          return 'Account recovered. Return to sign in.';
        },
      ),
    ],
  );
}

class ResetPage extends StatelessWidget {
  const ResetPage({super.key});

  @override
  Widget build(BuildContext context) => AuthPage(
    title: 'Reset password',
    children: [
      AuthForm(
        button: 'Send reset code',
        fields: const [emailField],
        submit: (data) async {
          await authApi.request('/reset/request', data: data);
          return 'If the account has a verified email, a code will be sent.';
        },
      ),
      const SizedBox(height: 24),
      AuthForm(
        button: 'Reset password',
        fields: const [emailField, codeField, newPasswordField],
        submit: (data) async {
          await authApi.request('/reset', data: data);
          await authApi.clearToken();
          if (context.mounted) openLogin(context);
          return null;
        },
      ),
    ],
  );
}

/// Loads the signed-in profile and opens that role's map home.
class HomeEntry extends StatefulWidget {
  const HomeEntry({super.key});

  @override
  State<HomeEntry> createState() => _HomeEntryState();
}

class _HomeEntryState extends State<HomeEntry> {
  late Future<Map<String, dynamic>> _profile = _loadProfile(context);

  @override
  Widget build(BuildContext context) => FutureBuilder(
    future: _profile,
    builder: (context, snapshot) {
      if (snapshot.hasError) {
        return Scaffold(
          body: EmptyState(
            icon: Icons.wifi_off,
            text: 'Could not load your account.',
            action: 'Retry',
            onAction: () => setState(() => _profile = _loadProfile(context)),
          ),
        );
      }
      if (!snapshot.hasData) {
        return const Scaffold(body: Center(child: CircularProgressIndicator()));
      }
      final user = snapshot.requireData;
      return user['role'] == 'rider'
          ? RiderDispatchPage(user: user)
          : CustomerHomePage(user: user);
    },
  );
}

Future<Map<String, dynamic>> _loadProfile(BuildContext context) async {
  try {
    return (await authApi.request(
          '/profile',
          method: 'GET',
          authenticated: true,
        ))['user']
        as Map<String, dynamic>;
  } on AuthException catch (error) {
    if (error.status == 401) {
      await authApi.clearToken();
      if (context.mounted) openLogin(context);
    }
    rethrow;
  }
}

class AccountPage extends StatefulWidget {
  const AccountPage({super.key});

  @override
  State<AccountPage> createState() => _AccountPageState();
}

class _AccountPageState extends State<AccountPage> {
  late Future<Map<String, dynamic>> _profile = _loadProfile(context);

  void _refresh() => setState(() => _profile = _loadProfile(context));

  Future<String?> _signOut(String path, Map<String, String> data) async {
    try {
      await authApi.request(path, data: data, authenticated: true);
    } on AuthException catch (error) {
      if (path != '/logout' || error.status != 401) rethrow;
    }
    await authApi.clearToken();
    if (mounted) openLogin(context);
    return null;
  }

  void _editName() => showAppSheet<void>(
    context,
    title: 'Your name',
    builder: (sheet) => AuthForm(
      button: 'Save name',
      fields: const [AuthField('name', 'Name')],
      submit: (data) async {
        await authApi.request(
          '/profile',
          method: 'PATCH',
          data: data,
          authenticated: true,
        );
        if (mounted) _refresh();
        if (sheet.mounted) Navigator.pop(sheet);
        return null;
      },
    ),
  );

  void _verify(String purpose, Map<String, dynamic> user) => showAppSheet<void>(
    context,
    title: 'Verify $purpose',
    builder: (sheet) => VerificationSection(
      key: ValueKey(purpose),
      purpose: purpose,
      value: user[purpose] as String,
      verified: false,
      onVerified: () {
        if (mounted) _refresh();
        if (sheet.mounted) Navigator.pop(sheet);
      },
    ),
  );

  void _changePassword() => showAppSheet<void>(
    context,
    title: 'Change password',
    builder: (_) => AuthForm(
      button: 'Update password',
      fields: const [
        AuthField('currentPassword', 'Current password', secret: true),
        newPasswordField,
      ],
      submit: (data) => _signOut('/password', data),
    ),
  );

  void _chooseAppearance() => showAppSheet<void>(
    context,
    title: 'Appearance',
    padding: EdgeInsets.zero,
    builder: (sheet) => RadioGroup<ThemeMode>(
      groupValue: appearance.value,
      onChanged: (mode) {
        if (mode != null) saveAppearance(mode);
        Navigator.pop(sheet);
      },
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final (mode, label) in const [
            (ThemeMode.dark, 'Dark'),
            (ThemeMode.light, 'Light'),
            (ThemeMode.system, 'System default'),
          ])
            RadioListTile<ThemeMode>(value: mode, title: Text(label)),
        ],
      ),
    ),
  );

  Future<void> _confirmSignOut() async {
    try {
      await _signOut('/logout', const {});
    } on AuthException catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(error.message)));
      }
    }
  }

  String _appearanceLabel(ThemeMode mode) => switch (mode) {
    ThemeMode.dark => 'Dark',
    ThemeMode.light => 'Light',
    ThemeMode.system => 'System default',
  };

  @override
  Widget build(BuildContext context) => FutureBuilder(
    future: _profile,
    builder: (context, snapshot) {
      if (!snapshot.hasData) {
        return AuthPage(
          title: 'Settings',
          children: snapshot.hasError
              ? [
                  const Text('Could not load your account.'),
                  TextButton(onPressed: _refresh, child: const Text('Retry')),
                  TextButton(
                    onPressed: () => openLogin(context),
                    child: const Text('Go to sign in'),
                  ),
                ]
              : [const Center(child: CircularProgressIndicator())],
        );
      }
      final user = snapshot.requireData;
      Widget verification(String purpose, IconData icon, String title) {
        final verified = user['${purpose}_verified'] == true;
        return SettingsRow(
          icon: icon,
          title: title,
          value: '${user[purpose]} · ${verified ? 'Verified' : 'Unverified'}',
          onTap: verified ? null : () => _verify(purpose, user),
        );
      }

      return AuthPage(
        title: 'Settings',
        children: [
          SettingsGroup(
            children: [
              SettingsRow(
                icon: Icons.person_outline,
                title: 'Name',
                value: '${user['name']}',
                onTap: _editName,
              ),
              verification('email', Icons.mail_outline, 'Email'),
              verification('phone', Icons.phone_outlined, 'Phone'),
              SettingsRow(
                icon: Icons.lock_outline,
                title: 'Change password',
                onTap: _changePassword,
              ),
            ],
          ),
          SettingsGroup(
            children: [
              ValueListenableBuilder(
                valueListenable: appearance,
                builder: (context, mode, _) => SettingsRow(
                  icon: Icons.dark_mode_outlined,
                  title: 'Appearance',
                  value: _appearanceLabel(mode),
                  onTap: _chooseAppearance,
                ),
              ),
            ],
          ),
          SettingsGroup(
            children: [
              SettingsRow(
                icon: Icons.logout,
                title: 'Sign out',
                onTap: _confirmSignOut,
              ),
              SettingsRow(
                icon: Icons.delete_outline,
                title: 'Delete account',
                destructive: true,
                onTap: () => Navigator.pushNamed(context, '/delete-account'),
              ),
            ],
          ),
        ],
      );
    },
  );
}

class VerificationSection extends StatelessWidget {
  const VerificationSection({
    super.key,
    required this.purpose,
    required this.value,
    required this.verified,
    required this.onVerified,
  });

  final String purpose;
  final String value;
  final bool verified;
  final VoidCallback onVerified;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Text(
        '$value · ${verified ? 'Verified' : 'Unverified'}',
        style: Theme.of(context).textTheme.titleMedium,
      ),
      const SizedBox(height: 12),
      if (!verified) ...[
        AuthForm(
          button: 'Send $purpose code',
          submit: (_) async {
            await authApi.request(
              '/verify/request',
              data: {'purpose': purpose},
              authenticated: true,
            );
            return 'Verification code requested.';
          },
        ),
        const SizedBox(height: 16),
        AuthForm(
          button: 'Verify $purpose',
          fields: const [codeField],
          submit: (data) async {
            await authApi.request(
              '/verify',
              data: {...data, 'purpose': purpose},
              authenticated: true,
            );
            onVerified();
            return null;
          },
        ),
      ],
    ],
  );
}

class SessionEntry extends StatefulWidget {
  const SessionEntry({super.key});

  @override
  State<SessionEntry> createState() => _SessionEntryState();
}

class _SessionEntryState extends State<SessionEntry> {
  late final Future<String?> _session = authApi.token;

  @override
  Widget build(BuildContext context) => FutureBuilder(
    future: _session,
    builder: (context, snapshot) {
      if (snapshot.connectionState != ConnectionState.done) {
        return const Scaffold(body: Center(child: CircularProgressIndicator()));
      }
      if (snapshot.hasData) return const HomeEntry();
      return Theme(data: authTheme, child: const SignupChoice());
    },
  );
}

class DeleteAccountPage extends StatelessWidget {
  const DeleteAccountPage({super.key});

  @override
  Widget build(BuildContext context) => AuthPage(
    title: 'Delete account',
    children: [
      const Text(
        'Deletion signs you out immediately. You have 30 days to recover your account. '
        'After that, personal data moves to a restricted archive for 120 days before it is purged.',
      ),
      const SizedBox(height: 16),
      AuthForm(
        button: 'Schedule account deletion',
        fields: const [passwordField],
        submit: (data) async {
          await authApi.request('/delete', data: data, authenticated: true);
          await authApi.clearToken();
          if (context.mounted) openLogin(context);
          return null;
        },
      ),
    ],
  );
}
