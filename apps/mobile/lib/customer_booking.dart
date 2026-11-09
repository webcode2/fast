import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:latlong2/latlong.dart';

import 'auth_api.dart';
import 'auth_form.dart';
import 'booking_api.dart';
import 'booking_payment_sheet.dart';
import 'booking_widgets.dart';
import 'customer_bids.dart';
import 'delivery_map.dart';
import 'places.dart';
import 'request_id.dart';
import 'trip_route.dart';
import 'ui_kit.dart';

class CustomerOrdersPage extends StatefulWidget {
  const CustomerOrdersPage({super.key});

  @override
  State<CustomerOrdersPage> createState() => _CustomerOrdersPageState();
}

const _historyFilters = {
  'All': <String>[],
  'In progress': ['pending_dispatch', 'assigned', 'picked_up'],
  'Delivered': ['completed'],
};

class _CustomerOrdersPageState extends State<CustomerOrdersPage> {
  late Future<Map<String, dynamic>> _orders = bookingRequest('/orders');
  String _filter = _historyFilters.keys.first;

  void _refresh() => setState(() => _orders = bookingRequest('/orders'));

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(
        backgroundColor: colors.surfaceContainerLow,
        actions: [
          IconButton(
            tooltip: 'Refresh deliveries',
            onPressed: _refresh,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
            decoration: BoxDecoration(
              color: colors.surfaceContainerLow,
              borderRadius: const BorderRadius.vertical(bottom: panelRadius),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const LargeTitle('Delivery history'),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final filter in _historyFilters.keys)
                      ChoiceChip(
                        label: Text(filter),
                        selected: filter == _filter,
                        showCheckmark: false,
                        side: BorderSide.none,
                        shape: const StadiumBorder(),
                        selectedColor: colors.onSurface,
                        backgroundColor: colors.surfaceContainerHigh,
                        labelStyle: TextStyle(
                          color: filter == _filter
                              ? colors.surface
                              : colors.onSurface,
                        ),
                        onSelected: (_) => setState(() => _filter = filter),
                      ),
                  ],
                ),
              ],
            ),
          ),
          Expanded(
            child: SafeArea(
              top: false,
              child: FutureBuilder(
                future: _orders,
                builder: (context, snapshot) {
                  if (snapshot.hasError) {
                    return EmptyState(
                      icon: Icons.wifi_off,
                      text: 'Could not load deliveries.',
                      action: 'Retry',
                      onAction: _refresh,
                    );
                  }
                  if (!snapshot.hasData) {
                    return const Center(child: CircularProgressIndicator());
                  }
                  final wanted = _historyFilters[_filter]!;
                  final orders = (snapshot.requireData['orders'] as List)
                      .where(
                        (order) =>
                            wanted.isEmpty || wanted.contains(order['status']),
                      )
                      .toList();
                  if (orders.isEmpty) {
                    return const EmptyState(
                      icon: Icons.inventory_2_outlined,
                      text: 'No deliveries here yet.',
                    );
                  }
                  return ListView(
                    padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
                    children: _rows(context, orders),
                  );
                },
              ),
            ),
          ),
        ],
      ),
    );
  }

  List<Widget> _rows(BuildContext context, List<dynamic> orders) {
    final localizations = MaterialLocalizations.of(context);
    final rows = <Widget>[];
    String? day;
    for (final raw in orders) {
      final order = raw as Map<String, dynamic>;
      final created = DateTime.tryParse(order['createdAt'] as String? ?? '')
          ?.toLocal();
      final label = created == null
          ? ''
          : localizations.formatMediumDate(created);
      if (label != day) {
        day = label;
        rows.add(
          Padding(
            padding: const EdgeInsets.fromLTRB(4, 12, 4, 4),
            child: Text(label, style: Theme.of(context).textTheme.titleMedium),
          ),
        );
      }
      rows.add(
        _HistoryRow(
          order: order,
          time: created == null
              ? ''
              : localizations.formatTimeOfDay(TimeOfDay.fromDateTime(created)),
          onTap: () async {
            await Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) =>
                    CustomerBidsPage(orderId: order['id'] as String),
              ),
            );
            if (mounted) _refresh();
          },
        ),
      );
    }
    return rows;
  }
}

class _HistoryRow extends StatelessWidget {
  const _HistoryRow({
    required this.order,
    required this.time,
    required this.onTap,
  });

  final Map<String, dynamic> order;
  final String time;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final status = order['status'] as String?;
    final failed = status == 'expired' || status == 'cancelled';
    final fare = order['agreedFareKobo'] ?? order['offeredFareKobo'];
    return Card(
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              Container(
                width: 56,
                height: 56,
                decoration: BoxDecoration(
                  color: colors.secondaryContainer,
                  borderRadius: BorderRadius.circular(14),
                ),
                child: const ExcludeSemantics(
                  child: Icon(Icons.inventory_2, color: Colors.white),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      deliveryStatusLabel(status),
                      style: TextStyle(
                        color: failed ? colors.error : colors.secondary,
                      ),
                    ),
                    Text(
                      order['dropoffLabel'] as String? ?? 'Parcel delivery',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.titleMedium,
                    ),
                    const SizedBox(height: 2),
                    Row(
                      children: [
                        Expanded(child: Text(time)),
                        if (fare is int) Text(displayFare(fare)),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class CustomerBookingPage extends StatefulWidget {
  const CustomerBookingPage({
    super.key,
    required this.pickup,
    required this.dropoff,
  });

  final Place pickup;
  final Place dropoff;

  @override
  State<CustomerBookingPage> createState() => _CustomerBookingPageState();
}

class _CustomerBookingPageState extends State<CustomerBookingPage> {
  bool _quoting = true;
  bool _sending = false;
  String? _quoteError;
  String? _sendError;
  bool _needsPhone = false;
  int? _floor;
  int? _distance;
  int? _offer;
  List<LatLng> _path = const [];
  String _method = 'cash';
  String? _lastPayload;
  String? _key;

  Map<String, double> _json(LatLng point) => {
    'latitude': point.latitude,
    'longitude': point.longitude,
  };

  @override
  void initState() {
    super.initState();
    unawaited(_quote());
  }

  Future<void> _quote() async {
    setState(() {
      _quoting = true;
      _quoteError = null;
    });
    try {
      final quote = await bookingRequest(
        '/orders/quote',
        method: 'POST',
        data: {
          'pickup': _json(widget.pickup.point),
          'dropoff': _json(widget.dropoff.point),
        },
      );
      if (!mounted) return;
      final floor = quote['fareFloorKobo'] as int;
      setState(() {
        _floor = floor;
        _distance = quote['distanceMeters'] as int;
        _offer = openingOffer(floor);
        _path = parseRoutePath(quote['path']);
      });
    } on AuthException catch (error) {
      if (mounted) setState(() => _quoteError = error.message);
    } finally {
      if (mounted) setState(() => _quoting = false);
    }
  }

  Future<void> _editOffer() async {
    final floor = _floor;
    if (floor == null) return;
    final offer = await showAppSheet<int>(
      context,
      title: 'Your offer',
      builder: (sheet) => AuthForm(
        button: 'Set offer',
        fields: const [
          AuthField(
            'fare',
            'Offer in naira',
            keyboard: TextInputType.numberWithOptions(decimal: true),
          ),
        ],
        submit: (data) async {
          final value = parseFareKobo(data['fare'] ?? '');
          if (value == null || value < floor) {
            throw AuthException(
              'Enter an offer of at least ${displayFare(floor)}.',
            );
          }
          if (sheet.mounted) Navigator.pop(sheet, value);
          return null;
        },
      ),
    );
    if (mounted && offer != null) setState(() => _offer = offer);
  }

  Future<void> _choosePayment() async {
    final selected = await chooseBookingPayment(context, _method);
    if (mounted && selected != null) setState(() => _method = selected);
  }

  Future<void> _findRiders() async {
    final payload = {
      'pickup': _json(widget.pickup.point),
      'dropoff': _json(widget.dropoff.point),
      'offeredFareKobo': _offer,
      'paymentMethod': _method,
      'pickupLabel': widget.pickup.name,
      'dropoffLabel': widget.dropoff.name,
    };
    final encoded = jsonEncode(payload);
    if (encoded != _lastPayload) {
      _lastPayload = encoded;
      _key = requestId();
    }
    setState(() {
      _sending = true;
      _sendError = null;
      _needsPhone = false;
    });
    try {
      final result = await bookingRequest(
        '/orders',
        method: 'POST',
        data: payload,
        idempotencyKey: _key,
      );
      if (!mounted) return;
      await Navigator.of(context).pushReplacement(
        MaterialPageRoute<void>(
          builder: (_) => CustomerBidsPage(
            orderId: result['order']['id'] as String,
            path: _path,
          ),
        ),
      );
    } on AuthException catch (error) {
      if (mounted) {
        setState(() {
          _sendError = error.message;
          _needsPhone = error.status == 403;
        });
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final distance = _distance;
    return Scaffold(
      body: Column(
        children: [
          MapRegion(
            child: Stack(
              fit: StackFit.expand,
              children: [
                DeliveryMap(
                  key: ValueKey(_path.length),
                  pickup: widget.pickup.point,
                  dropoff: widget.dropoff.point,
                  path: _path,
                ),
                SafeArea(
                  minimum: const EdgeInsets.all(12),
                  child: Padding(
                    padding: EdgeInsets.only(bottom: panelRadius.y + 4),
                    child: Column(
                      children: [
                        RouteCard(
                          pickup: widget.pickup.name,
                          dropoff: widget.dropoff.name,
                          detail: distance == null
                              ? null
                              : '${(distance / 1000).toStringAsFixed(1)} km',
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
          DockedPanel(child: _panel(context)),
        ],
      ),
    );
  }

  Widget _panel(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final floor = _floor;
    final offer = _offer;
    final payment = bookingPaymentMethods[_method]!;
    final distance = _distance;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        DecoratedBox(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(24),
            border: Border.all(color: colors.outlineVariant),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: colors.surfaceContainerHigh,
                  borderRadius: BorderRadius.circular(23),
                ),
                child: Row(
                  children: [
                    const ExcludeSemantics(
                      child: Icon(Icons.delivery_dining, size: 44),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Parcel', style: theme.textTheme.titleMedium),
                          Text(
                            distance == null
                                ? 'Bike delivery'
                                : 'Bike delivery · ${(distance / 1000).toStringAsFixed(1)} km by road',
                            style: TextStyle(color: colors.onSurfaceVariant),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(12),
                child: floor != null && offer != null
                    ? FareStepper(
                        offerKobo: offer,
                        floorKobo: floor,
                        onChanged: _sending
                            ? null
                            : (value) => setState(() => _offer = value),
                        onEdit: _sending ? null : _editOffer,
                      )
                    : _quoting
                    ? Semantics(
                        label: 'Getting your fare',
                        liveRegion: true,
                        child: Column(
                          children: [
                            const SizedBox(height: 8),
                            ClipRRect(
                              borderRadius: BorderRadius.circular(12),
                              child: const SizedBox(
                                width: 180,
                                height: 24,
                                child: LinearProgressIndicator(),
                              ),
                            ),
                            const SizedBox(height: 10),
                            Text(
                              'Getting your fare',
                              style: TextStyle(color: colors.onSurfaceVariant),
                            ),
                          ],
                        ),
                      )
                    : Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Notice(
                            _quoteError ?? 'Could not get a fare.',
                            icon: Icons.error_outline,
                          ),
                          TextButton(
                            onPressed: _quote,
                            child: const Text('Try again'),
                          ),
                        ],
                      ),
              ),
            ],
          ),
        ),
        if (_sendError case final error?) ...[
          const SizedBox(height: 8),
          Notice(error, icon: Icons.error_outline),
          if (_needsPhone)
            TextButton(
              onPressed: () => Navigator.pushNamed(context, '/account'),
              child: const Text('Verify your phone in settings'),
            ),
        ],
        const SizedBox(height: 12),
        const Divider(),
        const SizedBox(height: 12),
        Row(
          children: [
            IconButton(
              tooltip: 'Payment method: ${payment.label}',
              constraints: const BoxConstraints.tightFor(width: 56, height: 56),
              onPressed: _sending ? null : _choosePayment,
              icon: Icon(payment.icon, color: colors.secondary, size: 30),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: FilledButton(
                onPressed: offer == null || _sending ? null : _findRiders,
                child: Text(_sending ? 'Sending…' : 'Find riders'),
              ),
            ),
          ],
        ),
      ],
    );
  }
}
