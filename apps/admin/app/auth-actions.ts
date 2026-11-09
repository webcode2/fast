'use server';

import { redirect } from 'next/navigation';
import { adminProfile, authRequest, setAdminSession } from './admin-auth';

const actions = {
  login: ['/login', 'POST', ['email', 'password']],
  requestReset: ['/reset/request', 'POST', ['email']],
  reset: ['/reset', 'POST', ['email', 'code', 'password']],
  name: ['/profile', 'PATCH', ['name']],
  sendEmail: ['/verify/request', 'POST', []],
  verifyEmail: ['/verify', 'POST', ['code']],
  sendPhone: ['/verify/request', 'POST', []],
  verifyPhone: ['/verify', 'POST', ['code']],
  password: ['/password', 'POST', ['currentPassword', 'password']],
  logout: ['/logout', 'POST', []],
} as const;

export async function submitAuth(action: keyof typeof actions, form: FormData) {
  if (!Object.hasOwn(actions, action)) throw new Error('Invalid action');
  const [path, method, fields] = actions[action];
  const publicAction = ['login', 'requestReset', 'reset'].includes(action);
  let destination = publicAction ? '/login' : '/account';
  let message = 'Saved.';
  try {
    if (!publicAction && !await adminProfile()) {
      destination = '/login';
      message = 'Sign in required.';
    } else {
      const body = Object.fromEntries(fields.map((field) => [field, String(form.get(field) ?? '')]));
      if (action === 'login') body.client = 'admin';
      if (action.endsWith('Email')) body.purpose = 'email';
      if (action.endsWith('Phone')) body.purpose = 'phone';
      const { status, data } = await authRequest(path, method, body);
      if (status >= 400) {
        message = data.error ?? 'Request failed.';
      } else if (action === 'login') {
        await setAdminSession(data.token);
        destination = '/';
        message = '';
      } else if (action === 'password' || action === 'logout') {
        await setAdminSession();
        destination = '/login';
        message = action === 'password' ? 'Password updated. Sign in again.' : '';
      } else if (action === 'requestReset') {
        message = 'If the account has a verified email, a code will be sent.';
      } else if (action === 'sendEmail' || action === 'sendPhone') {
        message = 'Verification code requested.';
      } else if (action === 'reset') {
        message = 'Password reset. Sign in with your new password.';
      }
    }
  } catch {
    message = 'Authentication is temporarily unavailable.';
  }
  redirect(message ? destination + '?message=' + encodeURIComponent(message) : destination);
}
