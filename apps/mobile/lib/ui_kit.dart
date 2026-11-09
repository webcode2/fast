import 'package:flutter/material.dart';

import 'app_theme.dart';

const panelRadius = Radius.circular(28);

/// The round floating control used over maps.
class MapRoundButton extends StatelessWidget {
  const MapRoundButton({
    super.key,
    required this.icon,
    required this.tooltip,
    required this.onPressed,
  });

  final IconData icon;
  final String tooltip;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Material(
      color: colors.surface,
      elevation: 3,
      shape: const CircleBorder(),
      child: IconButton(
        tooltip: tooltip,
        onPressed: onPressed,
        iconSize: 26,
        color: colors.onSurface,
        constraints: const BoxConstraints.tightFor(width: 56, height: 56),
        icon: Icon(icon),
      ),
    );
  }
}

/// A square map marker with an optional label bubble above it.
class MapPin extends StatelessWidget {
  const MapPin({
    super.key,
    required this.icon,
    required this.semanticLabel,
    this.caption,
    this.title,
    this.onTitleTap,
  });

  final IconData icon;
  final String semanticLabel;
  final String? caption;
  final String? title;
  final VoidCallback? onTitleTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (title case final title?)
          ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 280),
            child: Material(
              color: colors.surface,
              elevation: 3,
              borderRadius: BorderRadius.circular(14),
              clipBehavior: Clip.antiAlias,
              child: InkWell(
                onTap: onTitleTap,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(14, 8, 10, 8),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Flexible(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            if (caption case final caption?)
                              Text(
                                caption,
                                style: textTheme.bodySmall?.copyWith(
                                  color: colors.onSurfaceVariant,
                                ),
                              ),
                            Text(
                              title,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: textTheme.titleSmall,
                            ),
                          ],
                        ),
                      ),
                      if (onTitleTap != null)
                        Icon(
                          Icons.chevron_right,
                          size: 20,
                          color: colors.onSurface,
                        ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        if (title != null) const SizedBox(height: 6),
        MapPinHead(icon: icon, semanticLabel: semanticLabel),
      ],
    );
  }
}

class MapPinHead extends StatelessWidget {
  const MapPinHead({
    super.key,
    required this.icon,
    required this.semanticLabel,
    this.size = 44,
  });

  final IconData icon;
  final String semanticLabel;
  final double size;

  @override
  Widget build(BuildContext context) => Semantics(
    label: semanticLabel,
    image: true,
    child: Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: appBlue,
        borderRadius: BorderRadius.circular(size * .3),
        border: Border.all(color: Colors.white, width: 2.5),
        boxShadow: const [BoxShadow(blurRadius: 6, color: Colors.black38)],
      ),
      child: Icon(icon, color: Colors.white, size: size * .55),
    ),
  );
}

/// The rounded surface that docks to the bottom of map screens.
class DockedPanel extends StatelessWidget {
  const DockedPanel({
    super.key,
    required this.child,
    this.maxHeightFactor = .6,
  });

  final Widget child;
  final double maxHeightFactor;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return ConstrainedBox(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.sizeOf(context).height * maxHeightFactor,
      ),
      child: Material(
        color: colors.surface,
        elevation: 8,
        borderRadius: const BorderRadius.vertical(top: panelRadius),
        clipBehavior: Clip.antiAlias,
        child: SafeArea(
          top: false,
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
            child: child,
          ),
        ),
      ),
    );
  }
}

/// Fills the space above a [DockedPanel] and extends under its rounded corners.
class MapRegion extends StatelessWidget {
  const MapRegion({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) => Expanded(
    child: LayoutBuilder(
      builder: (context, constraints) => OverflowBox(
        alignment: Alignment.topCenter,
        maxHeight: constraints.maxHeight + panelRadius.y,
        minHeight: constraints.maxHeight + panelRadius.y,
        child: child,
      ),
    ),
  );
}

/// Fills the screen, with one flexible child, and scrolls when text or a small
/// device leaves too little room.
class FillOrScroll extends StatelessWidget {
  const FillOrScroll({super.key, required this.padding, required this.child});

  final EdgeInsets padding;
  final Widget child;

  @override
  Widget build(BuildContext context) => CustomScrollView(
    slivers: [
      SliverPadding(
        padding: padding,
        sliver: SliverFillRemaining(hasScrollBody: false, child: child),
      ),
    ],
  );
}

class SheetHeader extends StatelessWidget {
  const SheetHeader({super.key, required this.title, this.onClose});

  final String title;
  final VoidCallback? onClose;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.fromLTRB(68, 16, 16, 12),
      child: Row(
        children: [
          Expanded(
            child: Semantics(
              header: true,
              child: Text(
                title,
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.titleLarge,
              ),
            ),
          ),
          const SizedBox(width: 4),
          IconButton(
            tooltip: 'Close',
            style: IconButton.styleFrom(
              backgroundColor: colors.surfaceContainerHigh,
              foregroundColor: colors.onSurface,
            ),
            onPressed: onClose ?? () => Navigator.pop(context),
            icon: const Icon(Icons.close),
          ),
        ],
      ),
    );
  }
}

Future<T?> showAppSheet<T>(
  BuildContext context, {
  required String title,
  required WidgetBuilder builder,
  EdgeInsets padding = const EdgeInsets.fromLTRB(16, 4, 16, 16),
}) => showModalBottomSheet<T>(
  context: context,
  isScrollControlled: true,
  useSafeArea: true,
  builder: (context) => Padding(
    padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
    child: SafeArea(
      top: false,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SheetHeader(title: title),
          Flexible(
            child: SingleChildScrollView(
              padding: padding,
              child: builder(context),
            ),
          ),
        ],
      ),
    ),
  ),
);

/// The large left-aligned title used at the top of full pages.
class LargeTitle extends StatelessWidget {
  const LargeTitle(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 20),
    child: Semantics(
      header: true,
      child: Text(text, style: Theme.of(context).textTheme.headlineMedium),
    ),
  );
}

class Notice extends StatelessWidget {
  const Notice(this.text, {super.key, this.icon = Icons.info_outline});

  final String text;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Semantics(
        liveRegion: true,
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: colors.surfaceContainerHigh,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                ExcludeSemantics(child: Icon(icon, size: 20)),
                const SizedBox(width: 10),
                Expanded(child: Text(text)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class EmptyState extends StatelessWidget {
  const EmptyState({
    super.key,
    required this.icon,
    required this.text,
    this.action,
    this.onAction,
  });

  final IconData icon;
  final String text;
  final String? action;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ExcludeSemantics(
              child: Icon(icon, size: 48, color: colors.onSurfaceVariant),
            ),
            const SizedBox(height: 12),
            Text(
              text,
              textAlign: TextAlign.center,
              style: TextStyle(color: colors.onSurfaceVariant),
            ),
            if (action case final action?) ...[
              const SizedBox(height: 8),
              TextButton(onPressed: onAction, child: Text(action)),
            ],
          ],
        ),
      ),
    );
  }
}

class SettingsGroup extends StatelessWidget {
  const SettingsGroup({super.key, required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 10),
    child: Material(
      color: Theme.of(context).colorScheme.surfaceContainerLow,
      borderRadius: BorderRadius.circular(24),
      clipBehavior: Clip.antiAlias,
      child: Column(mainAxisSize: MainAxisSize.min, children: children),
    ),
  );
}

class SettingsRow extends StatelessWidget {
  const SettingsRow({
    super.key,
    required this.icon,
    required this.title,
    this.value,
    this.onTap,
    this.trailing,
    this.destructive = false,
  });

  final IconData icon;
  final String title;
  final String? value;
  final VoidCallback? onTap;
  final Widget? trailing;
  final bool destructive;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return ListTile(
      minTileHeight: 64,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16),
      leading: ExcludeSemantics(
        child: Icon(icon, color: destructive ? colors.error : colors.onSurface),
      ),
      title: Text(
        title,
        style: TextStyle(
          fontSize: 16,
          color: destructive ? colors.error : colors.onSurface,
        ),
      ),
      subtitle: value == null
          ? null
          : Text(value!, style: TextStyle(color: colors.onSurfaceVariant)),
      trailing:
          trailing ??
          (onTap == null
              ? null
              : ExcludeSemantics(
                  child: Icon(
                    Icons.chevron_right,
                    color: colors.onSurfaceVariant,
                  ),
                )),
      onTap: onTap,
    );
  }
}

/// A sky block behind an icon, with viewfinder corners, for feature moments.
class SpotIllustration extends StatelessWidget {
  const SpotIllustration({super.key, required this.icon, this.size = 200});

  final IconData icon;
  final double size;

  @override
  Widget build(BuildContext context) => ExcludeSemantics(
    child: SizedBox.square(
      dimension: size,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(size * .14),
        ),
        child: CustomPaint(
          painter: const _SpotPainter(),
          child: Center(
            child: Icon(icon, size: size * .42, color: appNavy),
          ),
        ),
      ),
    ),
  );
}

class _SpotPainter extends CustomPainter {
  const _SpotPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width;
    final h = size.height;
    canvas.drawPath(
      Path()
        ..moveTo(w * .14, h * .34)
        ..lineTo(w * .62, h * .2)
        ..lineTo(w * .86, h * .42)
        ..lineTo(w * .78, h * .82)
        ..lineTo(w * .22, h * .78)
        ..close(),
      Paint()..color = appSky,
    );
    final stroke = Paint()
      ..color = appInk
      ..style = PaintingStyle.stroke
      ..strokeWidth = w * .025
      ..strokeCap = StrokeCap.round;
    final inset = w * .08;
    final arm = w * .14;
    for (final (x, y, dx, dy) in [
      (inset, inset, 1.0, 1.0),
      (w - inset, inset, -1.0, 1.0),
      (inset, h - inset, 1.0, -1.0),
      (w - inset, h - inset, -1.0, -1.0),
    ]) {
      canvas.drawLine(Offset(x, y), Offset(x + dx * arm, y), stroke);
      canvas.drawLine(Offset(x, y), Offset(x, y + dy * arm), stroke);
    }
  }

  @override
  bool shouldRepaint(_SpotPainter oldDelegate) => false;
}

String deliveryStatusLabel(String? status) => switch (status) {
  'pending_dispatch' => 'Finding riders',
  'assigned' => 'Rider assigned',
  'picked_up' => 'Parcel picked up',
  'completed' => 'Delivered',
  'expired' => 'No rider found',
  'cancelled' => 'Cancelled',
  'customer_unavailable' => 'Recipient unavailable',
  null => '',
  _ => status.replaceAll('_', ' '),
};
