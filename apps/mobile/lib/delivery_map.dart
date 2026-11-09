import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import 'delivery_bike_marker.dart';
import 'delivery_map_tiles.dart';
import 'ui_kit.dart';

const portHarcourt = LatLng(4.8156, 7.0498);

/// The shared map: basemap, route line, trip markers, and attribution.
class DeliveryMap extends StatelessWidget {
  const DeliveryMap({
    super.key,
    this.controller,
    this.center = portHarcourt,
    this.zoom = 15,
    this.pickup,
    this.dropoff,
    this.rider,
    this.path = const [],
    this.fitPadding = const EdgeInsets.fromLTRB(60, 210, 60, 130),
    this.interactive = true,
    this.onMoved,
    this.onReady,
    this.onTap,
    this.attributionPadding = const EdgeInsets.fromLTRB(80, 0, 12, 36),
  });

  final MapController? controller;
  final LatLng center;
  final double zoom;
  final LatLng? pickup;
  final LatLng? dropoff;
  final LatLng? rider;
  final List<LatLng> path;
  final EdgeInsets fitPadding;
  final bool interactive;
  final void Function(LatLng center)? onMoved;
  final VoidCallback? onReady;
  final void Function(LatLng point)? onTap;
  final EdgeInsets attributionPadding;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final points = [?pickup, ?dropoff, ...path];
    final fit = points.length >= 2 && pickup != dropoff;
    return ColoredBox(
      color: colors.surfaceContainer,
      child: Stack(
        fit: StackFit.expand,
        children: [
          FlutterMap(
            mapController: controller,
            options: MapOptions(
              initialCenter: pickup ?? center,
              initialZoom: zoom,
              initialCameraFit: fit
                  ? CameraFit.coordinates(
                      coordinates: points,
                      padding: fitPadding,
                      maxZoom: 16,
                    )
                  : null,
              backgroundColor: colors.surfaceContainer,
              onMapReady: onReady,
              onTap: onTap == null ? null : (_, point) => onTap!(point),
              onPositionChanged: onMoved == null
                  ? null
                  : (camera, hasGesture) {
                      if (hasGesture) onMoved!(camera.center);
                    },
              interactionOptions: InteractionOptions(
                flags: interactive
                    ? InteractiveFlag.drag |
                          InteractiveFlag.pinchZoom |
                          InteractiveFlag.doubleTapZoom |
                          InteractiveFlag.scrollWheelZoom
                    : InteractiveFlag.none,
              ),
            ),
            children: [
              if (deliveryMapAvailable) deliveryMapTiles(context),
              if (path.length >= 2)
                PolylineLayer(
                  polylines: [
                    Polyline(
                      points: path,
                      strokeWidth: 5,
                      color: colors.onSurface,
                    ),
                  ],
                ),
              MarkerLayer(
                markers: [
                  if (pickup case final point?)
                    Marker(
                      point: point,
                      width: 44,
                      height: 44,
                      child: const MapPinHead(
                        icon: Icons.inventory_2,
                        semanticLabel: 'Pickup',
                      ),
                    ),
                  if (dropoff case final point?)
                    Marker(
                      point: point,
                      width: 44,
                      height: 44,
                      child: const MapPinHead(
                        icon: Icons.flag,
                        semanticLabel: 'Drop-off',
                      ),
                    ),
                  if (rider case final point?)
                    Marker(
                      point: point,
                      width: 38,
                      height: 38,
                      child: const DeliveryBikeMarker(label: 'Assigned rider'),
                    ),
                ],
              ),
            ],
          ),
          if (deliveryMapAvailable)
            Align(
              alignment: Alignment.bottomLeft,
              child: Padding(
                padding: attributionPadding,
                child: Text(
                  deliveryMapAttribution,
                  style: TextStyle(
                    fontSize: 11,
                    color: colors.onSurface,
                    shadows: [Shadow(color: colors.surface, blurRadius: 3)],
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
