import 'package:flutter/material.dart';

import 'auth_api.dart';
import 'booking_api.dart';
import 'ui_kit.dart';

/// Shown while the rider is at the next stop, with the likely next steps.
class ArrivalCard extends StatelessWidget {
  const ArrivalCard({
    super.key,
    required this.stop,
    required this.place,
    required this.onCall,
    required this.onMessage,
  });

  final String stop;
  final String? place;
  final VoidCallback? onCall;
  final VoidCallback? onMessage;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final pickup = stop == 'pickup';
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: colors.secondaryContainer,
        borderRadius: BorderRadius.circular(18),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Semantics(
            liveRegion: true,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  pickup
                      ? 'You’ve arrived at the pickup'
                      : 'You’ve arrived at the drop-off',
                  style: theme.textTheme.titleMedium?.copyWith(
                    color: colors.onSecondaryContainer,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  pickup
                      ? '${place ?? 'Pickup point'}. Let the customer know you’re here.'
                      : '${place ?? 'Drop-off point'}. Let the customer know you’re here.',
                  style: TextStyle(color: colors.onSecondaryContainer),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          Row(
            spacing: 8,
            children: [
              Expanded(
                child: _QuickAction(
                  icon: Icons.call,
                  label: 'Call',
                  onPressed: onCall,
                ),
              ),
              Expanded(
                child: _QuickAction(
                  icon: Icons.chat_bubble,
                  label: 'Message',
                  onPressed: onMessage,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _QuickAction extends StatelessWidget {
  const _QuickAction({
    required this.icon,
    required this.label,
    required this.onPressed,
  });

  final IconData icon;
  final String label;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) => FilledButton.icon(
    style: FilledButton.styleFrom(
      minimumSize: const Size(0, 48),
      backgroundColor: Colors.white,
      foregroundColor: Colors.black,
      textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
    ),
    onPressed: onPressed,
    icon: Icon(icon, size: 20),
    label: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis),
  );
}

/// The more-actions menu. Which actions apply depends on the trip's stage.
class RiderTripActions extends StatelessWidget {
  const RiderTripActions({
    super.key,
    required this.status,
    required this.noShowEligibleAt,
    required this.onCall,
    required this.onMessage,
    required this.onNavigate,
    required this.onReport,
    required this.onCustomerUnavailable,
    required this.onCancel,
    required this.onEmergency,
    this.now,
  });

  final String? status;
  final DateTime? noShowEligibleAt;
  final VoidCallback onCall;
  final VoidCallback onMessage;
  final VoidCallback onNavigate;
  final VoidCallback onReport;
  final VoidCallback onCustomerUnavailable;
  final VoidCallback onCancel;
  final VoidCallback onEmergency;
  final DateTime? now;

  @override
  Widget build(BuildContext context) {
    final pickedUp = status == 'picked_up';
    final eligible = noShowEligibleAt;
    final current = now ?? DateTime.now();
    final canMarkUnavailable =
        pickedUp && eligible != null && !eligible.isAfter(current);
    final minutesLeft = eligible == null
        ? null
        : eligible.difference(current).inSeconds / 60;
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        SettingsRow(
          icon: Icons.call_outlined,
          title: 'Call customer',
          onTap: onCall,
        ),
        SettingsRow(
          icon: Icons.chat_bubble_outline,
          title: 'Message customer',
          onTap: onMessage,
        ),
        SettingsRow(
          icon: Icons.navigation_outlined,
          title: pickedUp ? 'Navigate to drop-off' : 'Navigate to pickup',
          value: 'Opens Google Maps',
          onTap: onNavigate,
        ),
        const Divider(),
        SettingsRow(
          icon: Icons.report_outlined,
          title: 'Report a problem',
          value: 'Tell our support team what happened',
          onTap: onReport,
        ),
        if (pickedUp)
          SettingsRow(
            icon: Icons.person_off_outlined,
            title: 'Customer not available',
            value: canMarkUnavailable
                ? 'End this trip because nobody came'
                : minutesLeft == null
                ? 'Available after waiting 10 minutes at the drop-off'
                : 'Available in ${minutesLeft.ceil()} min',
            onTap: canMarkUnavailable ? onCustomerUnavailable : null,
          ),
        SettingsRow(
          icon: Icons.cancel_outlined,
          title: pickedUp
              ? 'I can’t finish this delivery'
              : 'Cancel this delivery',
          value: pickedUp
              ? 'Asks support to step in'
              : 'Sends the order back to other riders',
          onTap: onCancel,
        ),
        const Divider(),
        SettingsRow(
          icon: Icons.emergency_outlined,
          title: 'Emergency: call 112',
          destructive: true,
          onTap: onEmergency,
        ),
      ],
    );
  }
}

const _issueTypes = {
  'safety': 'I feel unsafe',
  'customer_unreachable': 'Can’t reach the customer',
  'wrong_address': 'Wrong address or pin',
  'parcel_problem': 'Problem with the parcel',
  'payment_problem': 'Payment problem',
  'other': 'Something else',
};

class ReportIssueForm extends StatefulWidget {
  const ReportIssueForm({
    super.key,
    required this.tripId,
    required this.onSent,
  });

  final String tripId;
  final VoidCallback onSent;

  @override
  State<ReportIssueForm> createState() => _ReportIssueFormState();
}

class _ReportIssueFormState extends State<ReportIssueForm> {
  final _details = TextEditingController();
  String? _category;
  String? _error;
  bool _sending = false;

  @override
  void dispose() {
    _details.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final text = _details.text.trim();
    if (_category == 'other' && text.isEmpty) {
      setState(() => _error = 'Tell us what happened.');
      return;
    }
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      await bookingRequest(
        '/trips/${widget.tripId}/issues',
        method: 'POST',
        data: {'category': _category, 'details': text},
      );
      if (mounted) widget.onSent();
    } on AuthException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) => RadioGroup<String>(
    groupValue: _category,
    onChanged: (value) {
      if (!_sending) setState(() => _category = value);
    },
    child: Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final type in _issueTypes.entries)
          RadioListTile<String>(
            contentPadding: EdgeInsets.zero,
            value: type.key,
            title: Text(type.value),
          ),
        const SizedBox(height: 8),
        TextField(
          controller: _details,
          enabled: !_sending,
          maxLength: 1000,
          minLines: 2,
          maxLines: 4,
          decoration: const InputDecoration(labelText: 'Details'),
        ),
        if (_error case final error?) Notice(error, icon: Icons.error_outline),
        const SizedBox(height: 8),
        FilledButton(
          onPressed: _category == null || _sending ? null : _send,
          child: const Text('Send report'),
        ),
      ],
    ),
  );
}
