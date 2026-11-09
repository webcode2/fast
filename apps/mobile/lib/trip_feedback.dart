import 'package:flutter/material.dart';

import 'auth_api.dart';
import 'auth_form.dart';
import 'ui_kit.dart';

final _api = AuthApi();

Future<Map<String, dynamic>> _feedbackRequest(
  String path, {
  Map<String, Object?>? data,
}) => _api.request(
  path,
  prefix: '',
  method: data == null ? 'GET' : 'POST',
  authenticated: true,
  data: data,
);

class CompletedTripsPage extends StatefulWidget {
  const CompletedTripsPage({super.key});

  @override
  State<CompletedTripsPage> createState() => _CompletedTripsPageState();
}

class _CompletedTripsPageState extends State<CompletedTripsPage> {
  late Future<Map<String, dynamic>> _trips = _feedbackRequest(
    '/trips/feedback',
  );

  void _reload() =>
      setState(() => _trips = _feedbackRequest('/trips/feedback'));

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Reviews and reports')),
    body: SafeArea(
      child: FutureBuilder(
        future: _trips,
        builder: (context, snapshot) {
          if (snapshot.hasError) {
            return EmptyState(
              icon: Icons.wifi_off,
              text: 'Could not load deliveries.',
              action: 'Retry',
              onAction: _reload,
            );
          }
          if (!snapshot.hasData) {
            return const Center(child: CircularProgressIndicator());
          }
          final trips = snapshot.requireData['trips'] as List;
          if (trips.isEmpty) {
            return const EmptyState(
              icon: Icons.star_outline,
              text: 'No completed deliveries yet.',
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
                      child: Icon(Icons.inventory_2_outlined),
                    ),
                    title: Text(
                      trip['dropoffLabel'] as String? ?? 'Parcel delivery',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    subtitle: Text(
                      trip['disputeStatus'] == null
                          ? 'Review or report non-delivery'
                          : 'Report status: ${trip['disputeStatus']}',
                    ),
                    trailing: const ExcludeSemantics(
                      child: Icon(Icons.chevron_right),
                    ),
                    onTap: () async {
                      await Navigator.of(context).push(
                        MaterialPageRoute<void>(
                          builder: (_) =>
                              TripFeedbackPage(tripId: trip['id'] as String),
                        ),
                      );
                      if (mounted) _reload();
                    },
                  ),
                ),
            ],
          );
        },
      ),
    ),
  );
}

class TripFeedbackPage extends StatefulWidget {
  const TripFeedbackPage({super.key, required this.tripId});

  final String tripId;

  @override
  State<TripFeedbackPage> createState() => _TripFeedbackPageState();
}

class _TripFeedbackPageState extends State<TripFeedbackPage> {
  String get _path => '/trips/${widget.tripId}';
  late Future<Map<String, dynamic>> _feedback = _feedbackRequest(
    '$_path/feedback',
  );

  void _reload() =>
      setState(() => _feedback = _feedbackRequest('$_path/feedback'));

  @override
  Widget build(BuildContext context) => FutureBuilder(
    future: _feedback,
    builder: (context, snapshot) {
      if (!snapshot.hasData) {
        return AuthPage(
          title: 'Delivery feedback',
          children: snapshot.hasError
              ? [
                  TextButton(
                    onPressed: _reload,
                    child: const Text('Could not load feedback. Retry'),
                  ),
                ]
              : [const Center(child: CircularProgressIndicator())],
        );
      }
      final review = snapshot.requireData['review'] as Map<String, dynamic>?;
      final dispute = snapshot.requireData['dispute'] as Map<String, dynamic>?;
      return AuthPage(
        title: 'Delivery feedback',
        children: [
          Text('Review', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 8),
          if (review != null) ...[
            Text('You rated this delivery ${review['rating']} out of 5.'),
            if (review['comment'] != '') Text(review['comment'] as String),
          ] else
            _ReviewForm(
              submit: (rating, comment) async {
                await _feedbackRequest(
                  '$_path/review',
                  data: {'rating': rating, 'comment': comment},
                );
                if (mounted) _reload();
              },
            ),
          const SizedBox(height: 24),
          Text(
            'Non-delivery report',
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: 8),
          if (dispute != null) ...[
            Text('Status: ${dispute['status']}'),
            Text(dispute['details'] as String),
            if (dispute['resolution'] case final String resolution)
              Text(resolution),
          ] else
            AuthForm(
              key: const ValueKey('report'),
              button: 'Report non-delivery',
              fields: const [
                AuthField('details', 'What happened?', maxLength: 2000),
              ],
              submit: (data) async {
                await _feedbackRequest('$_path/dispute', data: data);
                if (mounted) _reload();
                return 'Report submitted.';
              },
            ),
        ],
      );
    },
  );
}

class _ReviewForm extends StatefulWidget {
  const _ReviewForm({required this.submit});

  final Future<void> Function(int rating, String comment) submit;

  @override
  State<_ReviewForm> createState() => _ReviewFormState();
}

class _ReviewFormState extends State<_ReviewForm> {
  int _rating = 0;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            for (var star = 1; star <= 5; star++)
              IconButton(
                tooltip: '$star out of 5',
                isSelected: star == _rating,
                iconSize: 36,
                onPressed: () => setState(() => _rating = star),
                icon: Icon(
                  star <= _rating ? Icons.star : Icons.star_outline,
                  color: star <= _rating
                      ? colors.secondary
                      : colors.onSurfaceVariant,
                ),
              ),
          ],
        ),
        const SizedBox(height: 8),
        AuthForm(
          key: const ValueKey('review'),
          button: 'Submit review',
          fields: const [
            AuthField(
              'comment',
              'Comment (optional)',
              required: false,
              maxLength: 1000,
            ),
          ],
          submit: (data) async {
            if (_rating == 0) {
              throw const AuthException('Choose a rating from 1 to 5 stars.');
            }
            await widget.submit(_rating, data['comment'] ?? '');
            return 'Review saved.';
          },
        ),
      ],
    );
  }
}
