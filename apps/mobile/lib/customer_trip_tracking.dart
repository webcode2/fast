import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import 'auth_api.dart';
import 'booking_api.dart';
import 'booking_widgets.dart';
import 'delivery_map.dart';
import 'trip_comms.dart';
import 'trip_route.dart';
import 'ui_kit.dart';

class CustomerTripTrackingPage extends StatefulWidget {
  const CustomerTripTrackingPage({super.key, required this.tripId});

  final String tripId;

  @override
  State<CustomerTripTrackingPage> createState() =>
      _CustomerTripTrackingPageState();
}

class _CustomerTripTrackingPageState extends State<CustomerTripTrackingPage>
    with WidgetsBindingObserver {
  Timer? _timer;
  Map<String, dynamic>? _trip;
  String? _error;
  bool _offline = false;
  bool _reading = false;
  bool _foreground = true;
  bool _finished = false;
  final _map = MapController();
  late final _route = TripRouteFollower(widget.tripId);
  bool _rerouted = false;
  String? _announcedStop;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_refresh());
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

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _timer?.cancel();
    _map.dispose();
    super.dispose();
  }

  Future<void> _refresh() async {
    if (_reading || !_foreground || _finished || !mounted) return;
    _timer?.cancel();
    _reading = true;
    try {
      final result = await bookingRequest('/trips/${widget.tripId}');
      if (!mounted) return;
      final trip = result['trip'] as Map<String, dynamic>;
      final rerouted = await _route.sync(trip['routeUpdatedAt'] as String?);
      if (!mounted) return;
      setState(() {
        if (rerouted) _rerouted = true;
        final stop = trip['atStop'] as String?;
        if (stop != null && stop != _announcedStop) {
          _announcedStop = stop;
          unawaited(HapticFeedback.heavyImpact());
        }
        _trip = trip;
        _offline = false;
        _finished = !['assigned', 'picked_up'].contains(trip['status']);
      });
    } on AuthException catch (error) {
      if (!mounted) return;
      setState(() {
        if (error.status == 401 || error.status == 403 || error.status == 404) {
          _trip = null;
          _error = error.message;
          _finished = true;
        } else {
          _offline = true;
        }
      });
    } finally {
      _reading = false;
      if (mounted && _foreground && !_finished) {
        _timer = Timer(const Duration(seconds: 2), _refresh);
      }
    }
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

  @override
  Widget build(BuildContext context) {
    final trip = _trip;
    final location = trip?['riderLocation'] as Map?;
    final rider = _point(location);
    final time = DateTime.tryParse(location?['recordedAt'] as String? ?? '');
    final stale =
        time != null &&
        DateTime.now().difference(time) > const Duration(seconds: 30);
    final localizations = MaterialLocalizations.of(context);
    final updateTime = time == null
        ? null
        : localizations.formatTimeOfDay(
            TimeOfDay.fromDateTime(time.toLocal()),
            alwaysUse24HourFormat: MediaQuery.alwaysUse24HourFormatOf(context),
          );

    final pickup = _point(trip?['pickup']);
    final dropoff = _point(trip?['dropoff']);
    final riderStatus = trip?['trackingDropout'] == true
        ? 'Rider tracking interrupted.'
        : stale
        ? 'Rider location is out of date.'
        : rider == null
        ? 'Waiting for the rider to share their location.'
        : 'Rider location is live.';
    final ahead = routeAhead(_route.path, rider);
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    return Scaffold(
      body: Column(
        children: [
          MapRegion(
            child: Stack(
              fit: StackFit.expand,
              children: [
                DeliveryMap(
                  key: ValueKey((pickup, _route.path.isEmpty)),
                  controller: _map,
                  pickup: pickup,
                  dropoff: dropoff,
                  rider: _finished ? null : rider,
                  path: _finished ? const [] : ahead,
                ),
                SafeArea(
                  minimum: const EdgeInsets.all(12),
                  child: Padding(
                    padding: EdgeInsets.only(bottom: panelRadius.y + 4),
                    child: Column(
                      children: [
                        if (trip != null)
                          RouteCard(
                            pickup:
                                trip['pickupLabel'] as String? ??
                                'Pinned location',
                            dropoff:
                                trip['dropoffLabel'] as String? ??
                                'Pinned location',
                          ),
                        const Spacer(),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            MapRoundButton(
                              icon: Icons.arrow_back,
                              tooltip: 'Back',
                              onPressed: () => Navigator.pop(context),
                            ),
                            if (rider != null && !_finished)
                              MapRoundButton(
                                icon: Icons.near_me_outlined,
                                tooltip: 'Center on rider',
                                onPressed: () => _map.move(rider, 16),
                              ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
          DockedPanel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (_error != null) Notice(_error!),
                if (_offline)
                  const Notice('Connection interrupted. Reconnecting…'),
                if (trip == null && _error == null && !_offline)
                  const Center(child: CircularProgressIndicator()),
                if (trip != null) ...[
                  Semantics(
                    liveRegion: true,
                    child: Text(
                      deliveryStatusLabel(trip['status'] as String?),
                      style: theme.textTheme.titleLarge,
                    ),
                  ),
                  if (!_finished) ...[
                    const SizedBox(height: 4),
                    Semantics(
                      liveRegion: true,
                      child: Text(
                        updateTime == null
                            ? riderStatus
                            : '$riderStatus Updated $updateTime.',
                        style: TextStyle(color: colors.onSurfaceVariant),
                      ),
                    ),
                  ],
                  if (!_finished && ahead.length >= 2) ...[
                    const SizedBox(height: 4),
                    Text(
                      '${(routeMeters(ahead) / 1000).toStringAsFixed(1)} km left by road',
                      style: theme.textTheme.titleMedium,
                    ),
                  ],
                  if (trip['atStop'] case final String stop)
                    Notice(
                      stop == 'pickup'
                          ? 'Your rider has arrived at the pickup point.'
                          : 'Your rider has arrived at the drop-off.',
                      icon: Icons.place,
                    ),
                  if (!_finished && _rerouted && trip['atStop'] == null)
                    const Notice(
                      'Your rider left the planned route. Showing a new road route from where they are.',
                      icon: Icons.alt_route,
                    ),
                  if (trip['agreedFareKobo'] case final int fare) ...[
                    const SizedBox(height: 12),
                    Text(
                      'Agreed fare ${displayFare(fare)}',
                      style: theme.textTheme.titleMedium,
                    ),
                  ],
                  if (!_finished) ...[
                    const SizedBox(height: 12),
                    FilledButton.icon(
                      onPressed: () => Navigator.of(context).push(
                        MaterialPageRoute<void>(
                          builder: (_) => TripCommsPage(tripId: widget.tripId),
                        ),
                      ),
                      icon: const Icon(Icons.chat_bubble_outline),
                      label: const Text('Message rider'),
                    ),
                  ],
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
