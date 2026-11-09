import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:latlong2/latlong.dart';
import 'package:url_launcher/url_launcher.dart';

import 'arrival_alerts.dart';
import 'auth_api.dart';
import 'booking_api.dart';
import 'booking_widgets.dart';
import 'delivery_map.dart';
import 'rider_trip_actions.dart';
import 'rider_trip_location.dart';
import 'trip_comms.dart';
import 'trip_route.dart';
import 'ui_kit.dart';

class RiderTripPage extends StatefulWidget {
  const RiderTripPage({super.key, required this.tripId});

  final String tripId;

  @override
  State<RiderTripPage> createState() => _RiderTripPageState();
}

class _RiderTripPageState extends State<RiderTripPage> {
  Map<String, dynamic>? _trip;
  Timer? _timer;
  String? _notice;
  bool _busy = false;
  bool _offline = false;
  bool _locationBusy = false;
  String? _locationStatus;
  late final _location = RiderTripLocation(widget.tripId, (status) {
    if (mounted) setState(() => _locationStatus = status);
  }, onPosition: _positionChanged);

  late final _route = TripRouteFollower(widget.tripId);
  bool _rerouted = false;
  final _arrivals = ArrivalTracker();

  String get _path => '/trips/${widget.tripId}';

  @override
  void initState() {
    super.initState();
    unawaited(_refresh());
  }

  @override
  void dispose() {
    _timer?.cancel();
    unawaited(_location.close());
    _clearAlerts();
    super.dispose();
  }

  Future<void> _refresh() async {
    try {
      final result = await bookingRequest(_path);
      if (!mounted) return;
      final trip = result['trip'] as Map<String, dynamic>;
      if (!['assigned', 'picked_up'].contains(trip['status']) &&
          _location.active) {
        await _location.stop();
      }
      if (!['assigned', 'picked_up'].contains(trip['status'])) _clearAlerts();
      final rerouted = await _route.sync(trip['routeUpdatedAt'] as String?);
      if (!mounted) return;
      if (!_busy) {
        setState(() {
          _trip = trip;
          _offline = false;
          if (rerouted) _rerouted = true;
        });
        _announceArrival(trip['atStop'] as String?);
      }
    } on AuthException catch (error) {
      if (!mounted) return;
      if (error.status == 401 || error.status == 404) {
        await _location.close();
        if (!mounted) return;
        setState(() {
          _trip = null;
          _notice = error.message;
        });
        return;
      }
      setState(() => _offline = true);
    }
    if (mounted &&
        (_trip == null ||
            ['assigned', 'picked_up'].contains(_trip?['status']))) {
      _timer = Timer(const Duration(seconds: 3), _refresh);
    }
  }

  Future<void> _transition(String action) async {
    if (_busy) return;
    if (action == 'complete') {
      final confirm = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('End this trip?'),
          content: const Text(
            'Confirm that you handed the parcel to the recipient.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Back'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('End trip'),
            ),
          ],
        ),
      );
      if (confirm != true || !mounted) return;
    }
    setState(() {
      _busy = true;
      _notice = null;
    });
    try {
      final result = await bookingRequest('$_path/$action', method: 'POST');
      if (action == 'complete') await _location.close();
      if (action == 'pickup') {
        _clearAlert('pickup');
      } else {
        _clearAlerts();
      }
      if (mounted) {
        setState(() => _trip = result['trip'] as Map<String, dynamic>);
      }
    } on AuthException catch (error) {
      if (mounted) setState(() => _notice = error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _toggleLocation() async {
    setState(() => _locationBusy = true);
    try {
      if (_location.active) {
        await _location.stop();
        if (mounted) {
          setState(() => _locationStatus = 'Location sharing is off.');
        }
      } else {
        await _location.start();
      }
    } on AuthException catch (error) {
      if (mounted) setState(() => _locationStatus = error.message);
    } catch (_) {
      if (mounted) {
        setState(() => _locationStatus = 'Could not start location sharing.');
      }
    } finally {
      if (mounted) setState(() => _locationBusy = false);
    }
  }

  // Background GPS still arrives when the phone is locked and polling may not.
  void _positionChanged(LatLng position) {
    final trip = _trip;
    if (trip == null) return;
    _announceArrival(
      stopReached(
        trip['status'] as String?,
        position,
        pickup: _point(trip['pickup']),
        dropoff: _point(trip['dropoff']),
      ),
    );
  }

  void _announceArrival(String? stop) {
    if (!_arrivals.isNew(stop)) return;
    unawaited(HapticFeedback.heavyImpact());
    unawaited(SystemSound.play(SystemSoundType.alert));
    final lifecycle = WidgetsBinding.instance.lifecycleState;
    if (lifecycle != null && lifecycle != AppLifecycleState.resumed) {
      unawaited(ArrivalAlerts.show(widget.tripId, stop!).catchError((_) {}));
    }
  }

  void _clearAlert(String stop) =>
      unawaited(ArrivalAlerts.cancel(stop).catchError((_) {}));

  void _clearAlerts() =>
      unawaited(ArrivalAlerts.cancelAll().catchError((_) {}));

  void _openComms({bool call = false}) => Navigator.of(context).push(
    MaterialPageRoute<void>(
      builder: (_) => TripCommsPage(tripId: widget.tripId, startCall: call),
    ),
  );

  void _message(String text) =>
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));

  Future<void> _open(Uri uri, String failure) async {
    final opened = await launchUrl(
      uri,
      mode: LaunchMode.externalApplication,
    ).catchError((_) => false);
    if (!opened && mounted) _message(failure);
  }

  void _navigate() {
    final stop = _point(
      _trip?[_trip?['status'] == 'picked_up' ? 'dropoff' : 'pickup'],
    );
    if (stop == null) return;
    unawaited(
      _open(
        Uri.https('www.google.com', '/maps/dir/', {
          'api': '1',
          'destination': '${stop.latitude},${stop.longitude}',
          'travelmode': 'two-wheeler',
        }),
        'Could not open Google Maps.',
      ),
    );
  }

  Future<bool> _confirm(String title, String body, String action) async =>
      await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(title),
          content: Text(body),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Back'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: Text(action),
            ),
          ],
        ),
      ) ==
      true;

  Future<void> _cancel() async {
    final pickedUp = _trip?['status'] == 'picked_up';
    final confirmed = await _confirm(
      pickedUp ? 'Ask support to step in?' : 'Cancel this delivery?',
      pickedUp
          ? 'Keep the parcel safe. Support will contact you about what to do next.'
          : 'The order goes back to other riders. Cancelling twice in 24 hours delays your access to new orders.',
      pickedUp ? 'Ask support' : 'Cancel delivery',
    );
    if (!confirmed || !mounted) return;
    try {
      final result = await bookingRequest('$_path/cancel', method: 'POST');
      if (!mounted) return;
      if (result['status'] == 'support_requested') {
        _message('Support has been asked to step in.');
      } else {
        Navigator.pop(context);
      }
    } on AuthException catch (error) {
      if (mounted) _message(error.message);
    }
  }

  Future<void> _customerUnavailable() async {
    final confirmed = await _confirm(
      'End trip: customer not available?',
      'Only do this after trying to call and message the customer.',
      'End trip',
    );
    if (!confirmed || !mounted) return;
    try {
      await bookingRequest('$_path/no-show', method: 'POST');
      if (mounted) Navigator.pop(context);
    } on AuthException catch (error) {
      if (mounted) _message(error.message);
    }
  }

  void _report() => showAppSheet<void>(
    context,
    title: 'Report a problem',
    builder: (sheet) => ReportIssueForm(
      tripId: widget.tripId,
      onSent: () {
        Navigator.pop(sheet);
        _message('Report sent to support.');
      },
    ),
  );

  void _moreActions() {
    final eligible = _trip?['noShowEligibleAt'] as String?;
    void run(BuildContext sheet, VoidCallback action) {
      Navigator.pop(sheet);
      action();
    }

    showAppSheet<void>(
      context,
      title: 'More actions',
      padding: EdgeInsets.zero,
      builder: (sheet) => RiderTripActions(
        status: _trip?['status'] as String?,
        noShowEligibleAt: eligible == null ? null : DateTime.tryParse(eligible),
        onCall: () => run(sheet, () => _openComms(call: true)),
        onMessage: () => run(sheet, _openComms),
        onNavigate: () => run(sheet, _navigate),
        onReport: () => run(sheet, _report),
        onCustomerUnavailable: () => run(sheet, _customerUnavailable),
        onCancel: () => run(sheet, _cancel),
        onEmergency: () => run(
          sheet,
          () => _open(
            Uri(scheme: 'tel', path: '112'),
            'Could not start the call. Dial 112.',
          ),
        ),
      ),
    );
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
    final pickup = _point(trip?['pickup']);
    final dropoff = _point(trip?['dropoff']);
    final rider = _point(
      (trip?['riderLocation'] as Map?)?.cast<String, Object?>(),
    );
    final active = ['assigned', 'picked_up'].contains(trip?['status']);
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
                  rider: active ? rider : null,
                  path: active ? routeAhead(_route.path, rider) : const [],
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
                            if (active)
                              MapRoundButton(
                                icon: Icons.more_horiz,
                                tooltip: 'More actions',
                                onPressed: _moreActions,
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
          DockedPanel(child: _panel(context)),
        ],
      ),
    );
  }

  Widget _panel(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final trip = _trip;
    final status = trip?['status'] as String?;
    final paymentPending = trip?['paymentPending'] == true;
    final active = status == 'assigned' || status == 'picked_up';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_notice != null || _offline)
          Notice(_notice ?? 'Connection interrupted. Retrying…'),
        if (trip == null && _notice == null && !_offline)
          const Center(child: CircularProgressIndicator()),
        if (trip?['atStop'] case final String stop)
          ArrivalCard(
            stop: stop,
            place:
                trip?[stop == 'pickup' ? 'pickupLabel' : 'dropoffLabel']
                    as String?,
            onCall: _offline ? null : () => _openComms(call: true),
            onMessage: () => _openComms(),
          ),
        if (trip != null) ...[
          Semantics(
            liveRegion: true,
            child: Text(
              deliveryStatusLabel(status),
              style: theme.textTheme.titleLarge,
            ),
          ),
          const SizedBox(height: 4),
          if (trip['agreedFareKobo'] case final int fare)
            Text(
              'Agreed fare ${displayFare(fare)}',
              style: theme.textTheme.titleMedium,
            ),
          if (trip['paymentMethod'] case final String method)
            Text(
              method == 'cash'
                  ? 'Collect cash from the customer.'
                  : 'Card payment',
              style: TextStyle(color: colors.onSurfaceVariant),
            ),
          const SizedBox(height: 12),
        ],
        if (active && _rerouted && trip?['atStop'] == null)
          const Notice(
            'You left the planned route. Follow the new road route on the map.',
            icon: Icons.alt_route,
          ),
        if (status == 'assigned') ...[
          if (paymentPending)
            const Notice('Waiting for the customer’s card payment.'),
          FilledButton(
            onPressed: _busy || _offline || paymentPending
                ? null
                : () => _transition('pickup'),
            child: const Text('Mark picked up'),
          ),
        ],
        if (status == 'picked_up')
          FilledButton(
            onPressed: _busy || _offline ? null : () => _transition('complete'),
            child: const Text('End trip'),
          ),
        if (active) ...[
          const SizedBox(height: 8),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Share trip location'),
            subtitle: Text(
              _locationStatus ?? 'Shares your location with the customer for this trip, including while the app is in the background.',
              style: TextStyle(color: colors.onSurfaceVariant),
            ),
            value: _location.active,
            onChanged: _locationBusy || _busy ? null : (_) => _toggleLocation(),
          ),
          if (trip?['atStop'] == null)
            OutlinedButton.icon(
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => TripCommsPage(tripId: widget.tripId),
                ),
              ),
              icon: const Icon(Icons.chat_bubble_outline),
              label: const Text('Message customer'),
            ),
        ],
        if (status != null && !active) ...[
          const SizedBox(height: 4),
          FilledButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Done'),
          ),
        ],
      ],
    );
  }
}
