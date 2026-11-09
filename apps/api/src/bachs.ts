export function bachsKey() {
  // Sandbox "collections" are not real money, so they must never unlock real deliveries.
  if (process.env.NODE_ENV === 'production') throw new Error('Bachs sandbox credentials are not allowed in production');
  const secret = process.env.BACHS_SANDBOX_SECRET_KEY;
  if (!secret || !/^sk_sandbox_[A-Za-z0-9_-]+$/.test(secret)) throw new Error('Bachs sandbox credentials required');
  return secret;
}

export const naira = (kobo: number) =>
  `${Math.floor(kobo / 100)}.${String(kobo % 100).padStart(2, '0')}`;

export class BachsRequestError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, code?: string) {
    super(`Bachs request failed (${status})`);
    this.status = status;
    this.code = code;
  }
}

export async function bachs(path: string, options: { body?: object; key?: string; account?: string } = {}) {
  const response = await fetch('https://sandbox-api.bachs.io/v1' + path, {
    method: options.body ? 'POST' : 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
    headers: {
      Authorization: 'Bearer ' + bachsKey(),
      'Content-Type': 'application/json',
      ...(options.key ? { 'Idempotency-Key': options.key } : {}),
      ...(options.account ? { 'X-Account-Id': options.account } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new BachsRequestError(response.status, error?.error_code);
  }
  return response.json();
}

export const isProviderId = (value: unknown, prefix: string): value is string =>
  typeof value === 'string' && value.startsWith(prefix) && /^[A-Za-z0-9_-]{8,128}$/.test(value);
