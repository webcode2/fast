import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import 'auth_api.dart';
import 'auth_form.dart';
import 'booking_api.dart';
import 'ui_kit.dart';

class RiderIdentityPage extends StatefulWidget {
  const RiderIdentityPage({super.key});

  @override
  State<RiderIdentityPage> createState() => _RiderIdentityPageState();
}

class _RiderIdentityPageState extends State<RiderIdentityPage>
    with WidgetsBindingObserver {
  Map<String, dynamic>? _data;
  String? _notice;
  bool _busy = false;
  bool _consent = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _load();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && !_busy) _load();
  }

  Future<void> _load({bool recheck = false}) => _run(() async {
    if (recheck && _data?['available'] == true) {
      await bookingRequest('/identity/rider/refresh', method: 'POST');
    }
    final data = await bookingRequest('/identity/rider');
    if (mounted) setState(() => _data = data);
  });

  Future<void> _run(Future<void> Function() work) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _notice = null;
    });
    try {
      await work();
    } on AuthException catch (error) {
      if (mounted) setState(() => _notice = error.message);
    } catch (_) {
      if (mounted) setState(() => _notice = 'Could not complete verification.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _start(String kind) => _run(() async {
    final result = await bookingRequest(
      '/identity/rider/start',
      method: 'POST',
      data: {'kind': kind, 'consent': _consent},
    );
    if (!mounted) return;
    final value = result['url'];
    final uri = value is String ? Uri.tryParse(value) : null;
    if (uri == null ||
        uri.scheme != 'https' ||
        uri.host != 'links.usesmileid.com' ||
        uri.port != 443 ||
        uri.userInfo.isNotEmpty ||
        !await launchUrl(uri, mode: LaunchMode.externalApplication)) {
      throw const AuthException('Could not open Smile ID verification.');
    }
    if (mounted) {
      setState(
        () => _notice =
            'Complete the check in Smile ID, then return and refresh.',
      );
    }
  });

  String _status(String? value) => switch (value) {
    'clear' => 'Passed',
    'pending' => 'In progress',
    'attention' => 'Under review',
    'expired' => 'Link expired',
    'block' => 'Check did not pass',
    'error' => 'Check could not complete',
    _ => 'Ready to start',
  };

  @override
  Widget build(BuildContext context) {
    final checks = <String, String>{
      for (final item in _data?['checks'] as List? ?? [])
        item['kind'] as String: item['status'] as String,
    };
    final approved = _data?['approved'] == true;
    final available = _data?['available'] == true;
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    return AuthPage(
      title: approved ? 'You are verified' : 'Verify it’s you',
      children: [
        const Center(child: SpotIllustration(icon: Icons.face)),
        const SizedBox(height: 24),
        if (_notice case final notice?) Notice(notice),
        if (_data == null && _busy)
          const Center(child: CircularProgressIndicator()),
        if (approved)
          const Text('Identity approved for dispatch.')
        else if (_data != null) ...[
          if (!available)
            const Notice('Hosted verification is temporarily unavailable.')
          else ...[
            const Text(
              'Smile ID collects your NIN, selfie, and driver licence. FAST receives the check results for staff review.',
            ),
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text(
                'I agree to continue to Smile ID for identity verification.',
              ),
              value: _consent,
              onChanged: _busy
                  ? null
                  : (value) => setState(() => _consent = value == true),
            ),
            for (final (kind, title) in [
              ('nin', 'NIN and selfie'),
              ('licence', 'Driver licence'),
            ])
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(title, style: theme.textTheme.titleMedium),
                      Text(
                        _status(checks[kind]),
                        style: TextStyle(color: colors.onSurfaceVariant),
                      ),
                      if (!['clear', 'attention'].contains(checks[kind])) ...[
                        const SizedBox(height: 12),
                        OutlinedButton(
                          onPressed: !_consent || _busy
                              ? null
                              : () => _start(kind),
                          child: Text(
                            checks[kind] == 'pending'
                                ? 'Resume $title'
                                : 'Open $title check',
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            if (checks['nin'] == 'clear' && checks['licence'] == 'clear')
              const Notice('Both checks passed. Waiting for staff approval.'),
          ],
        ],
        const SizedBox(height: 8),
        TextButton(
          onPressed: _busy ? null : () => _load(recheck: true),
          child: const Text('Refresh verification'),
        ),
      ],
    );
  }
}
