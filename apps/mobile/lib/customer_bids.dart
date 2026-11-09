import 'dart:async';

import 'package:flutter/material.dart';
import 'package:latlong2/latlong.dart';
import 'package:url_launcher/url_launcher.dart';

import 'auth_api.dart';
import 'booking_api.dart';
import 'booking_payment_sheet.dart';
import 'booking_widgets.dart';
import 'customer_trip_tracking.dart';
import 'delivery_map.dart';
import 'trip_comms.dart';
import 'trip_feedback.dart';
import 'trip_route.dart';
import 'ui_kit.dart';

class CustomerBidsPage extends StatefulWidget {
  const CustomerBidsPage({
    super.key,
    required this.orderId,
    this.path = const [],
  });

  final String orderId;
  final List<LatLng> path;

  @override
  State<CustomerBidsPage> createState() => _CustomerBidsPageState();
}

class _CustomerBidsPageState extends State<CustomerBidsPage> {
  Timer? _timer;
  Map<String, dynamic>? _order;
  String? _notice;
  bool _busy = false;
  bool _offline = false;
  bool _paid = false;

  late final _route = TripRouteFollower(widget.orderId);

  String get _path => '/orders/${widget.orderId}';
  String get _paymentPath => '/trips/${widget.orderId}/payment';

  @override
  void initState() {
    super.initState();
    unawaited(_refresh());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _refresh() async {
    try {
      final result = await bookingRequest('$_path/bids');
      if (!mounted) return;
      final order = result['order'] as Map<String, dynamic>;
      if (widget.path.isEmpty && order['assignedRiderId'] != null) {
        await _route.sync(null);
        if (!mounted) return;
      }
      setState(() {
        _order = order;
        _offline = false;
      });
      if (![
        'pending_dispatch',
        'assigned',
        'picked_up',
      ].contains(order['status'])) {
        return;
      }
    } on AuthException catch (error) {
      if (!mounted) return;
      if (error.status == 401 || error.status == 404) {
        setState(() => _notice = error.message);
        return;
      }
      setState(() => _offline = true);
    }
    if (mounted) _timer = Timer(const Duration(seconds: 2), _refresh);
  }

  Future<void> _act(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _notice = null;
    });
    try {
      await action();
    } on AuthException catch (error) {
      if (mounted) setState(() => _notice = error.message);
    } catch (_) {
      if (mounted) setState(() => _notice = 'Could not complete the request.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _accept(Map<String, dynamic> bid) => _act(() async {
    final result = await bookingRequest(
      '$_path/accept',
      method: 'POST',
      data: {'bidId': bid['id'], 'fareKobo': bid['fareKobo']},
    );
    if (!mounted) return;
    final assignment = result['assignment'] as Map<String, dynamic>;
    setState(() => _order = {...?_order, ...assignment});
  });

  Future<void> _checkout() => _act(() async {
    final result = await bookingRequest(
      '$_paymentPath/checkout',
      method: 'POST',
    );
    if (!mounted) return;
    if (result['collected'] == true) {
      setState(() => _paid = true);
      return;
    }
    final raw = result['authorizationUrl'];
    final url = raw is String ? Uri.tryParse(raw) : null;
    if (url == null ||
        url.scheme != 'https' ||
        url.host != 'checkout.bachs.io' ||
        url.userInfo.isNotEmpty ||
        url.port != 443 ||
        !await launchUrl(url, mode: LaunchMode.externalApplication)) {
      throw const AuthException('Could not open Bachs checkout.');
    }
    if (mounted) {
      setState(() => _notice = 'After paying, return here and check payment.');
    }
  });

  Future<void> _verify() => _act(() async {
    final result = await bookingRequest('$_paymentPath/verify', method: 'POST');
    if (!mounted) return;
    setState(() {
      _paid = result['collected'] == true;
      _notice = _paid
          ? 'Payment confirmed.'
          : 'Waiting for Bachs to confirm payment.';
    });
  });

  Future<void> _review(Map<String, dynamic> bid) async {
    final order = _order;
    final fare = bid['fareKobo'] as int;
    final method = order?['paymentMethod'] as String? ?? 'cash';
    final confirmed = await showAppSheet<bool>(
      context,
      title: 'Confirm this rider',
      builder: (sheet) {
        final colors = Theme.of(sheet).colorScheme;
        Widget row(String label, String value) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 10),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  label,
                  style: TextStyle(color: colors.onSurfaceVariant),
                ),
              ),
              Flexible(
                child: Text(
                  value,
                  textAlign: TextAlign.end,
                  style: Theme.of(sheet).textTheme.titleMedium,
                ),
              ),
            ],
          ),
        );
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            row('Agreed fare', displayFare(fare)),
            const Divider(),
            row('Payment', bookingPaymentMethods[method]?.label ?? method),
            const Divider(),
            row(
              'Drop-off',
              order?['dropoffLabel'] as String? ?? 'Pinned location',
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: () => Navigator.pop(sheet, true),
              child: Text('Accept for ${displayFare(fare)}'),
            ),
          ],
        );
      },
    );
    if (confirmed == true && mounted) await _accept(bid);
  }

  LatLng? _point(Object? value) {
    if (value is! Map ||
        value['latitude'] is! num ||
        value['longitude'] is! num) {
      return null;
    }
    return LatLng(
      (value['latitude'] as num).toDouble(),
      (value['longitude'] as num).toDouble(),
    );
  }

  void _open(Widget page) =>
      Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => page));

  @override
  Widget build(BuildContext context) {
    final order = _order;
    final pickup = _point(order?['pickup']);
    final dropoff = _point(order?['dropoff']);
    return Scaffold(
      body: Column(
        children: [
          MapRegion(
            child: Stack(
              fit: StackFit.expand,
              children: [
                DeliveryMap(
                  key: ValueKey((pickup, _route.path.isEmpty)),
                  pickup: pickup,
                  dropoff: dropoff,
                  path: widget.path.isEmpty ? _route.path : widget.path,
                  interactive: pickup != null,
                ),
                SafeArea(
                  minimum: const EdgeInsets.all(12),
                  child: Padding(
                    padding: EdgeInsets.only(bottom: panelRadius.y + 4),
                    child: Column(
                      children: [
                        if (order != null)
                          RouteCard(
                            pickup:
                                order['pickupLabel'] as String? ??
                                'Pinned location',
                            dropoff:
                                order['dropoffLabel'] as String? ??
                                'Pinned location',
                          ),
                        const Spacer(),
                        Align(
                          alignment: Alignment.bottomLeft,
                          child: MapRoundButton(
                            icon: Icons.arrow_back,
                            tooltip: 'Back',
                            onPressed: () => Navigator.pop(context),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
          DockedPanel(child: _panel(order)),
        ],
      ),
    );
  }

  Widget _panel(Map<String, dynamic>? order) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final status = order?['status'] as String?;
    final bids = order?['bids'] as List? ?? [];
    final active = status == 'assigned' || status == 'picked_up';
    final agreed = order?['agreedFareKobo'];
    final offered = order?['offeredFareKobo'];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_notice != null || _offline)
          Notice(_notice ?? 'Connection interrupted. Retrying…'),
        if (order == null && _notice == null && !_offline)
          const Center(child: CircularProgressIndicator()),
        if (order != null) ...[
          Semantics(
            liveRegion: true,
            child: Text(
              deliveryStatusLabel(status),
              style: theme.textTheme.titleLarge,
            ),
          ),
          const SizedBox(height: 4),
          if (agreed is int)
            Text(
              'Agreed fare ${displayFare(agreed)}',
              style: TextStyle(color: colors.onSurfaceVariant),
            )
          else if (offered is int)
            Text(
              'Your offer ${displayFare(offered)}',
              style: TextStyle(color: colors.onSurfaceVariant),
            ),
        ],
        if (status == 'pending_dispatch') ...[
          const SizedBox(height: 12),
          ClipRRect(
            borderRadius: BorderRadius.circular(3),
            child: const LinearProgressIndicator(minHeight: 4),
          ),
          const SizedBox(height: 8),
          if (bids.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Text(
                'Nearby riders are seeing your request.',
                style: TextStyle(color: colors.onSurfaceVariant),
              ),
            ),
          for (final (index, raw) in bids.indexed)
            _OfferCard(
              fareKobo: raw['fareKobo'] as int,
              offeredKobo: offered is int ? offered : null,
              position: index + 1,
              onAccept: _busy || _offline
                  ? null
                  : () => _review(raw as Map<String, dynamic>),
            ),
        ],
        if (status == 'expired') ...[
          const SizedBox(height: 8),
          Text(
            'No rider accepted in time. Try again with a higher offer.',
            style: TextStyle(color: colors.onSurfaceVariant),
          ),
          const SizedBox(height: 12),
          FilledButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Back'),
          ),
        ],
        if (status == 'assigned' && order?['paymentMethod'] == 'digital') ...[
          const SizedBox(height: 12),
          if (_paid)
            const Notice('Card payment confirmed.', icon: Icons.check_circle)
          else ...[
            FilledButton(
              onPressed: _busy ? null : _checkout,
              child: const Text('Pay with Bachs'),
            ),
            TextButton(
              onPressed: _busy ? null : _verify,
              child: const Text('Check payment'),
            ),
          ],
        ],
        if (active) ...[
          const SizedBox(height: 12),
          FilledButton(
            onPressed: () =>
                _open(CustomerTripTrackingPage(tripId: widget.orderId)),
            child: const Text('Track delivery'),
          ),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: () => _open(TripCommsPage(tripId: widget.orderId)),
            icon: const Icon(Icons.chat_bubble_outline),
            label: const Text('Message rider'),
          ),
        ],
        if (status == 'completed') ...[
          const SizedBox(height: 12),
          FilledButton(
            onPressed: () => _open(TripFeedbackPage(tripId: widget.orderId)),
            child: const Text('Review or report'),
          ),
        ],
      ],
    );
  }
}

class _OfferCard extends StatelessWidget {
  const _OfferCard({
    required this.fareKobo,
    required this.offeredKobo,
    required this.position,
    required this.onAccept,
  });

  final int fareKobo;
  final int? offeredKobo;
  final int position;
  final VoidCallback? onAccept;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final matches = fareKobo == offeredKobo;
    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 12, 12),
        child: Row(
          children: [
            const ExcludeSemantics(
              child: Icon(Icons.delivery_dining, size: 36),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    displayFare(fareKobo),
                    style: theme.textTheme.titleLarge,
                  ),
                  Text(
                    matches
                        ? 'Rider $position · Your price'
                        : 'Rider $position',
                    style: TextStyle(color: colors.onSurfaceVariant),
                  ),
                ],
              ),
            ),
            FilledButton(
              style: FilledButton.styleFrom(minimumSize: const Size(0, 48)),
              onPressed: onAccept,
              child: const Text('Accept'),
            ),
          ],
        ),
      ),
    );
  }
}
