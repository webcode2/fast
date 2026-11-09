import 'package:flutter/material.dart';

import 'booking_api.dart';

const fareStepKobo = 10000;
const _fareRoundKobo = 5000;

/// The opening offer: the fare floor rounded up to a friendly amount.
int openingOffer(int floorKobo) =>
    (floorKobo / _fareRoundKobo).ceil() * _fareRoundKobo;

int lowerOffer(int offerKobo, int floorKobo) {
  final lower = offerKobo - fareStepKobo;
  return lower < floorKobo ? floorKobo : lower;
}

/// The two-line pickup and drop-off card shown at the top of trip screens.
class RouteCard extends StatelessWidget {
  const RouteCard({
    super.key,
    required this.pickup,
    required this.dropoff,
    this.detail,
    this.onTap,
  });

  final String pickup;
  final String dropoff;
  final String? detail;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    Widget row(IconData icon, String label, String text, {String? extra}) =>
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          child: Semantics(
            label: '$label: $text',
            excludeSemantics: true,
            child: Row(
              children: [
                Icon(icon, size: 24, color: colors.onSurface),
                const SizedBox(width: 14),
                Expanded(
                  child: Text.rich(
                    TextSpan(
                      text: text,
                      children: [
                        if (extra != null)
                          TextSpan(
                            text: '  $extra',
                            style: TextStyle(color: colors.onSurfaceVariant),
                          ),
                      ],
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
              ],
            ),
          ),
        );
    return Material(
      color: colors.surface,
      elevation: 3,
      borderRadius: BorderRadius.circular(24),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              row(Icons.inventory_2_outlined, 'Pickup', pickup),
              row(Icons.flag_outlined, 'Drop-off', dropoff, extra: detail),
            ],
          ),
        ),
      ),
    );
  }
}

class FareStepper extends StatelessWidget {
  const FareStepper({
    super.key,
    required this.offerKobo,
    required this.floorKobo,
    required this.onChanged,
    this.onEdit,
  });

  final int offerKobo;
  final int floorKobo;
  final ValueChanged<int>? onChanged;
  final VoidCallback? onEdit;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final atFloor = offerKobo <= floorKobo;
    Widget step(IconData icon, String tooltip, VoidCallback? onPressed) =>
        IconButton(
          tooltip: tooltip,
          iconSize: 28,
          constraints: const BoxConstraints.tightFor(width: 56, height: 56),
          style: IconButton.styleFrom(
            backgroundColor: colors.surfaceContainerHigh,
            foregroundColor: colors.onSurface,
            disabledBackgroundColor: colors.surfaceContainer,
            disabledForegroundColor: colors.outlineVariant,
          ),
          onPressed: onPressed,
          icon: Icon(icon),
        );
    return Row(
      children: [
        step(
          Icons.remove,
          'Lower your offer',
          atFloor || onChanged == null
              ? null
              : () => onChanged!(lowerOffer(offerKobo, floorKobo)),
        ),
        Expanded(
          child: InkWell(
            borderRadius: BorderRadius.circular(12),
            onTap: onEdit,
            child: Semantics(
              button: onEdit != null,
              label: 'Your offer ${displayFare(offerKobo)}',
              excludeSemantics: true,
              child: Column(
                children: [
                  FittedBox(
                    fit: BoxFit.scaleDown,
                    child: Text(
                      displayFare(offerKobo),
                      style: theme.textTheme.headlineMedium,
                    ),
                  ),
                  Text(
                    atFloor
                        ? 'Minimum fare'
                        : 'Minimum fare: ${displayFare(floorKobo)}',
                    textAlign: TextAlign.center,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: colors.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
        step(
          Icons.add,
          'Raise your offer',
          onChanged == null ? null : () => onChanged!(offerKobo + fareStepKobo),
        ),
      ],
    );
  }
}

/// Splits [text] so each case-insensitive match of [query] can be highlighted.
List<TextSpan> highlightMatch(String text, String query, TextStyle match) {
  final needle = query.trim().toLowerCase();
  if (needle.isEmpty) return [TextSpan(text: text)];
  final spans = <TextSpan>[];
  final lower = text.toLowerCase();
  var start = 0;
  while (true) {
    final index = lower.indexOf(needle, start);
    if (index < 0) break;
    if (index > start) spans.add(TextSpan(text: text.substring(start, index)));
    spans.add(
      TextSpan(
        text: text.substring(index, index + needle.length),
        style: match,
      ),
    );
    start = index + needle.length;
  }
  if (start < text.length) spans.add(TextSpan(text: text.substring(start)));
  return spans;
}
