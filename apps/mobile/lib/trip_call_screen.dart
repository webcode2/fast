import 'package:flutter/material.dart';

enum TripCallPhase { incoming, outgoing, active }

class TripCallScreen extends StatelessWidget {
  const TripCallScreen({
    super.key,
    required this.phase,
    required this.end,
    this.answer,
    this.toggleMute,
    this.muted = false,
    this.connecting = false,
  });

  final TripCallPhase phase;
  final VoidCallback? end;
  final VoidCallback? answer;
  final VoidCallback? toggleMute;
  final bool muted;
  final bool connecting;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final (title, icon, endLabel) = switch (phase) {
      TripCallPhase.incoming => (
        'Incoming call',
        Icons.call_received,
        'Decline',
      ),
      TripCallPhase.outgoing => (
        'Outgoing call',
        Icons.call_made,
        'Cancel call',
      ),
      TripCallPhase.active => ('On a call', Icons.phone_in_talk, 'End call'),
    };
    final status = switch (phase) {
      TripCallPhase.incoming =>
        connecting ? 'Connecting…' : 'Someone on this delivery is calling.',
      TripCallPhase.outgoing =>
        connecting ? 'Connecting…' : 'Waiting for an answer…',
      TripCallPhase.active => muted ? 'Microphone muted' : 'Audio connected',
    };
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) end?.call();
      },
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Trip voice call'),
          automaticallyImplyLeading: false,
        ),
        body: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: Column(
                children: [
                  CircleAvatar(
                    radius: 44,
                    backgroundColor: colors.primaryContainer,
                    foregroundColor: colors.onPrimaryContainer,
                    child: Icon(icon, size: 36),
                  ),
                  const SizedBox(height: 24),
                  Semantics(
                    header: true,
                    child: Text(
                      title,
                      style: theme.textTheme.headlineMedium,
                      textAlign: TextAlign.center,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Semantics(
                    liveRegion: true,
                    child: Text(status, textAlign: TextAlign.center),
                  ),
                  const SizedBox(height: 32),
                  Wrap(
                    alignment: WrapAlignment.center,
                    spacing: 12,
                    runSpacing: 12,
                    children: [
                      if (phase == TripCallPhase.incoming)
                        FilledButton.icon(
                          onPressed: answer,
                          icon: const Icon(Icons.call),
                          label: const Text('Answer'),
                        ),
                      if (phase == TripCallPhase.active)
                        OutlinedButton.icon(
                          onPressed: toggleMute,
                          icon: Icon(muted ? Icons.mic : Icons.mic_off),
                          label: Text(muted ? 'Unmute' : 'Mute'),
                        ),
                      FilledButton.icon(
                        style: FilledButton.styleFrom(
                          backgroundColor: colors.error,
                          foregroundColor: colors.onError,
                        ),
                        onPressed: end,
                        icon: const Icon(Icons.call_end),
                        label: Text(endLabel),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
