class TripLocationSample {
  const TripLocationSample(this.latitude, this.longitude, this.recordedAt);

  final double latitude;
  final double longitude;
  final DateTime recordedAt;

  Map<String, Object?> toJson() => {
    'location': {'latitude': latitude, 'longitude': longitude},
    'recordedAtMs': recordedAt.millisecondsSinceEpoch,
  };
}

class TripLocationQueue {
  TripLocationQueue({DateTime Function()? now}) : _now = now ?? DateTime.now;

  final DateTime Function() _now;
  TripLocationSample? _pending;
  DateTime? _latest;
  bool _uploading = false;

  void offer(TripLocationSample sample) {
    if (_latest != null && !sample.recordedAt.isAfter(_latest!)) return;
    _latest = sample.recordedAt;
    _pending = sample;
  }

  Future<void> flush(Future<bool> Function(TripLocationSample) upload) async {
    if (_uploading) return;
    final sample = _pending;
    if (sample == null) return;
    if (_now().difference(sample.recordedAt) > const Duration(seconds: 110)) {
      _pending = null;
      return;
    }
    _uploading = true;
    try {
      if (await upload(sample) && identical(_pending, sample)) _pending = null;
    } finally {
      _uploading = false;
    }
  }

  void clear() {
    _pending = null;
    _latest = null;
  }
}
