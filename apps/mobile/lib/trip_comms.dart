import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

import 'auth_api.dart';
import 'preview_api.dart';
import 'request_id.dart';
import 'trip_call_screen.dart';
import 'trip_voice.dart';
import 'ui_kit.dart';

final _api = AuthApi();
Future<Map<String, dynamic>> _request(
  String path, {
  String method = 'GET',
  Map<String, Object?>? data,
}) => _api.request(
  path,
  prefix: '',
  method: method,
  authenticated: true,
  data: data,
);

class ActiveTripsPage extends StatefulWidget {
  const ActiveTripsPage({super.key});

  @override
  State<ActiveTripsPage> createState() => _ActiveTripsPageState();
}

class _ActiveTripsPageState extends State<ActiveTripsPage> {
  late Future<Map<String, dynamic>> _trips = _request('/trips/active');

  void _refresh() => setState(() => _trips = _request('/trips/active'));

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const Text('Active trips'),
      actions: [
        IconButton(
          tooltip: 'Refresh trips',
          onPressed: _refresh,
          icon: const Icon(Icons.refresh),
        ),
      ],
    ),
    body: SafeArea(
      child: FutureBuilder(
        future: _trips,
        builder: (context, snapshot) {
          if (snapshot.hasError) {
            return EmptyState(
              icon: Icons.wifi_off,
              text: 'Could not load trips.',
              action: 'Retry',
              onAction: _refresh,
            );
          }
          if (!snapshot.hasData) {
            return const Center(child: CircularProgressIndicator());
          }
          final trips = snapshot.requireData['trips'] as List;
          if (trips.isEmpty) {
            return const EmptyState(
              icon: Icons.delivery_dining,
              text: 'You have no active trips.',
            );
          }
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              for (final trip in trips)
                Card(
                  child: ListTile(
                    minTileHeight: 72,
                    leading: const ExcludeSemantics(
                      child: Icon(Icons.delivery_dining),
                    ),
                    title: Text(
                      trip['dropoffLabel'] as String? ?? 'Parcel delivery',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    subtitle: Text(
                      trip['status'] == 'picked_up' ? 'In transit' : 'Assigned',
                    ),
                    trailing: const ExcludeSemantics(
                      child: Icon(Icons.chat_bubble_outline),
                    ),
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) =>
                            TripCommsPage(tripId: trip['id'] as String),
                      ),
                    ),
                  ),
                ),
            ],
          );
        },
      ),
    ),
  );
}

class TripCommsPage extends StatefulWidget {
  const TripCommsPage({
    super.key,
    required this.tripId,
    this.startCall = false,
  });

  final String tripId;
  final bool startCall;

  @override
  State<TripCommsPage> createState() => _TripCommsPageState();
}

class _TripCommsPageState extends State<TripCommsPage> {
  final _composer = TextEditingController();
  final _history = <String, Map<String, dynamic>>{};
  Timer? _reconnectTimer;
  WebSocket? _socket;
  TripVoice? _voice;
  String? _voiceId;
  String? _accountId;
  String? _assignment;
  String? _tripStatus;
  String? _pendingId;
  String? _pendingText;
  String? _error;
  Map<String, dynamic>? _call;
  bool _appliedAnswer = false;
  late bool _callRequested = widget.startCall;
  bool _active = false;
  bool _busy = false;
  bool _answering = false;
  bool _ending = false;
  bool _sending = false;
  bool _loadingOlder = false;
  bool _moreHistory = true;
  bool _muted = false;
  bool _connected = false;
  bool _ready = false;
  bool _offline = false;

  String get _path => '/trips/${widget.tripId}/comms';
  List<Map<String, dynamic>> get _messages => _history.values.toList()
    ..sort(
      (a, b) =>
          BigInt.parse(b['id'] as String)
              .compareTo(BigInt.parse(a['id'] as String)),
    );

  @override
  void initState() {
    super.initState();
    unawaited(_connect());
  }

  void _merge(List<dynamic> messages) {
    for (final raw in messages) {
      final message = raw as Map<String, dynamic>;
      _history[message['id'] as String] = message;
    }
  }

  Future<void> _connect() async {
    if (previewMode) {
      await _applySnapshot(await _request(_path));
      if (mounted) {
        _reconnectTimer = Timer(const Duration(seconds: 1), _connect);
      }
      return;
    }
    try {
      final token = await _api.token;
      if (token == null) throw const AuthException('Sign in required.', 401);
      final origin = _api.apiOrigin();
      final uri = origin.replace(
        scheme: origin.scheme == 'https' ? 'wss' : 'ws',
        path: '$_path/ws',
      );
      final socket = await WebSocket.connect(
        uri.toString(),
        headers: {'Authorization': 'Bearer $token'},
      );
      if (!mounted) {
        await socket.close();
        return;
      }
      _socket = socket;
      await for (final frame in socket.timeout(const Duration(seconds: 35))) {
        final event = jsonDecode(frame as String) as Map<String, dynamic>;
        final body = event['body'] as Map<String, dynamic>;
        if (event['status'] != 200) {
          throw AuthException(body['error'] as String, event['status'] as int);
        }
        await _applySnapshot(body);
        if (!mounted || !_active) return;
      }
      if (mounted) setState(() => _offline = true);
    } on WebSocketException {
      // The HTTP snapshot supplies an actionable status when upgrade is denied.
      try {
        await _applySnapshot(await _request(_path));
        if (mounted && _active) setState(() => _offline = true);
      } on AuthException catch (error) {
        if (mounted) await _connectionError(error);
      }
    } on AuthException catch (error) {
      if (mounted) await _connectionError(error);
    } catch (_) {
      if (mounted) setState(() => _offline = true);
    } finally {
      unawaited(_socket?.close());
      _socket = null;
      if (mounted && (_active || !_ready || _offline)) {
        _reconnectTimer = Timer(const Duration(seconds: 2), _connect);
      }
    }
  }

  Future<void> _applySnapshot(Map<String, dynamic> snapshot) async {
    if (!mounted) return;
    final call = snapshot['call'] as Map<String, dynamic>?;
    final assignment = snapshot['assignment'] as String;
    if (_assignment != null && _assignment != assignment) {
      await _closeVoice();
      if (!mounted) return;
      _history.clear();
      _pendingId = null;
      _pendingText = null;
      _composer.clear();
      _moreHistory = true;
    }
    setState(() {
      _assignment = assignment;
      _tripStatus = snapshot['status'] as String;
      _accountId = snapshot['accountId'] as String;
      _active = snapshot['active'] == true;
      _ready = true;
      _offline = false;
      final messages = snapshot['messages'] as List;
      if (_history.isEmpty && messages.length < 50) _moreHistory = false;
      _merge(messages);
      _call = call;
    });
    if (_callRequested && _active && call == null && _voiceId == null) {
      _callRequested = false;
      unawaited(_beginVoice());
    }
    if (_voiceId != null && (!_active || (!_busy && call?['id'] != _voiceId))) {
      await _closeVoice();
    } else if (!_busy &&
        _voiceId != null &&
        !_appliedAnswer &&
        call?['callerId'] == _accountId &&
        call?['answer'] is String) {
      _appliedAnswer = true;
      try {
        await _voice?.applyAnswer(call!['answer'] as String);
      } catch (_) {
        await _endVoice();
        if (mounted) setState(() => _error = 'The call could not connect.');
      }
    }
  }

  Future<void> _connectionError(AuthException error) async {
    if (error.status == 401 || error.status == 404) {
      await _closeVoice();
      if (mounted) {
        setState(() {
          _active = false;
          _ready = true;
          _offline = false;
          _history.clear();
          _call = null;
          _error = error.message;
        });
      }
      return;
    }
    setState(() => _offline = true);
  }

  Future<void> _older() async {
    if (_loadingOlder || _history.isEmpty) return;
    setState(() => _loadingOlder = true);
    try {
      final snapshot = await _request(
        '$_path/messages?before=${_messages.last['id']}',
      );
      if (!mounted) return;
      setState(() {
        final messages = snapshot['messages'] as List;
        _moreHistory = messages.length == 50;
        _merge(messages);
      });
    } on AuthException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _loadingOlder = false);
    }
  }

  Future<void> _send() async {
    final text = _composer.text.trim();
    if (text.isEmpty || _sending) return;
    setState(() {
      _sending = true;
      _error = null;
    });
    if (_pendingText != text) {
      _pendingId = requestId();
      _pendingText = text;
    }
    try {
      await _request(
        '$_path/messages',
        method: 'POST',
        data: {'id': _pendingId, 'body': text, 'assignment': _assignment},
      );
      _pendingText = null;
      _pendingId = null;
      if (mounted && _composer.text.trim() == text) _composer.clear();
    } on AuthException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _beginVoice({Map<String, dynamic>? incoming}) async {
    if (_busy || _ending || _voice != null) return;
    final id = incoming?['id'] as String? ?? requestId();
    final assignment = _assignment;
    setState(() {
      _busy = true;
      _answering = incoming != null;
      _error = null;
      _voiceId = id;
    });
    final voice = TripVoice((state) {
      if (!mounted || _voiceId != id) return;
      setState(
        () => _connected =
            state == RTCPeerConnectionState.RTCPeerConnectionStateConnected,
      );
      if (state == RTCPeerConnectionState.RTCPeerConnectionStateFailed) {
        setState(() => _error = 'The call connection failed.');
        unawaited(_endVoice());
      }
    });
    _voice = voice;
    try {
      final config = await _request('$_path/ice');
      if (!mounted || _voiceId != id) return;
      final sdp = await voice.negotiate(
        config['iceServers'] as List,
        offer: incoming?['offer'] as String?,
      );
      if (!mounted || _voiceId != id) return;
      final response = await _request(
        '$_path/${incoming == null ? 'call' : 'answer'}',
        method: 'POST',
        data: {'id': id, 'sdp': sdp, 'assignment': assignment},
      );
      if (!mounted || _voiceId != id) {
        await _hangup(id, assignment: assignment);
        return;
      }
      setState(() {
        _appliedAnswer = incoming != null;
        _call = response['call'] as Map<String, dynamic>;
      });
    } catch (error) {
      if (_voiceId != id) return;
      await _closeVoice();
      if (incoming == null) await _hangup(id, assignment: assignment);
      if (mounted) {
        setState(() {
          _error = error is AuthException ? error.message : 'Could not start voice. Check microphone access and connection.';
        });
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _hangup(String id, {required String? assignment}) async {
    await _request(
      '$_path/hangup',
      method: 'POST',
      data: {'id': id, 'assignment': assignment},
    ).catchError((_) => <String, dynamic>{});
  }

  Future<void> _closeVoice() async {
    final voice = _voice;
    _voice = null;
    _voiceId = null;
    _appliedAnswer = false;
    if (mounted) {
      setState(() {
        _connected = false;
        _muted = false;
      });
    }
    await voice?.close();
  }

  Future<void> _endVoice() async {
    if (_ending) return;
    final id = _voiceId ?? _call?['id'] as String?;
    final assignment = _assignment;
    setState(() {
      _ending = true;
      _call = null;
    });
    try {
      await _closeVoice();
      if (id != null) await _hangup(id, assignment: assignment);
    } finally {
      if (mounted) {
        setState(() {
          if (_call?['id'] == id) _call = null;
          _ending = false;
        });
      }
    }
  }

  @override
  void dispose() {
    _reconnectTimer?.cancel();
    unawaited(_socket?.close());
    _composer.dispose();
    final id = _voiceId;
    if (id != null) unawaited(_hangup(id, assignment: _assignment));
    unawaited(_voice?.close() ?? Future<void>.value());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final messages = _messages;
    final incoming =
        _call?['callerId'] != _accountId && _call?['answer'] == null
        ? _call
        : null;
    if (!_ending && (_voiceId != null || incoming != null)) {
      final phase = _connected
          ? TripCallPhase.active
          : incoming != null || _answering
          ? TripCallPhase.incoming
          : TripCallPhase.outgoing;
      return TripCallScreen(
        phase: phase,
        connecting: _busy || _voiceId != null && _call?['answer'] != null,
        answer: incoming != null && !_offline && !_busy && _voiceId == null
            ? () => _beginVoice(incoming: incoming)
            : null,
        end: _endVoice,
        muted: _muted,
        toggleMute: () {
          setState(() => _muted = !_muted);
          _voice?.mute(_muted);
        },
      );
    }
    final colors = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Messages'),
        actions: [
          IconButton(
            tooltip: 'Start voice call',
            onPressed: !_active || _offline || _busy || _ending || _call != null
                ? null
                : _beginVoice,
            icon: const Icon(Icons.call_outlined),
          ),
        ],
      ),
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (_tripStatus case final status?)
              Text(
                deliveryStatusLabel(status),
                textAlign: TextAlign.center,
                style: TextStyle(color: colors.onSurfaceVariant),
              ),
            if (_error != null || _offline)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: Notice(
                  _error ?? 'Connection interrupted. Reconnecting…',
                ),
              ),
            Expanded(
              child: !_ready && !_offline
                  ? const Center(child: CircularProgressIndicator())
                  : messages.isEmpty
                  ? const EmptyState(
                      icon: Icons.chat_bubble_outline,
                      text: 'No messages yet',
                    )
                  : ListView.builder(
                      reverse: true,
                      padding: const EdgeInsets.all(12),
                      itemCount: messages.length + (_moreHistory ? 1 : 0),
                      itemBuilder: (context, index) {
                        if (index == messages.length) {
                          return TextButton(
                            onPressed: _loadingOlder ? null : _older,
                            child: const Text('Load earlier messages'),
                          );
                        }
                        final message = messages[index];
                        final mine = message['senderId'] == _accountId;
                        return Align(
                          alignment: mine
                              ? Alignment.centerRight
                              : Alignment.centerLeft,
                          child: ConstrainedBox(
                            constraints: BoxConstraints(
                              maxWidth: MediaQuery.sizeOf(context).width * .78,
                            ),
                            child: Container(
                              margin: const EdgeInsets.symmetric(vertical: 4),
                              padding: const EdgeInsets.symmetric(
                                horizontal: 14,
                                vertical: 10,
                              ),
                              decoration: BoxDecoration(
                                color: mine
                                    ? colors.primary
                                    : colors.surfaceContainerHigh,
                                borderRadius: BorderRadius.circular(18),
                              ),
                              child: Semantics(
                                label: mine ? 'You' : 'Other trip participant',
                                child: Text(
                                  message['body'] as String,
                                  style: TextStyle(
                                    fontSize: 16,
                                    color: mine
                                        ? colors.onPrimary
                                        : colors.onSurface,
                                  ),
                                ),
                              ),
                            ),
                          ),
                        );
                      },
                    ),
            ),
            if (_active)
              ColoredBox(
                color: colors.surfaceContainerLow,
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _composer,
                          maxLength: 2000,
                          minLines: 1,
                          maxLines: 4,
                          decoration: const InputDecoration(
                            hintText: 'Enter your message',
                            counterText: '',
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      IconButton.filled(
                        tooltip: 'Send message',
                        constraints: const BoxConstraints.tightFor(
                          width: 56,
                          height: 56,
                        ),
                        style: IconButton.styleFrom(
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(14),
                          ),
                        ),
                        onPressed: _sending ? null : _send,
                        icon: const Icon(Icons.send),
                      ),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
