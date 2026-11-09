import 'package:flutter/material.dart';

class DeliveryBikeMarker extends StatelessWidget {
  const DeliveryBikeMarker({super.key, required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Semantics(
      label: label,
      child: Material(
        color: colors.primary,
        elevation: 3,
        shape: const CircleBorder(
          side: BorderSide(color: Colors.white, width: 2),
        ),
        child: Icon(Icons.delivery_dining, color: colors.onPrimary, size: 21),
      ),
    );
  }
}
