import 'package:flutter/material.dart';

import 'ui_kit.dart';

const _stories = [
  (
    icon: Icons.verified_user,
    title: 'Every rider is verified',
    body: 'Riders pass NIN, selfie, and driver’s licence checks, then staff review, before they can take deliveries.',
  ),
  (
    icon: Icons.chat_bubble,
    title: 'Chat in the app',
    body: 'Message your rider from the trip screen. Each delivery has its own conversation.',
  ),
  (
    icon: Icons.phone_in_talk,
    title: 'Your number stays private',
    body: 'Calls go through the app, so you and your rider never need to share phone numbers.',
  ),
];

const _storyDuration = Duration(seconds: 6);

class SafetyStoriesPage extends StatefulWidget {
  const SafetyStoriesPage({super.key});

  @override
  State<SafetyStoriesPage> createState() => _SafetyStoriesPageState();
}

class _SafetyStoriesPageState extends State<SafetyStoriesPage>
    with SingleTickerProviderStateMixin {
  late final _progress = AnimationController(
    vsync: this,
    duration: _storyDuration,
  )..addStatusListener(_finished);
  int _index = 0;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _play();
  }

  // Auto-advance stops for people who ask for reduced motion.
  void _play() {
    if (MediaQuery.disableAnimationsOf(context)) {
      _progress.value = 1;
    } else if (!_progress.isAnimating) {
      _progress.forward(from: 0);
    }
  }

  void _finished(AnimationStatus status) {
    if (status == AnimationStatus.completed &&
        !MediaQuery.disableAnimationsOf(context)) {
      _step(1);
    }
  }

  void _step(int delta) {
    final next = _index + delta;
    if (next >= _stories.length) {
      Navigator.pop(context);
      return;
    }
    setState(() => _index = next < 0 ? 0 : next);
    _progress.reset();
    _play();
  }

  @override
  void dispose() {
    _progress.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final story = _stories[_index];
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              ExcludeSemantics(
                child: Row(
                  children: [
                    for (var i = 0; i < _stories.length; i++)
                      Expanded(
                        child: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 2),
                          child: AnimatedBuilder(
                            animation: _progress,
                            builder: (context, _) => LinearProgressIndicator(
                              minHeight: 5,
                              borderRadius: BorderRadius.circular(3),
                              color: colors.onSurface,
                              backgroundColor: colors.outlineVariant,
                              value: i < _index
                                  ? 1
                                  : i == _index
                                  ? _progress.value
                                  : 0,
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              Align(
                alignment: Alignment.centerRight,
                child: Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: IconButton(
                    tooltip: 'Close',
                    style: IconButton.styleFrom(
                      backgroundColor: colors.surfaceContainerHigh,
                    ),
                    onPressed: () => Navigator.pop(context),
                    icon: const Icon(Icons.close),
                  ),
                ),
              ),
              Expanded(
                child: SingleChildScrollView(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const SizedBox(height: 12),
                      Center(
                        child: SpotIllustration(icon: story.icon, size: 240),
                      ),
                      const SizedBox(height: 32),
                      Semantics(
                        header: true,
                        child: Text(
                          story.title,
                          style: theme.textTheme.headlineMedium,
                        ),
                      ),
                      const SizedBox(height: 12),
                      Text(
                        story.body,
                        style: theme.textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.w400,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              FilledButton(
                onPressed: () => _step(1),
                child: Text(_index == _stories.length - 1 ? 'Done' : 'Next'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
