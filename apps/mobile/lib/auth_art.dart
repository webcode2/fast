import 'package:flutter/material.dart';

import 'app_theme.dart';

/// The delivery scooter hero, drawn in code so it scales and uses brand colors.
class ScooterArt extends StatelessWidget {
  const ScooterArt({super.key, this.chips = const []});

  final List<ArtChip> chips;

  @override
  Widget build(BuildContext context) => ExcludeSemantics(
    child: Stack(
      children: [
        Positioned.fill(child: CustomPaint(painter: const _ScooterPainter())),
        ...chips,
      ],
    ),
  );
}

/// A simple street map with a route and two pins.
class RouteArt extends StatelessWidget {
  const RouteArt({super.key, this.chips = const []});

  final List<ArtChip> chips;

  @override
  Widget build(BuildContext context) => ExcludeSemantics(
    child: Stack(
      children: [
        Positioned.fill(child: CustomPaint(painter: const _RoutePainter())),
        ...chips,
      ],
    ),
  );
}

/// A small floating label placed over artwork by fractional position.
class ArtChip extends StatelessWidget {
  const ArtChip({
    super.key,
    required this.alignment,
    required this.icon,
    required this.text,
  });

  final Alignment alignment;
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) => Align(
    alignment: alignment,
    child: Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        boxShadow: const [
          BoxShadow(
            blurRadius: 16,
            offset: Offset(0, 4),
            color: Color(0x22010F55),
          ),
        ],
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 18, color: appBlue),
          const SizedBox(width: 6),
          Flexible(
            child: Text(
              text,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: appInk,
                fontSize: 13,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    ),
  );
}

// Scales a 400 x 300 design space into the available box, centered.
void _fit(Canvas canvas, Size size) {
  final scale = (size.width / 400) < (size.height / 300)
      ? size.width / 400
      : size.height / 300;
  canvas.translate(
    (size.width - 400 * scale) / 2,
    (size.height - 300 * scale) / 2,
  );
  canvas.scale(scale);
}

class _ScooterPainter extends CustomPainter {
  const _ScooterPainter();

  void _wheel(Canvas canvas, Offset center) {
    canvas.drawCircle(center, 37, Paint()..color = appInk);
    canvas.drawCircle(center, 21, Paint()..color = const Color(0xFFE6EEF6));
    canvas.drawCircle(center, 9, Paint()..color = appBlue);
  }

  @override
  void paint(Canvas canvas, Size size) {
    _fit(canvas, size);
    canvas.drawCircle(
      const Offset(205, 150),
      140,
      Paint()..color = const Color(0xFFD5E9F6),
    );
    canvas.drawCircle(
      const Offset(205, 150),
      104,
      Paint()..color = const Color(0xFFBBDCF1),
    );
    canvas.drawOval(
      const Rect.fromLTRB(52, 256, 358, 276),
      Paint()..color = const Color(0x22010F55),
    );

    final stroke = Paint()
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;

    // Steering column, drawn first so the leg shield overlaps it.
    canvas.drawPath(
      Path()
        ..moveTo(304, 226)
        ..lineTo(268, 76),
      stroke
        ..color = const Color(0xFF8DA2B5)
        ..strokeWidth = 9,
    );

    _wheel(canvas, const Offset(112, 228));
    _wheel(canvas, const Offset(304, 228));

    // Main body: rear fairing, footboard, and leg shield.
    canvas.drawPath(
      Path()
        ..moveTo(62, 206)
        ..cubicTo(52, 170, 78, 138, 124, 136)
        ..lineTo(198, 136)
        ..cubicTo(206, 150, 204, 176, 216, 186)
        ..lineTo(246, 186)
        ..cubicTo(254, 158, 254, 122, 258, 92)
        ..lineTo(286, 86)
        ..cubicTo(296, 122, 292, 170, 262, 208)
        ..cubicTo(254, 216, 244, 220, 232, 220)
        ..lineTo(170, 220)
        ..cubicTo(164, 192, 142, 176, 112, 176)
        ..cubicTo(90, 176, 72, 188, 62, 206)
        ..close(),
      Paint()..color = appBlue,
    );

    // Highlight along the fairing.
    canvas.drawPath(
      Path()
        ..moveTo(82, 168)
        ..cubicTo(92, 154, 110, 149, 130, 149)
        ..lineTo(182, 149),
      stroke
        ..color = appSky
        ..strokeWidth = 6,
    );

    // Front fender.
    canvas.drawPath(
      Path()
        ..moveTo(264, 216)
        ..cubicTo(270, 180, 334, 178, 346, 216)
        ..lineTo(330, 212)
        ..cubicTo(320, 196, 292, 196, 280, 214)
        ..close(),
      Paint()..color = appBlue,
    );

    // Seat.
    canvas.drawRRect(
      RRect.fromLTRBAndCorners(
        118,
        116,
        206,
        138,
        topLeft: const Radius.circular(12),
        topRight: const Radius.circular(10),
        bottomLeft: const Radius.circular(4),
        bottomRight: const Radius.circular(8),
      ),
      Paint()..color = appInk,
    );

    // Delivery box.
    canvas.drawRRect(
      RRect.fromLTRBR(46, 44, 134, 122, const Radius.circular(10)),
      Paint()..color = appNavy,
    );
    canvas.drawRRect(
      RRect.fromLTRBR(46, 44, 134, 62, const Radius.circular(8)),
      Paint()..color = const Color(0xFF16307F),
    );
    canvas.drawRRect(
      RRect.fromLTRBR(72, 76, 108, 108, const Radius.circular(4)),
      Paint()..color = appSky,
    );
    canvas.drawRect(
      const Rect.fromLTRB(86, 76, 94, 90),
      Paint()..color = Colors.white,
    );
    canvas.drawRect(
      const Rect.fromLTRB(104, 118, 122, 136),
      Paint()..color = appInk,
    );

    // Handlebar, grip, and mirror.
    canvas.drawPath(
      Path()
        ..moveTo(232, 62)
        ..lineTo(272, 72),
      stroke
        ..color = appInk
        ..strokeWidth = 10,
    );
    canvas.drawPath(
      Path()
        ..moveTo(258, 66)
        ..lineTo(248, 34),
      stroke
        ..color = const Color(0xFF8DA2B5)
        ..strokeWidth = 4,
    );
    canvas.drawOval(
      const Rect.fromLTRB(232, 18, 262, 38),
      Paint()..color = appInk,
    );

    // Headlight.
    canvas.drawRRect(
      RRect.fromLTRBR(262, 70, 298, 96, const Radius.circular(12)),
      Paint()..color = appBlue,
    );
    canvas.drawOval(
      const Rect.fromLTRB(282, 74, 304, 94),
      Paint()..color = const Color(0xFFFFF3C4),
    );
  }

  @override
  bool shouldRepaint(_ScooterPainter oldDelegate) => false;
}

class _RoutePainter extends CustomPainter {
  const _RoutePainter();

  void _pin(Canvas canvas, Offset tip, Color color) {
    final head = tip.translate(0, -28);
    canvas.drawPath(
      Path()
        ..moveTo(tip.dx, tip.dy)
        ..lineTo(head.dx - 15, head.dy + 8)
        ..lineTo(head.dx + 15, head.dy + 8)
        ..close(),
      Paint()..color = color,
    );
    canvas.drawCircle(head, 18, Paint()..color = color);
    canvas.drawCircle(head, 7, Paint()..color = Colors.white);
  }

  @override
  void paint(Canvas canvas, Size size) {
    _fit(canvas, size);
    final tile = RRect.fromLTRBR(30, 10, 370, 290, const Radius.circular(28));
    canvas.drawRRect(tile, Paint()..color = const Color(0xFFE3F0F9));
    canvas.save();
    canvas.clipRRect(tile);
    final block = Paint()..color = const Color(0xFFCFE4F3);
    for (final rect in const [
      Rect.fromLTRB(46, 28, 134, 92),
      Rect.fromLTRB(154, 28, 262, 92),
      Rect.fromLTRB(282, 28, 354, 118),
      Rect.fromLTRB(46, 112, 112, 196),
      Rect.fromLTRB(132, 112, 262, 176),
      Rect.fromLTRB(282, 138, 354, 216),
      Rect.fromLTRB(46, 216, 170, 274),
      Rect.fromLTRB(190, 196, 262, 274),
      Rect.fromLTRB(282, 236, 354, 274),
    ]) {
      canvas.drawRRect(
        RRect.fromRectAndRadius(rect, const Radius.circular(8)),
        block,
      );
    }
    canvas.drawPath(
      Path()
        ..moveTo(92, 250)
        ..lineTo(92, 206)
        ..lineTo(180, 206)
        ..lineTo(180, 102)
        ..lineTo(272, 102)
        ..lineTo(272, 66),
      Paint()
        ..color = appBlue
        ..style = PaintingStyle.stroke
        ..strokeWidth = 7
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round,
    );
    canvas.restore();
    _pin(canvas, const Offset(92, 250), appNavy);
    _pin(canvas, const Offset(272, 72), appBlue);
  }

  @override
  bool shouldRepaint(_RoutePainter oldDelegate) => false;
}
