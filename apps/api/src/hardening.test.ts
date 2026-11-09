import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { afterEach, test } from 'node:test';
import { bachsKey } from './bachs.ts';
import { clientAddress, configProblems, describeError } from './runtime.ts';

const request = (forwarded?: string) =>
  ({ headers: forwarded ? { 'x-forwarded-for': forwarded } : {}, socket: { remoteAddress: '127.0.0.1' } }) as unknown as IncomingMessage;

test('without a trusted proxy, forwarded headers are ignored', () => {
  assert.equal(clientAddress(request('6.6.6.6'), {}), '127.0.0.1');
});

test('behind a trusted proxy, only the hop it added counts', () => {
  const env = { TRUST_PROXY: '1' };
  assert.equal(clientAddress(request('6.6.6.6, 41.58.1.2'), env), '41.58.1.2', 'A visitor cannot spoof the first entries');
  assert.equal(clientAddress(request(), env), '127.0.0.1');
});

test('startup names missing settings without printing values', () => {
  const problems = configProblems('api', { AUTH_CODE_SECRET: 'too-short' });
  assert.ok(problems.includes('DATABASE_URL is required'));
  assert.ok(problems.some((problem) => problem.startsWith('AUTH_CODE_SECRET')));
  assert.ok(!problems.join().includes('too-short'));
  assert.deepEqual(configProblems('api', { DATABASE_URL: 'x', AUTH_CODE_SECRET: 'a'.repeat(32) }), []);
});

test('production needs delivery, maps, and the proxy setting', () => {
  const problems = configProblems('api', { NODE_ENV: 'production', DATABASE_URL: 'x', AUTH_CODE_SECRET: 'a'.repeat(32) });
  for (const name of ['MAPBOX_ACCESS_TOKEN', 'AUTH_DELIVERY_TOKEN', 'AUTH_DELIVERY_WEBHOOK', 'TRUST_PROXY']) {
    assert.ok(problems.some((problem) => problem.startsWith(name)), name);
  }
});

test('worker settings are checked separately', () => {
  assert.deepEqual(configProblems('accounts', { DATABASE_URL: 'x' }), ['ACCOUNT_ARCHIVE_KEY is required']);
  assert.deepEqual(configProblems('payments', { DATABASE_URL: 'x' }), ['BACHS_SANDBOX_SECRET_KEY is required']);
});

test('errors are described by type and code', () => {
  const error = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
  assert.equal(describeError(error), 'Error timeout code=ETIMEDOUT');
  assert.equal(describeError('Bearer secret'), 'Unknown error');
});

const nodeEnv = process.env.NODE_ENV;
const key = process.env.BACHS_SANDBOX_SECRET_KEY;
afterEach(() => {
  process.env.NODE_ENV = nodeEnv;
  process.env.BACHS_SANDBOX_SECRET_KEY = key;
});

test('sandbox payment keys are refused in production', () => {
  process.env.BACHS_SANDBOX_SECRET_KEY = 'sk_sandbox_localcheck';
  process.env.NODE_ENV = 'development';
  assert.equal(bachsKey(), 'sk_sandbox_localcheck');
  process.env.NODE_ENV = 'production';
  assert.throws(bachsKey, /not allowed in production/);
});
