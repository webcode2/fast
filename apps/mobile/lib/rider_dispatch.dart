import 'dart:async';

import 'package:flutter/material.dart';
import 'package:latlong2/latlong.dart';

import 'app_drawer.dart';
import 'auth_api.dart';
import 'auth_form.dart';
import 'booking_api.dart';
import 'delivery_map.dart';
import 'rider_location.dart';
import 'rider_identity_page.dart';
import 'rider_trip.dart';
import 'ui_kit.dart';

class RiderDispatchPage extends StatefulWidget {
  const RiderDispatchPage({super.key, required this.user});

  final Map<String, dynamic> user;

  @override
  State<RiderDispatchPage> createState() => _RiderDispatchPageState();
}

class _RiderDispatchPageState extends State<RiderDispatchPage>
    with WidgetsBindingObserver {
  Timer? _timer;
  Future<void>? _heartbeat;
  Map<String, dynamic>? _status;
  List<dynamic> _orders = [];
  DateTime? _locationSentAt;
  LatLng? _position;
  String? _notice;
  bool _foreground = true;
  bool _refreshing = false;
  bool _busy = false;
  bool _stopped = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_refresh());
  }

  @override
  void dispose() {
    _timer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    if (_foreground) {
      unawaited(_refresh());
    } else {
      _timer?.cancel();
    }
  }

  Future<void> _sendAvailability(
    bool available, {
    bool askPermission = false,
  }) async {
    final location = available
        ? await riderLocation(askPermission: askPermission)
        : null;
    if (!mounted || available && !_foreground) return;
    await bookingRequest(
      '/dispatch/availability',
      method: 'PUT',
      data: {'available': available, 'location': ?location},
    );
    _locationSentAt = available ? DateTime.now() : null;
    if (location != null) {
      _position = LatLng(location['latitude']!, location['longitude']!);
    }
  }

  Future<void> _refresh() async {
    if (!mounted || !_foreground || _refreshing || _busy || _stopped) return;
    _timer?.cancel();
    _refreshing = true;
    try {
      final status = await bookingRequest('/dispatch/availability');
      if (!mounted || !_foreground || _busy) return;
      final online = status['available'] == true;
      String? locationIssue;
      final lastLocation = _locationSentAt;
      if (online &&
          (lastLocation == null ||
              DateTime.now().difference(lastLocation).inSeconds >= 30)) {
        try {
          // The rider already opted in. Only the explicit Go available action prompts for permission.
          _heartbeat = _sendAvailability(true);
          await _heartbeat;
        } catch (_) {
          locationIssue =
              'Could not refresh your location. Availability may expire.';
          _locationSentAt = DateTime.now();
        } finally {
          _heartbeat = null;
        }
      }
      if (!mounted || !_foreground || _busy) return;
      final nearby = online ? await bookingRequest('/dispatch/nearby') : null;
      if (!mounted || !_foreground || _busy) return;
      setState(() {
        _status = status;
        _orders = nearby?['orders'] as List? ?? [];
        _notice = locationIssue ?? _notice;
      });
    } on AuthException catch (error) {
      if (!mounted) return;
      if (error.status == 401 || error.status == 403) {
        _stopped = true;
      }
      setState(() {
        _orders = [];
        _notice = error.message;
      });
    } finally {
      _refreshing = false;
      if (mounted && _foreground && !_busy && !_stopped) {
        _timer = Timer(const Duration(seconds: 2), _refresh);
      }
    }
  }

  Future<void> _run(Future<void> Function() action) async {
    if (_busy) return;
    _timer?.cancel();
    setState(() {
      _busy = true;
      _notice = null;
    });
    try {
      await action();
    } on AuthException catch (error) {
      if (mounted) setState(() => _notice = error.message);
    } catch (_) {
      if (mounted) {
        setState(() => _notice = 'Could not complete the request. Try again.');
      }
    } finally {
      if (mounted) {
        setState(() => _busy = false);
        unawaited(_refresh());
      }
    }
  }

  Future<void> _changeAvailability(bool available) => _run(() async {
    await _heartbeat?.catchError((_) {});
    await _sendAvailability(available, askPermission: available);
  });

  Future<void> _openTrip(String id) => Navigator.of(context).push<void>(
    MaterialPageRoute<void>(builder: (_) => RiderTripPage(tripId: id)),
  );

  Future<void> _claim(String orderId) => _run(() async {
    final result = await bookingRequest(
      '/orders/$orderId/claim',
      method: 'POST',
    );
    if (mounted) {
      await _openTrip(result['assignment']['id'] as String);
    }
  });

  Future<void> _counteroffer(Map<String, dynamic> order) async {
    final floor = order['fareFloorKobo'] as int;
    await Navigator.of(context).push<void>(
      MaterialPageRoute<void>(
        builder: (pageContext) => AuthPage(
          title: 'Counteroffer',
          children: [
            Text('Minimum fare ${displayFare(floor)}'),
            const SizedBox(height: 12),
            AuthForm(
              button: 'Send counteroffer',
              fields: const [
                AuthField(
                  'fare',
                  'Counteroffer in naira',
                  keyboard: TextInputType.numberWithOptions(decimal: true),
                ),
              ],
              submit: (values) async {
                final fare = parseFareKobo(values['fare'] ?? '');
                if (fare == null || fare < floor) {
                  throw AuthException(
                    'Enter a fare of at least ${displayFare(floor)}.',
                  );
                }
                await bookingRequest(
                  '/orders/${order['id']}/bids',
                  method: 'POST',
                  data: {'fareKobo': fare},
                );
                if (mounted) setState(() => _notice = 'Counteroffer sent.');
                if (pageContext.mounted) Navigator.of(pageContext).pop();
                return null;
              },
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final position = _position;
    return Scaffold(
      drawer: AppDrawer(user: widget.user),
      body: Column(
        children: [
          MapRegion(
            child: Stack(
              fit: StackFit.expand,
              children: [
                DeliveryMap(
                  key: ValueKey(position == null),
                  center: position ?? portHarcourt,
                  rider: position,
                ),
                const SafeArea(
                  minimum: EdgeInsets.all(16),
                  child: Align(
                    alignment: Alignment.topLeft,
                    child: DrawerMapButton(),
                  ),
                ),
              ],
            ),
          ),
          DockedPanel(child: _panel(context)),
        ],
      ),
    );
  }

  Widget _panel(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final status = _status;
    final online = status?['available'] == true;
    final approved = status?['identityApproved'] == true;
    final overdue = status?['commissionOverdue'] == true;
    final tripId = status?['activeTripId'] as String?;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_notice != null) Notice(_notice!),
        if (status == null && _notice == null)
          const Center(child: CircularProgressIndicator()),
        if (status != null) ...[
          Semantics(
            liveRegion: true,
            child: Text(
              online ? 'You are available' : 'You are offline',
              style: theme.textTheme.titleLarge,
            ),
          ),
          const SizedBox(height: 4),
          if (!approved) ...[
            Text(
              'Verify your identity to start taking deliveries.',
              style: TextStyle(color: colors.onSurfaceVariant),
            ),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => const RiderIdentityPage(),
                ),
              ),
              child: const Text('Verify rider identity to go available'),
            ),
          ],
          if (overdue)
            const Notice(
              'Settle overdue cash commission from your account before accepting deliveries.',
              icon: Icons.warning_amber,
            ),
          if (tripId != null) ...[
            const SizedBox(height: 8),
            FilledButton(
              onPressed: _busy ? null : () => _run(() => _openTrip(tripId)),
              child: const Text('Open assigned delivery'),
            ),
          ] else if (approved && !overdue) ...[
            Text(
              'Going available shares your location while this screen is open.',
              style: TextStyle(color: colors.onSurfaceVariant),
            ),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: _busy || _stopped
                  ? null
                  : () => _changeAvailability(!online),
              child: Text(online ? 'Go unavailable' : 'Go available'),
            ),
          ],
        ],
        if (online) ...[
          const SizedBox(height: 16),
          Text('Nearby deliveries', style: theme.textTheme.titleMedium),
          const SizedBox(height: 4),
          if (_orders.isEmpty)
            Text(
              'No nearby deliveries available.',
              style: TextStyle(color: colors.onSurfaceVariant),
            ),
          for (final raw in _orders)
            RiderOfferCard(
              order: raw as Map<String, dynamic>,
              claim: _busy ? null : () => _claim(raw['id'] as String),
              counter: _busy ? null : () => _counteroffer(raw),
            ),
        ],
      ],
    );
  }
}

class RiderOfferCard extends StatelessWidget {
  const RiderOfferCard({
    super.key,
    required this.order,
    required this.claim,
    required this.counter,
  });

  final Map<String, dynamic> order;
  final VoidCallback? claim;
  final VoidCallback? counter;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final pickupMeters = order['pickupDistanceMeters'] as num;
    final tripMeters = order['distanceMeters'] as num;
    final payment = order['paymentMethod'];
    final pickup = order['pickupLabel'] as String?;
    final dropoff = order['dropoffLabel'] as String?;
    final counterButton = OutlinedButton(
      style: OutlinedButton.styleFrom(minimumSize: const Size(0, 48)),
      onPressed: counter,
      child: const Text('Counteroffer'),
    );
    final claimButton = FilledButton(
      style: FilledButton.styleFrom(minimumSize: const Size(0, 48)),
      onPressed: claim,
      child: const Text('Claim'),
    );
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Wrap(
              alignment: WrapAlignment.spaceBetween,
              crossAxisAlignment: WrapCrossAlignment.center,
              spacing: 8,
              children: [
                Text(
                  displayFare(order['offeredFareKobo'] as int),
                  style: theme.textTheme.headlineSmall,
                ),
                if (payment == 'cash' || payment == 'digital')
                  Text(
                    payment == 'cash' ? 'Cash' : 'Card payment',
                    style: TextStyle(color: colors.secondary),
                  ),
              ],
            ),
            const SizedBox(height: 4),
            if (pickup != null)
              Text(pickup, maxLines: 1, overflow: TextOverflow.ellipsis),
            if (dropoff != null)
              Text('to $dropoff', maxLines: 1, overflow: TextOverflow.ellipsis),
            Text(
              '${(pickupMeters / 1000).toStringAsFixed(1)} km to pickup · ${(tripMeters / 1000).toStringAsFixed(1)} km trip',
              style: TextStyle(color: colors.onSurfaceVariant),
            ),
            const SizedBox(height: 12),
            if (MediaQuery.textScalerOf(context).scale(1) > 1.3) ...[
              counterButton,
              const SizedBox(height: 8),
              claimButton,
            ] else
              Row(
                children: [
                  Expanded(child: counterButton),
                  const SizedBox(width: 8),
                  Expanded(child: claimButton),
                ],
              ),
          ],
        ),
      ),
    );
  }
}
