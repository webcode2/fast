import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import 'app_drawer.dart';
import 'customer_booking.dart';
import 'delivery_map.dart';
import 'delivery_pin_picker.dart';
import 'places.dart';
import 'route_entry_sheet.dart';
import 'safety_stories.dart';
import 'ui_kit.dart';

const _bannerMinimumHeight = 760.0;

class CustomerHomePage extends StatefulWidget {
  const CustomerHomePage({super.key, required this.user});

  final Map<String, dynamic> user;

  @override
  State<CustomerHomePage> createState() => _CustomerHomePageState();
}

class _CustomerHomePageState extends State<CustomerHomePage> {
  final _map = MapController();
  late final _lookup = PlaceLookup((place) {
    if (mounted) setState(() => _pickup = place);
  });
  LatLng _center = portHarcourt;
  Place? _pickup;
  bool _locating = true;
  List<Place> _recents = const [];

  @override
  void initState() {
    super.initState();
    unawaited(_loadRecents());
    unawaited(_locate(askPermission: false));
  }

  @override
  void dispose() {
    _lookup.dispose();
    _map.dispose();
    super.dispose();
  }

  Future<void> _loadRecents() async {
    final recents = await recentPlaces();
    if (mounted) setState(() => _recents = recents);
  }

  // The first attempt stays silent. Only tapping the button asks for permission.
  Future<void> _locate({required bool askPermission}) async {
    setState(() => _locating = true);
    try {
      final point = await deviceLocation(askPermission: askPermission);
      if (!mounted) return;
      _center = point;
      _map.move(point, 16);
    } catch (_) {
      if (mounted && askPermission) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Allow location access, or move the map to your pickup.',
            ),
          ),
        );
      }
    }
    if (!mounted) return;
    setState(() {
      _locating = false;
      _pickup = null;
    });
    _lookup.move(_center);
  }

  void _moved(LatLng center) {
    _center = center;
    setState(() => _pickup = null);
    _lookup.move(center);
  }

  Future<void> _book(Place pickup, Place dropoff) async {
    await rememberPlace(dropoff);
    if (!mounted) return;
    await Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (_) => CustomerBookingPage(pickup: pickup, dropoff: dropoff),
      ),
    );
    if (mounted) unawaited(_loadRecents());
  }

  Future<void> _enterRoute() async {
    final route = await showRouteEntry(context, pickup: _pickup, near: _center);
    if (route != null) await _book(route.pickup, route.dropoff);
  }

  Future<void> _pickPickup() async {
    final place = await Navigator.of(context).push<Place>(
      MaterialPageRoute(
        builder: (_) => DeliveryPinPicker(
          label: 'Pickup',
          selected: _pickup,
          near: _center,
        ),
      ),
    );
    if (!mounted || place == null) return;
    _center = place.point;
    _map.move(place.point, 17);
    setState(() => _pickup = place);
  }

  @override
  Widget build(BuildContext context) {
    final showBanner =
        MediaQuery.sizeOf(context).height >= _bannerMinimumHeight;
    return Scaffold(
      drawer: AppDrawer(user: widget.user),
      body: Column(
        children: [
          MapRegion(
            child: Stack(
              fit: StackFit.expand,
              children: [
                DeliveryMap(
                  controller: _map,
                  center: _center,
                  onMoved: _moved,
                  attributionPadding: EdgeInsets.fromLTRB(
                    16,
                    0,
                    88,
                    panelRadius.y + (showBanner ? 148 : 12),
                  ),
                ),
                Center(
                  child: FractionalTranslation(
                    translation: const Offset(0, -.5),
                    child: MapPin(
                      icon: Icons.inventory_2,
                      semanticLabel: 'Pickup point',
                      caption: _locating ? null : 'Pick up from',
                      title: _locating
                          ? 'Locating you…'
                          : _pickup?.name ?? 'Finding address…',
                      onTitleTap: _locating ? null : _pickPickup,
                    ),
                  ),
                ),
                SafeArea(
                  minimum: const EdgeInsets.all(16),
                  child: Padding(
                    padding: EdgeInsets.only(bottom: panelRadius.y),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const Align(
                          alignment: Alignment.topLeft,
                          child: DrawerMapButton(),
                        ),
                        const Spacer(),
                        Align(
                          alignment: Alignment.centerRight,
                          child: MapRoundButton(
                            icon: Icons.near_me_outlined,
                            tooltip: 'Use my location',
                            onPressed: () => _locate(askPermission: true),
                          ),
                        ),
                        if (showBanner) ...[
                          const SizedBox(height: 12),
                          const _VerifiedBanner(),
                        ],
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
                const Align(
                  alignment: Alignment.centerLeft,
                  child: _ServiceTile(),
                ),
                const SizedBox(height: 12),
                _SearchPill(onTap: _enterRoute),
                for (final place in _recents.take(2))
                  ListTile(
                    contentPadding: const EdgeInsets.symmetric(horizontal: 8),
                    minTileHeight: 56,
                    leading: ExcludeSemantics(
                      child: Icon(
                        Icons.location_on_outlined,
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                    ),
                    title: Text(
                      place.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    enabled: _pickup != null,
                    onTap: () => _book(_pickup!, place),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ServiceTile extends StatelessWidget {
  const _ServiceTile();

  @override
  Widget build(BuildContext context) => Container(
    width: 88,
    padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
    decoration: BoxDecoration(
      color: Theme.of(context).colorScheme.secondaryContainer,
      borderRadius: BorderRadius.circular(12),
    ),
    child: const Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ExcludeSemantics(
          child: Center(
            child: Icon(Icons.delivery_dining, color: Colors.white, size: 36),
          ),
        ),
        SizedBox(height: 2),
        Text('Parcel', style: TextStyle(color: Colors.white)),
      ],
    ),
  );
}

class _SearchPill extends StatelessWidget {
  const _SearchPill({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Semantics(
      button: true,
      label: 'Where to, and for how much?',
      excludeSemantics: true,
      child: Material(
        color: theme.colorScheme.surfaceContainerHigh,
        borderRadius: BorderRadius.circular(14),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 18),
            child: Row(
              children: [
                const Icon(Icons.search, size: 26),
                const SizedBox(width: 14),
                Expanded(
                  child: Text(
                    'Where to & for how much?',
                    style: theme.textTheme.titleLarge?.copyWith(
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _VerifiedBanner extends StatelessWidget {
  const _VerifiedBanner();

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Material(
      color: colors.secondaryContainer,
      borderRadius: BorderRadius.circular(20),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 12, 12),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Every rider is screened and verified',
                    style: Theme.of(context).textTheme.titleMedium
                        ?.copyWith(color: colors.onSecondaryContainer),
                  ),
                  const SizedBox(height: 8),
                  FilledButton(
                    style: FilledButton.styleFrom(
                      minimumSize: const Size(0, 40),
                      backgroundColor: Colors.white,
                      foregroundColor: Colors.black,
                      textStyle: const TextStyle(fontSize: 15),
                      padding: const EdgeInsets.symmetric(horizontal: 14),
                    ),
                    onPressed: () => Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => const SafetyStoriesPage(),
                      ),
                    ),
                    child: const Text('Learn more'),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 12),
            const SpotIllustration(icon: Icons.delivery_dining, size: 88),
          ],
        ),
      ),
    );
  }
}
