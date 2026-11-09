import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

const appInk = Color(0xFF00022A);
const appNavy = Color(0xFF010F55);
const appBlue = Color(0xFF0654B0);
const appSky = Color(0xFF50A5D8);

const _appearanceKey = 'fast_logistics_appearance';
const _storage = FlutterSecureStorage();

final appearance = ValueNotifier(ThemeMode.dark);

Future<void> loadAppearance() async {
  try {
    final saved = await _storage.read(key: _appearanceKey);
    appearance.value = ThemeMode.values.firstWhere(
      (mode) => mode.name == saved,
      orElse: () => ThemeMode.dark,
    );
  } catch (_) {
    // Appearance is a convenience. The default theme still works without it.
  }
}

Future<void> saveAppearance(ThemeMode mode) async {
  appearance.value = mode;
  try {
    await _storage.write(key: _appearanceKey, value: mode.name);
  } catch (_) {
    // The choice still applies for this session.
  }
}

ThemeData appTheme(Brightness brightness) {
  final dark = brightness == Brightness.dark;
  final colors =
      ColorScheme.fromSeed(seedColor: appBlue, brightness: brightness).copyWith(
        primary: appBlue,
        onPrimary: Colors.white,
        // For small accents: appBlue is too dark to read on dark surfaces.
        secondary: dark ? appSky : appBlue,
        onSecondary: dark ? appInk : Colors.white,
        secondaryContainer: appNavy,
        onSecondaryContainer: Colors.white,
        tertiary: appSky,
        onTertiary: appInk,
        surface: dark ? const Color(0xFF1C1C1C) : Colors.white,
        onSurface: dark ? Colors.white : appInk,
        onSurfaceVariant: dark
            ? const Color(0xFFB8B8B2)
            : const Color(0xFF4A5068),
        surfaceContainerLow: dark
            ? const Color(0xFF242424)
            : const Color(0xFFF5F7FA),
        surfaceContainer: dark
            ? const Color(0xFF2A2A2A)
            : const Color(0xFFEFF2F7),
        surfaceContainerHigh: dark
            ? const Color(0xFF333333)
            : const Color(0xFFE6EAF1),
        outlineVariant: dark
            ? const Color(0xFF444444)
            : const Color(0xFFD5DAE3),
        error: dark ? const Color(0xFFF2A0A0) : const Color(0xFFB3261E),
      );
  final radius12 = BorderRadius.circular(12);
  final buttonShape = RoundedRectangleBorder(
    borderRadius: BorderRadius.circular(14),
  );
  const buttonText = TextStyle(fontSize: 17, fontWeight: FontWeight.w600);
  final base = ThemeData(colorScheme: colors, brightness: brightness);
  return base.copyWith(
    scaffoldBackgroundColor: colors.surface,
    textTheme: base.textTheme.copyWith(
      headlineMedium: base.textTheme.headlineMedium?.copyWith(
        fontWeight: FontWeight.w700,
      ),
      headlineSmall: base.textTheme.headlineSmall?.copyWith(
        fontWeight: FontWeight.w700,
      ),
      titleLarge: base.textTheme.titleLarge?.copyWith(
        fontWeight: FontWeight.w700,
      ),
      titleMedium: base.textTheme.titleMedium?.copyWith(
        fontSize: 17,
        fontWeight: FontWeight.w500,
      ),
    ),
    appBarTheme: AppBarTheme(
      backgroundColor: colors.surface,
      foregroundColor: colors.onSurface,
      centerTitle: true,
      elevation: 0,
      scrolledUnderElevation: 0,
      titleTextStyle: base.textTheme.titleLarge?.copyWith(
        color: colors.onSurface,
        fontWeight: FontWeight.w700,
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(64, 56),
        shape: buttonShape,
        textStyle: buttonText,
        disabledBackgroundColor: colors.surfaceContainerHigh,
        disabledForegroundColor: colors.onSurfaceVariant,
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(64, 56),
        shape: buttonShape,
        textStyle: buttonText,
        foregroundColor: colors.onSurface,
        side: BorderSide(color: colors.outlineVariant),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        minimumSize: const Size(64, 48),
        foregroundColor: colors.onSurface,
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w500),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: colors.surfaceContainerHigh,
      labelStyle: TextStyle(color: colors.onSurfaceVariant),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 18),
      border: OutlineInputBorder(
        borderRadius: radius12,
        borderSide: BorderSide.none,
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: radius12,
        borderSide: BorderSide(color: colors.onSurface, width: 2),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: radius12,
        borderSide: BorderSide(color: colors.error),
      ),
    ),
    cardTheme: CardThemeData(
      color: colors.surfaceContainer,
      elevation: 0,
      margin: const EdgeInsets.symmetric(vertical: 6),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      clipBehavior: Clip.antiAlias,
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: colors.surface,
      surfaceTintColor: Colors.transparent,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      clipBehavior: Clip.antiAlias,
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: colors.surfaceContainerLow,
      surfaceTintColor: Colors.transparent,
    ),
    drawerTheme: DrawerThemeData(
      backgroundColor: colors.surface,
      surfaceTintColor: Colors.transparent,
      shape: const RoundedRectangleBorder(),
    ),
    progressIndicatorTheme: ProgressIndicatorThemeData(color: colors.secondary),
    radioTheme: RadioThemeData(
      fillColor: WidgetStateProperty.resolveWith(
        (states) => states.contains(WidgetState.selected)
            ? colors.secondary
            : colors.onSurfaceVariant,
      ),
    ),
    checkboxTheme: CheckboxThemeData(
      fillColor: WidgetStateProperty.resolveWith(
        (states) => states.contains(WidgetState.selected)
            ? colors.secondary
            : Colors.transparent,
      ),
      checkColor: WidgetStatePropertyAll(colors.onSecondary),
    ),
    textSelectionTheme: TextSelectionThemeData(cursorColor: colors.onSurface),
    dividerTheme: DividerThemeData(color: colors.outlineVariant, space: 1),
    snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating),
    switchTheme: SwitchThemeData(
      trackOutlineColor: WidgetStateProperty.all(Colors.transparent),
    ),
  );
}

/// Sign-up and sign-in stay light in every appearance, like the references.
final authTheme = () {
  final base = appTheme(Brightness.light);
  final colors = base.colorScheme;
  final radius = BorderRadius.circular(14);
  final outline = OutlineInputBorder(
    borderRadius: radius,
    borderSide: BorderSide(color: colors.outlineVariant),
  );
  final pill = FilledButton.styleFrom(
    minimumSize: const Size(64, 58),
    shape: const StadiumBorder(),
    textStyle: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
    disabledBackgroundColor: colors.surfaceContainerHigh,
    disabledForegroundColor: colors.onSurfaceVariant,
  );
  return base.copyWith(
    filledButtonTheme: FilledButtonThemeData(style: pill),
    inputDecorationTheme: base.inputDecorationTheme.copyWith(
      fillColor: Colors.white,
      border: outline,
      enabledBorder: outline,
      focusedBorder: OutlineInputBorder(
        borderRadius: radius,
        borderSide: const BorderSide(color: appBlue, width: 2),
      ),
    ),
  );
}();
