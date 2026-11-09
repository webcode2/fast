import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import 'auth_api.dart';
import 'booking_api.dart';
import 'ui_kit.dart';

class CashCommissionPage extends StatefulWidget {
  const CashCommissionPage({super.key});

  @override
  State<CashCommissionPage> createState() => _CashCommissionPageState();
}

class _CashCommissionPageState extends State<CashCommissionPage>
    with WidgetsBindingObserver {
  final _api = AuthApi();
  late Future<Map<String, dynamic>> _balance = _load();
  String? _notice;
  bool _paying = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _refresh();
  }

  Future<Map<String, dynamic>> _load() => _api.request(
    '/cash-commission',
    prefix: '',
    method: 'GET',
    authenticated: true,
  );

  void _refresh() => setState(() => _balance = _load());

  String _amount(Object? value) {
    return displayNaira(BigInt.tryParse(value.toString()) ?? BigInt.zero);
  }

  Future<void> _pay() async {
    setState(() {
      _paying = true;
      _notice = null;
    });
    try {
      final result = await _api.request(
        '/cash-commission/checkout',
        prefix: '',
        authenticated: true,
      );
      if (!mounted) return;
      final url = result['authorizationUrl'];
      if (url == null && result['amountKobo'] == '0') {
        _refresh();
        return;
      }
      final uri = url is String ? Uri.tryParse(url) : null;
      if (uri == null ||
          uri.origin != 'https://checkout.bachs.io' ||
          uri.userInfo.isNotEmpty ||
          !await launchUrl(uri, mode: LaunchMode.externalApplication)) {
        throw const AuthException('Could not open Bachs checkout.');
      }
      if (mounted) {
        setState(
          () => _notice =
              'Refresh the balance after Bachs confirms your payment.',
        );
      }
    } on AuthException catch (error) {
      if (mounted) setState(() => _notice = error.message);
    } catch (_) {
      if (mounted) setState(() => _notice = 'Could not open Bachs checkout.');
    } finally {
      if (mounted) setState(() => _paying = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      actions: [
        IconButton(
          tooltip: 'Refresh balance',
          onPressed: _refresh,
          icon: const Icon(Icons.refresh),
        ),
      ],
    ),
    body: SafeArea(
      child: FutureBuilder(
        future: _balance,
        builder: (context, snapshot) {
          if (snapshot.hasError) {
            return EmptyState(
              icon: Icons.wifi_off,
              text: 'Could not load balance.',
              action: 'Retry',
              onAction: _refresh,
            );
          }
          if (!snapshot.hasData) {
            return const Center(child: CircularProgressIndicator());
          }
          final theme = Theme.of(context);
          final balance = snapshot.requireData;
          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
            children: [
              const LargeTitle('Cash commission'),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Outstanding',
                        style: TextStyle(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                      Text(
                        _amount(balance['outstandingKobo']),
                        style: theme.textTheme.headlineMedium,
                      ),
                      const SizedBox(height: 8),
                      Text('Overdue: ${_amount(balance['overdueKobo'])}'),
                    ],
                  ),
                ),
              ),
              Notice(
                balance['blocked'] == true
                    ? 'Settle overdue commission to receive new deliveries.'
                    : 'Cash commission is due at the end of the delivery day in Lagos.',
              ),
              const SizedBox(height: 12),
              if (balance['outstandingKobo'] != '0')
                FilledButton(
                  onPressed: _paying ? null : _pay,
                  child: const Text('Pay commission with Bachs'),
                ),
              if (_notice case final notice?) Notice(notice),
            ],
          );
        },
      ),
    ),
  );
}
