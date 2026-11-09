import 'package:fast_logistics/trip_location_queue.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test(
    'reconnect sends the newest point once and drops expired positions',
    () async {
      var now = DateTime.utc(2026, 11, 7);
      final queue = TripLocationQueue(now: () => now);
      final first = TripLocationSample(4.81, 7.01, now);
      queue.offer(first);
      await queue.flush((sample) async {
        expect(sample, first);
        return false;
      });

      now = now.add(const Duration(seconds: 5));
      final latest = TripLocationSample(4.82, 7.02, now);
      queue.offer(latest);
      queue.offer(first);
      var sent = 0;
      await queue.flush((sample) async {
        expect(sample, latest);
        expect(sample.toJson()['recordedAtMs'], now.millisecondsSinceEpoch);
        sent++;
        return true;
      });
      await queue.flush((_) async {
        sent++;
        return true;
      });
      expect(sent, 1);

      now = now.add(const Duration(seconds: 5));
      queue.offer(TripLocationSample(4.83, 7.03, now));
      now = now.add(const Duration(minutes: 2));
      await queue.flush((_) async {
        fail('An expired position should never be uploaded');
      });
    },
  );
}
