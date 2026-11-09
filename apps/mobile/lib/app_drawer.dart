import 'package:flutter/material.dart';

import 'auth_pages.dart';
import 'cash_commission.dart';
import 'customer_booking.dart';
import 'rider_identity_page.dart';
import 'safety_stories.dart';
import 'trip_comms.dart';
import 'trip_feedback.dart';
import 'ui_kit.dart';

class AppDrawer extends StatelessWidget {
  const AppDrawer({super.key, required this.user});

  final Map<String, dynamic> user;

  void _open(BuildContext context, Widget page) {
    Navigator.pop(context);
    Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => page));
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final rider = user['role'] == 'rider';
    final name = user['name'] as String? ?? '';
    Widget item(
      IconData icon,
      String title, {
      Widget? page,
      bool here = false,
    }) => ListTile(
      minTileHeight: 60,
      selected: here,
      selectedColor: colors.onSurface,
      selectedTileColor: colors.surfaceContainerHigh,
      leading: ExcludeSemantics(
        child: Icon(icon, color: colors.onSurfaceVariant),
      ),
      title: Text(title, style: theme.textTheme.titleMedium),
      onTap: page == null
          ? () => Navigator.pop(context)
          : () => _open(context, page),
    );
    return Drawer(
      child: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            InkWell(
              onTap: () => _open(context, const AccountPage()),
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                  children: [
                    CircleAvatar(
                      radius: 30,
                      backgroundColor: colors.secondaryContainer,
                      foregroundColor: colors.onSecondaryContainer,
                      child: Text(
                        name.isEmpty ? '?' : name[0].toUpperCase(),
                        style: theme.textTheme.titleLarge?.copyWith(
                          color: colors.onSecondaryContainer,
                        ),
                      ),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: theme.textTheme.titleLarge,
                          ),
                          Text(
                            rider ? 'Rider account' : 'Customer account',
                            style: TextStyle(color: colors.onSurfaceVariant),
                          ),
                        ],
                      ),
                    ),
                    ExcludeSemantics(
                      child: Icon(Icons.chevron_right, color: colors.onSurface),
                    ),
                  ],
                ),
              ),
            ),
            const Divider(),
            Expanded(
              child: ListView(
                padding: EdgeInsets.zero,
                children: rider
                    ? [
                        item(Icons.delivery_dining, 'Dispatch', here: true),
                        item(
                          Icons.schedule,
                          'Active trips',
                          page: const ActiveTripsPage(),
                        ),
                        item(
                          Icons.verified_user_outlined,
                          'Rider identity',
                          page: const RiderIdentityPage(),
                        ),
                        item(
                          Icons.account_balance_wallet_outlined,
                          'Cash commission',
                          page: const CashCommissionPage(),
                        ),
                        item(
                          Icons.shield_outlined,
                          'Safety',
                          page: const SafetyStoriesPage(),
                        ),
                        item(
                          Icons.settings_outlined,
                          'Settings',
                          page: const AccountPage(),
                        ),
                      ]
                    : [
                        item(
                          Icons.inventory_2_outlined,
                          'Send a parcel',
                          here: true,
                        ),
                        item(
                          Icons.history,
                          'Delivery history',
                          page: const CustomerOrdersPage(),
                        ),
                        item(
                          Icons.schedule,
                          'Active trips',
                          page: const ActiveTripsPage(),
                        ),
                        item(
                          Icons.star_outline,
                          'Reviews and reports',
                          page: const CompletedTripsPage(),
                        ),
                        item(
                          Icons.shield_outlined,
                          'Safety',
                          page: const SafetyStoriesPage(),
                        ),
                        item(
                          Icons.settings_outlined,
                          'Settings',
                          page: const AccountPage(),
                        ),
                      ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The menu button shown on map home screens.
class DrawerMapButton extends StatelessWidget {
  const DrawerMapButton({super.key});

  @override
  Widget build(BuildContext context) => MapRoundButton(
    icon: Icons.menu,
    tooltip: 'Open menu',
    onPressed: () => Scaffold.of(context).openDrawer(),
  );
}
