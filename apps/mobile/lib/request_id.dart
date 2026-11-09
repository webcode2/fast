import 'dart:math';

final _random = Random.secure();

String requestId() => [8, 4, 4, 4, 12]
    .map(
      (size) => List.generate(
        size,
        (_) => _random.nextInt(16).toRadixString(16),
      ).join(),
    )
    .join('-');
