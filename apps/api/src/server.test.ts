import assert from 'node:assert/strict';
import { test } from 'node:test';
import { route } from './server.ts';

test('health and removal of caller-supplied distance', () => {
  assert.deepEqual(route('GET', '/healthz'), { status: 200, body: { status: 'ok' } });
  assert.equal(route('GET', '/fare-floor?distanceMeters=1250').status, 404);
});
