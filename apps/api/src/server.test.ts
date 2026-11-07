import assert from 'node:assert/strict';
import { test } from 'node:test';
import { route } from './server.ts';

test('health, fare floor, and invalid distance', () => {
  assert.deepEqual(route('GET', '/healthz'), { status: 200, body: { status: 'ok' } });
  assert.deepEqual(route('GET', '/fare-floor?distanceMeters=1250'), {
    status: 200,
    body: { fareFloorKobo: 18_750 },
  });
  assert.equal(route('GET', '/fare-floor?distanceMeters=-1').status, 400);
  assert.equal(route('GET', '/fare-floor?distanceMeters=9007199254740991').status, 400);
});
