import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import 'delivery_map.dart';
import 'places.dart';
import 'ui_kit.dart';

/// Move the map under a fixed pin, then confirm the named position.
class DeliveryPinPicker extends StatefulWidget {
  const DeliveryPinPicker({
    super.key,
    required this.label,
    this.selected,
    this.near,
  });

  final String label;
  final Place? selected;
  final LatLng? near;

  @override
  State<DeliveryPinPicker> createState() => _DeliveryPinPickerState();
}

class _DeliveryPinPickerState extends State<DeliveryPinPicker> {
  final _map = MapController();
  late LatLng _center = widget.selected?.point ?? widget.near ?? portHarcourt;
  late final _lookup = PlaceLookup((place) {
    if (mounted) setState(() => _place = place);
  });
  Place? _place;
  bool _confirming = false;

  @override
  void initState() {
    super.initState();
    _place = widget.selected;
    if (_place == null) _lookup.move(_center);
  }

  @override
  void dispose() {
    _lookup.dispose();
    _map.dispose();
    super.dispose();
  }

  void _moved(LatLng center) {
    _center = center;
    setState(() => _place = null);
    _lookup.move(center);
  }

  Future<void> _locate() async {
    try {
      final point = await deviceLocation(askPermission: true);
      if (!mounted) return;
      _map.move(point, 17);
      _moved(point);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not find your location.')),
        );
      }
    }
  }

  Future<void> _done() async {
    setState(() => _confirming = true);
    final place = _place ?? await placeAt(_center);
    if (mounted) Navigator.pop(context, place);
  }

  @override
  Widget build(BuildContext context) {
    final pickup = widget.label == 'Pickup';
    return Scaffold(
      body: Stack(
        fit: StackFit.expand,
        children: [
          DeliveryMap(
            controller: _map,
            center: _center,
            zoom: 17,
            onMoved: _moved,
            attributionPadding: const EdgeInsets.fromLTRB(16, 0, 88, 100),
          ),
          Center(
            child: FractionalTranslation(
              translation: const Offset(0, -.5),
              child: IgnorePointer(
                child: MapPin(
                  icon: pickup ? Icons.inventory_2 : Icons.flag,
                  semanticLabel: '${widget.label} pin',
                  title: _place?.name ?? 'Finding address…',
                ),
              ),
            ),
          ),
          SafeArea(
            minimum: const EdgeInsets.all(16),
            child: Stack(
              children: [
                Align(
                  alignment: Alignment.topLeft,
                  child: MapRoundButton(
                    icon: Icons.arrow_back,
                    tooltip: 'Back',
                    onPressed: () => Navigator.pop(context),
                  ),
                ),
                Align(
                  alignment: Alignment.bottomRight,
                  child: Padding(
                    padding: const EdgeInsets.only(bottom: 72),
                    child: MapRoundButton(
                      icon: Icons.near_me_outlined,
                      tooltip: 'Use my location',
                      onPressed: _locate,
                    ),
                  ),
                ),
                Align(
                  alignment: Alignment.bottomCenter,
                  child: SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      onPressed: _confirming ? null : _done,
                      child: Text(pickup ? 'Set pickup' : 'Set drop-off'),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Debounces map movement into one street-name lookup, dropping stale answers.
class PlaceLookup {
  PlaceLookup(this.onPlace);

  final void Function(Place) onPlace;
  Timer? _timer;
  int _latest = 0;

  void move(LatLng point) {
    _timer?.cancel();
    final request = ++_latest;
    _timer = Timer(const Duration(milliseconds: 500), () async {
      final place = await placeAt(point);
      if (request == _latest) onPlace(place);
    });
  }

  void dispose() {
    _timer?.cancel();
    _latest = -1;
  }
}
