import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { db } from '../src/auth.ts';
import { server } from '../src/server.ts';

if (!process.env.DATABASE_URL || !process.env.REDIS_URL) throw new Error('Set isolated test database and Redis URLs');
process.env.MAPBOX_ACCESS_TOKEN = 'test-token';
process.env.ROUTE_CACHE_TTL_SECONDS = '60';
const hasCache = process.argv[2] === 'cache';
const network = globalThis.fetch;
let providerCalls = 0;
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.hostname !== 'api.mapbox.com') return network(input, init);
  assert.match(url.pathname, /^\/directions\/v5\/mapbox\/driving\//);
  assert.equal(url.searchParams.get('access_token'), 'test-token');
  providerCalls++;
  return Response.json({ code: 'Ok', routes: [{ distance: 1250.2 }] });
};

server.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
assert(address && typeof address !== 'string');
const base = `http://127.0.0.1:${address.port}`;
const email = `${randomUUID()}@example.test`;
const password = 'orders-test-password';
const pickup = { latitude: 4.81, longitude: 7 + Math.random() / 100 };
const dropoff = { latitude: 4.82, longitude: 7.02 };
let token = '';
async function post(path: string, data: object, key?: string) {
  const response = await fetch(base + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    body: JSON.stringify(data),
  });
  return { status: response.status, body: await response.json() };
}

try {
  assert.equal((await post('/orders', { pickup, dropoff })).status, 401);
  assert.equal((await post('/auth/register', { email, password, phone: hasCache ? '+2348012345601' : '+2348012345602',
    name: 'Test customer', role: 'customer' })).status, 202);
  const login = await post('/auth/login', { email, password });
  assert.equal(login.status, 200);
  token = login.body.token;
  const key = randomUUID();
  const payload = { pickup, dropoff, offeredFareKobo: 20_000, distanceMeters: 1, paymentMethod: 'cash' };
  assert.equal((await post('/orders', payload, key)).status, 403);
  await db.query('UPDATE accounts SET phone_verified=true WHERE email=$1', [email]);
  assert.equal((await post('/orders/quote', { pickup: { ...pickup, latitude: 91 }, dropoff })).status, 400);
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(await post('/orders/quote', payload), {
      status: 200, body: { distanceMeters: 1251, fareFloorKobo: 18_765, currency: 'NGN' },
    });
  }
  assert.equal(providerCalls, hasCache ? 1 : 2);
  assert.equal((await post('/orders', { ...payload, offeredFareKobo: 18_764 }, key)).status, 422);
  const results = await Promise.all([post('/orders', payload, key), post('/orders', payload, key)]);
  assert.deepEqual(results.map(({ status }) => status).sort(), [200, 201]);
  assert.equal(results[0].body.order.id, results[1].body.order.id);
  assert.equal(results[0].body.order.fareFloorKobo, 18_765);
  assert.equal(results[0].body.order.status, 'pending_dispatch');
  const beforeReplay = providerCalls;
  assert.equal((await post('/orders', payload, key)).status, 200);
  assert.equal(providerCalls, beforeReplay);
  assert.equal((await post('/orders', { ...payload, offeredFareKobo: 21_000 }, key)).status, 409);
  const { rows } = await db.query(
    `SELECT ST_X(pickup::geometry) AS longitude, ST_Y(dropoff::geometry) AS latitude
     FROM delivery_orders WHERE idempotency_key=$1`, [key],
  );
  assert.deepEqual(rows, [{ longitude: pickup.longitude, latitude: dropoff.latitude }]);
  console.log(`Quote and order integration passed (${hasCache ? 'Redis cache hit' : 'Redis unavailable'})`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.end();
}
process.exit(process.exitCode ?? 0);
