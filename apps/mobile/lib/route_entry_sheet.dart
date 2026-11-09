import 'dart:async';

import 'package:flutter/material.dart';
import 'package:latlong2/latlong.dart';

import 'booking_widgets.dart';
import 'delivery_pin_picker.dart';
import 'places.dart';
import 'ui_kit.dart';

typedef RouteChoice = ({Place pickup, Place dropoff});

Future<RouteChoice?> showRouteEntry(
  BuildContext context, {
  Place? pickup,
  required LatLng near,
}) => showModalBottomSheet<RouteChoice>(
  context: context,
  isScrollControlled: true,
  useSafeArea: true,
  builder: (_) => RouteEntrySheet(pickup: pickup, near: near),
);

class RouteEntrySheet extends StatefulWidget {
  const RouteEntrySheet({super.key, this.pickup, required this.near});

  final Place? pickup;
  final LatLng near;

  @override
  State<RouteEntrySheet> createState() => _RouteEntrySheetState();
}

class _RouteEntrySheetState extends State<RouteEntrySheet> {
  late final _from = TextEditingController(text: widget.pickup?.name);
  final _to = TextEditingController();
  final _fromFocus = FocusNode();
  final _toFocus = FocusNode();
  late Place? _pickup = widget.pickup;
  Place? _dropoff;
  bool _editingPickup = false;
  Timer? _debounce;
  int _search = 0;
  String _query = '';
  List<Place> _results = const [];
  bool _searching = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _fromFocus.addListener(_focusChanged);
    _toFocus.addListener(_focusChanged);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) (_pickup == null ? _fromFocus : _toFocus).requestFocus();
    });
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _from.dispose();
    _to.dispose();
    _fromFocus.dispose();
    _toFocus.dispose();
    super.dispose();
  }

  void _focusChanged() {
    if (!_fromFocus.hasFocus && !_toFocus.hasFocus) return;
    final editingPickup = _fromFocus.hasFocus;
    if (editingPickup == _editingPickup) return;
    setState(() {
      _editingPickup = editingPickup;
      _results = const [];
      _query = '';
      _error = null;
    });
  }

  void _changed(String text) {
    _debounce?.cancel();
    final query = text.trim();
    final request = ++_search;
    if (_editingPickup) {
      _pickup = null;
    } else {
      _dropoff = null;
    }
    if (query.length < 2) {
      setState(() {
        _results = const [];
        _query = query;
        _searching = false;
        _error = null;
      });
      return;
    }
    setState(() => _searching = true);
    _debounce = Timer(const Duration(milliseconds: 300), () async {
      try {
        final results = await searchPlaces(query, near: widget.near);
        if (!mounted || request != _search) return;
        setState(() {
          _results = results;
          _query = query;
          _searching = false;
          _error = null;
        });
      } catch (_) {
        if (!mounted || request != _search) return;
        setState(() {
          _searching = false;
          _error = 'Could not search places. Check your connection.';
        });
      }
    });
  }

  void _select(Place place) {
    setState(() {
      if (_editingPickup) {
        _pickup = place;
        _from.text = place.name;
      } else {
        _dropoff = place;
        _to.text = place.name;
      }
      _results = const [];
      _query = '';
    });
    final pickup = _pickup;
    final dropoff = _dropoff;
    if (pickup != null && dropoff != null) {
      Navigator.pop<RouteChoice>(context, (pickup: pickup, dropoff: dropoff));
    } else {
      (pickup == null ? _fromFocus : _toFocus).requestFocus();
    }
  }

  Future<void> _pickOnMap(bool pickup) async {
    final place = await Navigator.of(context).push<Place>(
      MaterialPageRoute(
        builder: (_) => DeliveryPinPicker(
          label: pickup ? 'Pickup' : 'Drop-off',
          selected: pickup ? _pickup : _dropoff,
          near: _pickup?.point ?? widget.near,
        ),
      ),
    );
    if (!mounted || place == null) return;
    _editingPickup = pickup;
    _select(place);
  }

  Widget _field({
    required String label,
    required IconData icon,
    required TextEditingController controller,
    required FocusNode focus,
    required bool pickup,
  }) => Padding(
    padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
    child: TextField(
      controller: controller,
      focusNode: focus,
      onChanged: _changed,
      textInputAction: TextInputAction.search,
      style: Theme.of(context).textTheme.titleMedium,
      decoration: InputDecoration(
        labelText: label,
        prefixIcon: ExcludeSemantics(child: Icon(icon)),
        suffixIcon: IconButton(
          tooltip: 'Choose ${label.toLowerCase()} on map',
          onPressed: () => _pickOnMap(pickup),
          icon: const Icon(Icons.map_outlined),
        ),
      ),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final origin = _pickup?.point ?? widget.near;
    final canSearch = _query.length >= 2;
    return SizedBox(
      height: MediaQuery.sizeOf(context).height * .92,
      child: Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.viewInsetsOf(context).bottom,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const SheetHeader(title: 'Enter your route'),
            _field(
              label: 'From',
              icon: Icons.search,
              controller: _from,
              focus: _fromFocus,
              pickup: true,
            ),
            _field(
              label: 'To',
              icon: Icons.flag_outlined,
              controller: _to,
              focus: _toFocus,
              pickup: false,
            ),
            SizedBox(
              height: 2,
              child: _searching ? const LinearProgressIndicator() : null,
            ),
            Expanded(
              child: _error != null
                  ? EmptyState(icon: Icons.wifi_off, text: _error!)
                  : canSearch && _results.isEmpty && !_searching
                  ? const EmptyState(
                      icon: Icons.search_off,
                      text: 'No places found. Try another name or use the map.',
                    )
                  : ListView.builder(
                      itemCount: _results.length,
                      itemBuilder: (context, index) {
                        final place = _results[index];
                        final km =
                            const Distance().as(
                              LengthUnit.Meter,
                              origin,
                              place.point,
                            ) /
                            1000;
                        return ListTile(
                          minTileHeight: 68,
                          leading: ExcludeSemantics(
                            child: Icon(
                              Icons.location_on_outlined,
                              color: colors.onSurfaceVariant,
                            ),
                          ),
                          title: Text.rich(
                            TextSpan(
                              children: highlightMatch(
                                place.name,
                                _query,
                                TextStyle(color: colors.secondary),
                              ),
                            ),
                            style: theme.textTheme.titleMedium,
                          ),
                          subtitle: place.detail.isEmpty
                              ? null
                              : Text(
                                  place.detail,
                                  style: TextStyle(
                                    color: colors.onSurfaceVariant,
                                  ),
                                ),
                          trailing: Text(
                            '${km.toStringAsFixed(1)} km',
                            style: TextStyle(color: colors.onSurfaceVariant),
                          ),
                          onTap: () => _select(place),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
