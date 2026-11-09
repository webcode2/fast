import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'app_theme.dart';
import 'auth_api.dart';
import 'auth_art.dart';
import 'auth_form.dart';
import 'auth_pages.dart';
import 'ui_kit.dart';

const _resendSeconds = 30;
const _codeLength = 6;

/// Converts what people type next to the +234 prefix into international format.
String? normalizeNigerianPhone(String raw) {
  final value = raw.replaceAll(RegExp(r'[\s()-]'), '');
  if (RegExp(r'^\+[1-9]\d{7,14}$').hasMatch(value)) return value;
  if (RegExp(r'^234[789][01]\d{8}$').hasMatch(value)) return '+$value';
  if (RegExp(r'^0[789][01]\d{8}$').hasMatch(value)) {
    return '+234${value.substring(1)}';
  }
  if (RegExp(r'^[789][01]\d{8}$').hasMatch(value)) return '+234$value';
  return null;
}

typedef _Slide = ({Widget art, String title, String body});

List<_Slide> _slides(String role) => role == 'rider'
    ? const [
        (
          art: ScooterArt(
            chips: [
              ArtChip(
                alignment: Alignment(-.9, .75),
                icon: Icons.bolt,
                text: 'You are available',
              ),
            ],
          ),
          title: 'Deliver when it suits you',
          body: 'Go available when you want to work, and see parcels near you.',
        ),
        (
          art: RouteArt(
            chips: [
              ArtChip(
                alignment: Alignment(.9, .6),
                icon: Icons.payments_outlined,
                text: 'Your counteroffer',
              ),
            ],
          ),
          title: 'Agree a fare that works',
          body: 'Claim the customer’s offer as it is, or send your own price.',
        ),
      ]
    : const [
        (
          art: ScooterArt(
            chips: [
              ArtChip(
                alignment: Alignment(.9, .8),
                icon: Icons.sell_outlined,
                text: 'Your offer',
              ),
            ],
          ),
          title: 'You name the price',
          body: 'Offer a fare for your parcel and choose from riders nearby.',
        ),
        (
          art: RouteArt(
            chips: [
              ArtChip(
                alignment: Alignment(-.85, -.75),
                icon: Icons.near_me_outlined,
                text: 'Live tracking',
              ),
            ],
          ),
          title: 'Follow every delivery',
          body: 'See your rider on the map, and message or call from the app.',
        ),
      ];

class RegistrationPage extends StatefulWidget {
  const RegistrationPage({super.key, required this.role});

  final String role;

  @override
  State<RegistrationPage> createState() => _RegistrationPageState();
}

class _RegistrationPageState extends State<RegistrationPage> {
  final _pages = PageController();
  late final _steps = _slides(widget.role);
  int _step = 0;

  int get _total => _steps.length + 1;

  @override
  void dispose() {
    _pages.dispose();
    super.dispose();
  }

  void _go(int step) {
    if (MediaQuery.disableAnimationsOf(context)) {
      _pages.jumpToPage(step);
    } else {
      _pages.animateToPage(
        step,
        duration: const Duration(milliseconds: 280),
        curve: Curves.easeOutCubic,
      );
    }
  }

  Future<String?> _register(Map<String, String> data) async {
    final phone = normalizeNigerianPhone(data['phone'] ?? '');
    if (phone == null) {
      throw const AuthException(
        'Enter a valid phone number, like 0806 000 0000.',
      );
    }
    final navigator = Navigator.of(context);
    await authApi.request(
      '/register',
      data: {...data, 'phone': phone, 'role': widget.role},
    );
    // Registration answers the same for an email already in use, so a failed
    // sign-in sends people to the sign-in screen instead of revealing that.
    try {
      final result = await authApi.request(
        '/login',
        data: {
          'email': data['email'],
          'password': data['password'],
          'client': 'mobile',
        },
      );
      await authApi.saveToken(result['token'] as String);
    } on AuthException {
      if (mounted) openLogin(context);
      return null;
    }
    String? notice;
    try {
      await authApi.request(
        '/verify/request',
        data: {'purpose': 'phone'},
        authenticated: true,
      );
    } on AuthException catch (error) {
      notice = error.message;
    }
    await navigator.pushAndRemoveUntil(
      MaterialPageRoute<void>(
        builder: (_) => Theme(
          data: authTheme,
          child: VerifyPhonePage(phone: phone, notice: notice),
        ),
      ),
      (_) => false,
    );
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(4, 4, 16, 0),
              child: Row(
                children: [
                  BackButton(
                    onPressed: _step == 0
                        ? () => Navigator.maybePop(context)
                        : () => _go(_step - 1),
                  ),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Semantics(
                      label: 'Step ${_step + 1} of $_total',
                      child: Row(
                        spacing: 6,
                        children: [
                          for (var i = 0; i < _total; i++)
                            Expanded(
                              child: AnimatedContainer(
                                duration: const Duration(milliseconds: 200),
                                height: 5,
                                decoration: BoxDecoration(
                                  color: i <= _step
                                      ? colors.primary
                                      : colors.surfaceContainerHigh,
                                  borderRadius: BorderRadius.circular(3),
                                ),
                              ),
                            ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: Align(
                alignment: Alignment.topCenter,
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 560),
                  child: PageView(
                    controller: _pages,
                    onPageChanged: (step) => setState(() => _step = step),
                    children: [
                      for (final (index, slide) in _steps.indexed)
                        _SlideView(
                          slide: slide,
                          onContinue: () => _go(index + 1),
                          onSkip: () => _go(_steps.length),
                        ),
                      _RegisterForm(submit: _register),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SlideView extends StatelessWidget {
  const _SlideView({
    required this.slide,
    required this.onContinue,
    required this.onSkip,
  });

  final _Slide slide;
  final VoidCallback onContinue;
  final VoidCallback onSkip;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return FillOrScroll(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Expanded(
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 140),
              child: slide.art,
            ),
          ),
          const SizedBox(height: 16),
          Semantics(
            header: true,
            child: Text(
              slide.title,
              textAlign: TextAlign.center,
              style: theme.textTheme.headlineMedium,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            slide.body,
            textAlign: TextAlign.center,
            style: theme.textTheme.bodyLarge?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 24),
          FilledButton(onPressed: onContinue, child: const Text('Continue')),
          TextButton(onPressed: onSkip, child: const Text('Skip')),
        ],
      ),
    );
  }
}

class _RegisterForm extends StatelessWidget {
  const _RegisterForm({required this.submit});

  final Future<String?> Function(Map<String, String>) submit;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
      children: [
        const SizedBox(height: 140, child: RouteArt()),
        const SizedBox(height: 16),
        Semantics(
          header: true,
          child: Text(
            'Let’s get you started',
            style: theme.textTheme.headlineMedium,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          'Enter your details to create your account.',
          style: TextStyle(color: theme.colorScheme.onSurfaceVariant),
        ),
        const SizedBox(height: 20),
        AuthForm(
          button: 'Create account',
          fields: const [
            AuthField('name', 'Name', autofill: [AutofillHints.name]),
            AuthField(
              'phone',
              'Phone number',
              keyboard: TextInputType.phone,
              prefixText: '+234  ',
              autofill: [AutofillHints.telephoneNumberNational],
            ),
            emailField,
            AuthField(
              'password',
              'Password (at least 12 characters)',
              secret: true,
              autofill: [AutofillHints.newPassword],
            ),
          ],
          submit: submit,
        ),
        const SizedBox(height: 4),
        TextButton(
          onPressed: () => Navigator.pushNamed(context, '/login'),
          child: const Text('I already have an account'),
        ),
      ],
    );
  }
}

class VerifyPhonePage extends StatefulWidget {
  const VerifyPhonePage({super.key, required this.phone, this.notice});

  final String phone;
  final String? notice;

  @override
  State<VerifyPhonePage> createState() => _VerifyPhonePageState();
}

class _VerifyPhonePageState extends State<VerifyPhonePage> {
  final _code = TextEditingController();
  Timer? _timer;
  late String? _notice = widget.notice;
  int _wait = _resendSeconds;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _startCountdown();
  }

  @override
  void dispose() {
    _timer?.cancel();
    _code.dispose();
    super.dispose();
  }

  void _startCountdown() {
    _timer?.cancel();
    setState(() => _wait = _resendSeconds);
    _timer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (_wait <= 1) timer.cancel();
      setState(() => _wait--);
    });
  }

  void _home() =>
      Navigator.pushNamedAndRemoveUntil(context, '/home', (_) => false);

  Future<void> _verify() async {
    setState(() {
      _busy = true;
      _notice = null;
    });
    try {
      await authApi.request(
        '/verify',
        data: {'purpose': 'phone', 'code': _code.text},
        authenticated: true,
      );
      if (mounted) _home();
    } on AuthException catch (error) {
      if (mounted) setState(() => _notice = error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _resend() async {
    _startCountdown();
    try {
      await authApi.request(
        '/verify/request',
        data: {'purpose': 'phone'},
        authenticated: true,
      );
      if (mounted) setState(() => _notice = 'We sent you a new code.');
    } on AuthException catch (error) {
      if (mounted) setState(() => _notice = error.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    return Scaffold(
      body: SafeArea(
        child: Align(
          alignment: Alignment.topCenter,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 560),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 32, 20, 24),
              children: [
                Semantics(
                  header: true,
                  child: Text(
                    'Verify phone number',
                    style: theme.textTheme.headlineMedium,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  'Enter the 6-digit code we sent to ${widget.phone}.',
                  style: TextStyle(color: colors.onSurfaceVariant),
                ),
                const SizedBox(height: 28),
                CodeBoxes(
                  controller: _code,
                  enabled: !_busy,
                  onChanged: () => setState(() {}),
                ),
                if (_notice case final notice?) ...[
                  const SizedBox(height: 12),
                  Notice(notice),
                ],
                const SizedBox(height: 16),
                Center(
                  child: _wait > 0
                      ? Text(
                          'Resend code in ${_wait}s',
                          style: TextStyle(color: colors.onSurfaceVariant),
                        )
                      : TextButton(
                          onPressed: _resend,
                          child: const Text('Resend code'),
                        ),
                ),
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: _busy || _code.text.length < _codeLength
                      ? null
                      : _verify,
                  child: const Text('Verify code'),
                ),
                TextButton(
                  onPressed: _busy ? null : _home,
                  child: const Text('Verify later'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Six digit boxes over one real text field, so paste, SMS autofill, and screen
/// readers all keep working.
class CodeBoxes extends StatelessWidget {
  const CodeBoxes({
    super.key,
    required this.controller,
    required this.onChanged,
    this.enabled = true,
  });

  final TextEditingController controller;
  final VoidCallback onChanged;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final text = controller.text;
    return Stack(
      children: [
        ExcludeSemantics(
          child: Row(
            spacing: 8,
            children: [
              for (var i = 0; i < _codeLength; i++)
                Expanded(
                  child: Container(
                    height: 60,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(
                        color: i == text.length
                            ? colors.primary
                            : colors.outlineVariant,
                        width: i == text.length ? 2 : 1,
                      ),
                    ),
                    child: Text(
                      i < text.length ? text[i] : '',
                      style: theme.textTheme.headlineSmall,
                    ),
                  ),
                ),
            ],
          ),
        ),
        Positioned.fill(
          child: Opacity(
            opacity: 0,
            child: TextField(
              controller: controller,
              enabled: enabled,
              autofocus: true,
              showCursor: false,
              enableInteractiveSelection: true,
              keyboardType: TextInputType.number,
              autofillHints: const [AutofillHints.oneTimeCode],
              maxLength: _codeLength,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              onChanged: (_) => onChanged(),
              decoration: const InputDecoration(
                labelText: 'Six-digit code',
                counterText: '',
              ),
            ),
          ),
        ),
      ],
    );
  }
}
