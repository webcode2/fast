import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';

const deliveryTileUrl = String.fromEnvironment('TRIP_MAP_TILE_URL');
const deliveryDarkTileUrl = String.fromEnvironment('TRIP_MAP_TILE_URL_DARK');
const deliveryMapAttribution = String.fromEnvironment('TRIP_MAP_ATTRIBUTION');

bool get deliveryMapAvailable =>
    deliveryTileUrl.startsWith('https://') &&
    deliveryMapAttribution.isNotEmpty &&
    ['{z}', '{x}', '{y}'].every(deliveryTileUrl.contains);

TileLayer deliveryMapTiles(BuildContext context) {
  final dark = Theme.of(context).brightness == Brightness.dark;
  final darkSource = dark && deliveryDarkTileUrl.startsWith('https://');
  return TileLayer(
    urlTemplate: darkSource ? deliveryDarkTileUrl : deliveryTileUrl,
    tileBuilder: dark
        ? (darkSource ? null : _nightTile)
        : (_, tile, _) => ColorFiltered(
            colorFilter: const ColorFilter.matrix([
              0.70,
              0.13,
              0.05,
              0,
              25,
              0.08,
              0.76,
              0.05,
              0,
              24,
              0.08,
              0.13,
              0.72,
              0,
              18,
              0,
              0,
              0,
              1,
              0,
            ]),
            child: tile,
          ),
    userAgentPackageName: 'com.fastlogistics.mobile',
  );
}

// Night view for light basemaps: inverts brightness and keeps hue, so water
// stays blue and labels turn light.
Widget _nightTile(BuildContext context, Widget tile, TileImage _) =>
    ColorFiltered(
      colorFilter: const ColorFilter.matrix([
        .333,
        -.667,
        -.667,
        0,
        285,
        -.667,
        .333,
        -.667,
        0,
        285,
        -.667,
        -.667,
        .333,
        0,
        285,
        0,
        0,
        0,
        1,
        0,
      ]),
      child: tile,
    );
