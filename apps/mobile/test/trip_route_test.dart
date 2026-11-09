import 'package:fast_logistics/trip_route.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:latlong2/latlong.dart';

void main() {
  const road = [
    LatLng(4.80, 7.00),
    LatLng(4.81, 7.00),
    LatLng(4.81, 7.01),
    LatLng(4.82, 7.01),
  ];

  test('route ahead only drops road points behind the rider', () {
    final ahead = routeAhead(road, const LatLng(4.8101, 7.0001));
    expect(ahead, road.sublist(1));
    expect(road, containsAll(ahead));
  });

  test('route ahead keeps a line when the rider reaches the end', () {
    expect(routeAhead(road, road.last), road.sublist(2));
  });

  test('route ahead shows the whole route before GPS arrives', () {
    expect(routeAhead(road, null), road);
    expect(routeAhead(const [], road.first), isEmpty);
  });

  test('route distance follows the road, not the straight line', () {
    const distance = Distance();
    expect(routeMeters(road), greaterThan(distance(road.first, road.last)));
    expect(routeMeters(road), closeTo(3320, 30));
  });

  test('route path parsing reads latitude then longitude', () {
    expect(
      parseRoutePath([
        [4.8, 7],
        [4.81, 7.01],
      ]),
      const [LatLng(4.8, 7), LatLng(4.81, 7.01)],
    );
    expect(parseRoutePath(null), isEmpty);
  });
}
