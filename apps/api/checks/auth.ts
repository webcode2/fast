import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';

if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL to an isolated, migrated test database');
const base = 'http://127.0.0.1:18080';
const api = spawn(process.execPath, ['src/server.ts'], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, PORT: '18080', NODE_ENV: 'test', AUTH_DEV_CODES: '1',
    AUTH_CODE_SECRET: randomBytes(32).toString('hex'), AUTH_DELIVERY_WEBHOOK: '' },
});
let output = '';
api.stdout.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
api.stderr.pipe(process.stderr);

async function request(path: string, data?: object, token?: string, method = data ? 'POST' : 'GET') {
  const response = await fetch(base + '/auth' + path, {
    method,
    headers: {
      ...(data ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  return { status: response.status, body: await response.json() };
}

async function waitFor<T>(read: () => Promise<T | undefined> | T | undefined): Promise<T> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for the API');
}

try {
  await waitFor(async () => {
    try { return (await fetch(base + '/healthz')).ok ? true : undefined; } catch { return undefined; }
  });
  const email = 'rider@example.test';
  const password = 'first-password-123';
  const changedPassword = 'changed-password-123';
  const resetPassword = 'reset-password-123';
  const registration = { email, password, phone: '+2348012345678', name: 'Test rider' };
  assert.equal((await request('/register', { ...registration, role: 'admin' })).status, 400);
  assert.equal((await request('/register', { ...registration, role: 'rider' })).status, 202);
  assert.equal((await request('/login', { email, password, client: 'admin' })).status, 403);

  const attempts = await Promise.all([
    request('/login', { email, password, client: 'mobile' }),
    request('/login', { email, password, client: 'mobile' }),
  ]);
  assert.deepEqual(attempts.map(({ status }) => status).sort(), [200, 409]);
  const token = attempts.find(({ status }) => status === 200)!.body.token as string;
  assert.equal((await request('/profile')).status, 401);
  assert.equal((await request('/profile', { name: 'Updated rider' }, token, 'PATCH')).body.user.name, 'Updated rider');
  for (const purpose of ['email', 'phone']) {
    assert.equal((await request('/verify/request', { purpose }, token)).status, 202);
    const code = await waitFor(() => output.match(new RegExp(`Local auth code \\(${purpose}\\): (\\d{6})`))?.[1]);
    assert.equal((await request('/verify', { purpose, code }, token)).status, 200);
  }
  const { body: { user } } = await request('/profile', undefined, token);
  assert.equal(user.email_verified, true);
  assert.equal(user.phone_verified, true);
  assert.equal(user.password_hash, undefined);
  assert.equal((await request('/password', { currentPassword: password, password: changedPassword }, token)).status, 200);
  assert.equal((await request('/profile', undefined, token)).status, 401);
  const changedLogin = await request('/login', { email, password: changedPassword });
  assert.equal(changedLogin.status, 200);

  assert.equal((await request('/reset/request', { email })).status, 202);
  const code = await waitFor(() => output.match(/Local auth code \(reset\): (\d{6})/)?.[1]);
  assert.equal((await request('/reset', { email, code, password: resetPassword })).status, 200);
  assert.equal((await request('/reset', { email, code, password: resetPassword })).status, 400);
  assert.equal((await request('/profile', undefined, changedLogin.body.token)).status, 401);
  const resetLogin = await request('/login', { email, password: resetPassword });
  assert.equal(resetLogin.status, 200);
  assert.equal((await request('/logout', {}, resetLogin.body.token)).status, 200);
  assert.equal((await request('/profile', undefined, resetLogin.body.token)).status, 401);
  assert.equal((await request('/login', { email, password: resetPassword })).status, 200);
  console.log('Auth lifecycle and concurrent rider login passed');
} finally {
  if (api.exitCode === null) {
    api.kill();
    await once(api, 'exit');
  }
}
