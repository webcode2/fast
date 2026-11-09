import 'server-only';
import { cookies } from 'next/headers';

const cookie = 'fast_logistics_admin';
const api = process.env.AUTH_API_URL ?? 'http://127.0.0.1:8080';

export async function authRequest(path: string, method = 'GET', body?: Record<string, unknown>) {
  return apiRequest('/auth' + path, method, body);
}

export async function apiRequest(path: string, method = 'GET', body?: Record<string, unknown>) {
  const token = (await cookies()).get(cookie)?.value;
  const response = await fetch(api + path, {
    method,
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
    headers: {
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, data: await response.json() };
}

export async function adminProfile() {
  const { status, data } = await authRequest('/profile');
  if (status !== 200 && status !== 401) throw new Error('Authentication service unavailable');
  return ['admin', 'staff'].includes(data.user?.role) ? data.user : null;
}

export async function setAdminSession(token?: string) {
  const store = await cookies();
  if (!token) {
    store.delete(cookie);
    return;
  }
  store.set(cookie, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 86_400,
  });
}
