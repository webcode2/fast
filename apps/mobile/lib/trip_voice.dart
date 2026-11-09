import 'dart:async';

import 'package:flutter_webrtc/flutter_webrtc.dart';

class TripVoice {
  TripVoice(this.onState);

  final void Function(RTCPeerConnectionState) onState;
  RTCPeerConnection? _connection;
  MediaStream? _microphone;
  bool _closed = false;

  Future<String> negotiate(List<dynamic> servers, {String? offer}) async {
    try {
      final connection = await createPeerConnection({
        'iceServers': servers,
        'iceTransportPolicy': 'relay',
      });
      if (_closed) {
        await connection.close();
        await connection.dispose();
        throw StateError('Call closed');
      }
      _connection = connection;
      connection.onConnectionState = onState;
      final microphone = await navigator.mediaDevices.getUserMedia({
        'audio': true,
        'video': false,
      });
      if (_closed) {
        for (final track in microphone.getTracks()) {
          await track.stop();
        }
        await microphone.dispose();
        throw StateError('Call closed');
      }
      _microphone = microphone;
      for (final track in microphone.getAudioTracks()) {
        await connection.addTrack(track, microphone);
      }
      if (offer != null) {
        await connection.setRemoteDescription(
          RTCSessionDescription(offer, 'offer'),
        );
      }

      final gathered = Completer<void>();
      connection.onIceGatheringState = (state) {
        if (state == RTCIceGatheringState.RTCIceGatheringStateComplete &&
            !gathered.isCompleted) {
          gathered.complete();
        }
      };
      await connection.setLocalDescription(
        offer == null
            ? await connection.createOffer()
            : await connection.createAnswer(),
      );
      if (connection.iceGatheringState !=
          RTCIceGatheringState.RTCIceGatheringStateComplete) {
        await gathered.future.timeout(const Duration(seconds: 15));
      }
      final sdp = (await connection.getLocalDescription())?.sdp;
      if (sdp == null || !sdp.contains(' typ relay')) {
        throw StateError('No TURN relay candidate');
      }
      return sdp;
    } catch (_) {
      await close();
      rethrow;
    }
  }

  Future<void> applyAnswer(String answer) async {
    await _connection?.setRemoteDescription(
      RTCSessionDescription(answer, 'answer'),
    );
  }

  void mute(bool muted) {
    for (final track in _microphone?.getAudioTracks() ?? <MediaStreamTrack>[]) {
      track.enabled = !muted;
    }
  }

  Future<void> close() async {
    if (_closed) return;
    _closed = true;
    final microphone = _microphone;
    final connection = _connection;
    _microphone = null;
    _connection = null;
    try {
      if (microphone != null) {
        for (final track in microphone.getTracks()) {
          await track.stop();
        }
        await microphone.dispose();
      }
    } finally {
      try {
        await connection?.close();
      } finally {
        await connection?.dispose();
      }
    }
  }
}
