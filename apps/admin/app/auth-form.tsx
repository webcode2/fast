import type { ReactNode } from 'react';
import { submitAuth } from './auth-actions';

export function AuthForm({ action, button, children }: {
  action: Parameters<typeof submitAuth>[0];
  button: string;
  children?: ReactNode;
}) {
  return (
    <form className="auth-form" action={submitAuth.bind(null, action)}>
      {children}
      <button type="submit">{button}</button>
    </form>
  );
}

export function Field({ label, name, type = 'text', autoComplete, defaultValue }: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  defaultValue?: string;
}) {
  return (
    <label>
      {label}
      <input name={name} type={type} autoComplete={autoComplete}
        defaultValue={defaultValue} maxLength={254} required />
    </label>
  );
}
