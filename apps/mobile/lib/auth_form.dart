import 'package:flutter/material.dart';

import 'auth_api.dart';
import 'ui_kit.dart';

class AuthField {
  const AuthField(
    this.key,
    this.label, {
    this.secret = false,
    this.keyboard,
    this.required = true,
    this.maxLength,
    this.prefixText,
    this.autofill,
  });

  final String key;
  final String label;
  final bool secret;
  final bool required;
  final int? maxLength;
  final TextInputType? keyboard;
  final String? prefixText;
  final List<String>? autofill;
}

const emailField = AuthField(
  'email',
  'Email',
  keyboard: TextInputType.emailAddress,
  autofill: [AutofillHints.email],
);
const passwordField = AuthField(
  'password',
  'Password',
  secret: true,
  autofill: [AutofillHints.password],
);
const newPasswordField = AuthField(
  'password',
  'New password (at least 12 characters)',
  secret: true,
);
const codeField = AuthField(
  'code',
  'Six-digit code',
  keyboard: TextInputType.number,
);

class AuthForm extends StatefulWidget {
  const AuthForm({
    super.key,
    required this.button,
    required this.submit,
    this.fields = const [],
  });

  final String button;
  final List<AuthField> fields;
  final Future<String?> Function(Map<String, String>) submit;

  @override
  State<AuthForm> createState() => _AuthFormState();
}

class _AuthFormState extends State<AuthForm> {
  final _form = GlobalKey<FormState>();
  final _values = <String, String>{};
  final _revealed = <String>{};
  bool _busy = false;
  String? _message;

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    _form.currentState!.save();
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      _message = await widget.submit(Map.of(_values));
      if (mounted) _form.currentState?.reset();
    } on AuthException catch (error) {
      _message = error.message;
    } catch (_) {
      _message = 'Could not complete the request.';
    } finally {
      _values.clear();
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Form(
      key: _form,
      child: AutofillGroup(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (final field in widget.fields)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: TextFormField(
                  enabled: !_busy,
                  decoration: InputDecoration(
                    labelText: field.label,
                    prefixText: field.prefixText,
                    suffixIcon: field.secret
                        ? IconButton(
                            tooltip: _revealed.contains(field.key)
                                ? 'Hide ${field.label}'
                                : 'Show ${field.label}',
                            onPressed: () => setState(
                              () => _revealed.contains(field.key)
                                  ? _revealed.remove(field.key)
                                  : _revealed.add(field.key),
                            ),
                            icon: Icon(
                              _revealed.contains(field.key)
                                  ? Icons.visibility_off_outlined
                                  : Icons.visibility_outlined,
                            ),
                          )
                        : null,
                  ),
                  keyboardType: field.keyboard,
                  autofillHints: field.autofill,
                  maxLength: field.maxLength,
                  obscureText: field.secret && !_revealed.contains(field.key),
                  autocorrect: !field.secret,
                  enableSuggestions: !field.secret,
                  validator: (value) =>
                      field.required && (value ?? '').trim().isEmpty
                      ? 'Required'
                      : null,
                  onSaved: (value) => _values[field.key] = value ?? '',
                ),
              ),
            FilledButton(
              onPressed: _busy ? null : _submit,
              child: Text(widget.button),
            ),
            if (_message case final message?) Notice(message),
          ],
        ),
      ),
    );
  }
}

class AuthPage extends StatelessWidget {
  const AuthPage({
    super.key,
    required this.title,
    required this.children,
    this.header,
  });

  final String title;
  final List<Widget> children;
  final Widget? header;

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(),
    body: SafeArea(
      child: Align(
        alignment: Alignment.topCenter,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 560),
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
            children: [?header, LargeTitle(title), ...children],
          ),
        ),
      ),
    ),
  );
}
