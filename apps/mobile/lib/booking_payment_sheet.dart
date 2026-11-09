import 'package:flutter/material.dart';

import 'ui_kit.dart';

const bookingPaymentMethods = {
  'cash': (label: 'Cash', icon: Icons.payments_outlined),
  'digital': (label: 'Card via Bachs', icon: Icons.credit_card),
};

Future<String?> chooseBookingPayment(BuildContext context, String current) =>
    showAppSheet<String>(
      context,
      title: 'Payment methods',
      padding: EdgeInsets.zero,
      builder: (context) {
        final colors = Theme.of(context).colorScheme;
        return Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (final entry in bookingPaymentMethods.entries)
              ListTile(
                minTileHeight: 64,
                selected: entry.key == current,
                selectedTileColor: colors.secondaryContainer,
                selectedColor: colors.onSecondaryContainer,
                leading: Icon(entry.value.icon),
                title: Text(entry.value.label),
                trailing: entry.key == current ? const Icon(Icons.check) : null,
                onTap: () => Navigator.pop(context, entry.key),
              ),
          ],
        );
      },
    );
