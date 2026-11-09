import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { db } from '../src/auth.ts';
import { server } from '../src/server.ts';
import { routeUpdatesSettled } from '../src/trip-route.ts';

if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL to an isolated, migrated test database');
process.env.MAPBOX_ACCESS_TOKEN = 'test-token';
process.env.ROUTE_CACHE_TTL_SECONDS = '0';
const network = globalThis.fetch;
const routedFrom: string[] = [];
globalThis.fetch = (input, init) => {
  const url = new URL(String(input));
  if (url.hostname !== 'api.mapbox.com') return network(input, init);
  const [from, to] = url.pathname.split('/').at(-1)!.split(';').map((pair) => pair.split(',').map(Number));
  routedFrom.push(`${from[1]},${from[0]}`);
  return Promise.resolve(Response.json({ code: 'Ok', routes: [{
    distance: 1500,
    geometry: { coordinates: [from, [from[0], to[1]], to] },
  }] }));
};
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
assert(address && typeof address !== 'string');
const base = `http://127.0.0.1:${address.port}`;
const unique = randomBytes(4).readUInt32BE() % 100_000_000;

async function actor(role: string, offset: number) {
  const { rows: [user] } = await db.query(
    `INSERT INTO accounts (role,email,phone,password_hash,email_verified,phone_verified)
     VALUES ($1,$2,$3,'test-only',true,true) RETURNING id`,
    [role, `${randomUUID()}@route.example.test`, `+234${800_000_000_0 + unique + offset}`],
  );
  const token = randomBytes(32).toString('hex');
  await db.query("INSERT INTO auth_sessions VALUES ($1,$2,now()+interval '1 hour')",
    [createHash('sha256').update(token).digest('hex'), user.id]);
  return { id: user.id, token };
}

async function request(path: string, token: string, method = 'GET', body?: object, key?: string) {
  const response = await fetch(base + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}

try {
  const customer = await actor('customer', 1);
  const rider = await actor('rider', 2);
  const outsider = await actor('customer', 3);
  const otherRider = await actor('rider', 4);
  const admin = await actor('admin', 5);
  await db.query("INSERT INTO staff_role_assignments (account_id,role) VALUES ($1,'administrator')", [admin.id]);
  const pickup = { latitude: 4.81, longitude: 7.01 };
  const dropoff = { latitude: 4.82, longitude: 7.02 };

  const quote = await request('/orders/quote', customer.token, 'POST', { pickup, dropoff });
  assert.deepEqual(quote.body.path, [[4.81, 7.01], [4.82, 7.01], [4.82, 7.02]]);
  assert.equal(quote.body.distanceMeters, 1500);
  const placed = await request('/orders', customer.token, 'POST',
    { pickup, dropoff, offeredFareKobo: 50_000, paymentMethod: 'cash' }, randomUUID());
  const id = placed.body.order.id;
  await db.query(
    `UPDATE delivery_orders SET status='picked_up', assigned_rider_id=$2, agreed_fare_kobo=50000,
       assigned_at=now(), picked_up_at=now() WHERE id=$1`, [id, rider.id],
  );
  const trip = `/trips/${id}`;

  assert.equal((await request(`${trip}/route`, outsider.token)).status, 404);
  const booked = await request(`${trip}/route`, customer.token);
  assert.deepEqual(booked.body.route.path, quote.body.path, 'Before GPS, both sides see the booked road route');
  assert.equal(booked.body.route.updatedAt, null);

  let at = Date.now() - 60_000;
  const ping = async (location: typeof pickup) => {
    const result = await request(`${trip}/location`, rider.token, 'POST', { location, recordedAtMs: at += 10_000 });
    await routeUpdatesSettled();
    return result;
  };

  routedFrom.length = 0;
  assert.equal((await ping({ latitude: 4.811, longitude: 7.01 })).status, 200);
  assert.deepEqual(routedFrom, ['4.811,7.01'], 'The first GPS point starts a live road route');
  const live = await request(`${trip}/route`, rider.token);
  assert.equal(live.body.route.target, 'dropoff');
  const started = (await request(trip, customer.token)).body.trip.routeUpdatedAt;
  assert.ok(started);

  assert.equal((await ping({ latitude: 4.814, longitude: 7.01 })).status, 200);
  assert.equal(routedFrom.length, 1, 'Riding along the road does not call the provider');

  await db.query("UPDATE trip_routes SET updated_at=now()-interval '1 minute' WHERE order_id=$1", [id]);
  const wrongTurn = { latitude: 4.814, longitude: 7.0125 };
  assert.equal((await ping(wrongTurn)).status, 200);
  assert.equal(routedFrom.length, 1, 'One far reading could be GPS drift');
  assert.equal((await ping(wrongTurn)).status, 200);
  assert.deepEqual(routedFrom.at(-1), '4.814,7.0125', 'A confirmed missed turn routes from the rider position');
  const rerouted = (await request(trip, customer.token)).body.trip;
  assert.notEqual(rerouted.routeUpdatedAt, started, 'Both sides can see the route changed');
  assert.deepEqual((await request(`${trip}/route`, customer.token)).body.route.path[0], [4.814, 7.0125]);
  const { rows: [order] } = await db.query(
    'SELECT route_distance_meters, fare_floor_kobo, agreed_fare_kobo FROM delivery_orders WHERE id=$1', [id],
  );
  assert.deepEqual(order, { route_distance_meters: 1500, fare_floor_kobo: 22_500, agreed_fare_kobo: 50_000 },
    'A new route never changes the booked distance or agreed fare');

  routedFrom.length = 0;
  await db.query("UPDATE trip_routes SET updated_at=now()-interval '1 minute' WHERE order_id=$1", [id]);
  globalThis.fetch = (input, init) => new URL(String(input)).hostname === 'api.mapbox.com'
    ? Promise.resolve(new Response('{}', { status: 500 }))
    : network(input, init);
  const lost = { latitude: 4.814, longitude: 7.014 };
  assert.equal((await ping(lost)).status, 200);
  assert.equal((await ping(lost)).status, 200, 'A provider outage never stops tracking');

  assert.equal((await request(trip, rider.token)).body.trip.atStop, null, 'Riding is not arriving');
  await db.query(
    'UPDATE delivery_orders SET rider_location=dropoff, rider_location_at=now() WHERE id=$1', [id],
  );
  assert.equal((await request(trip, rider.token)).body.trip.atStop, 'dropoff');
  await db.query("UPDATE delivery_orders SET rider_location_at=now()-interval '3 minutes' WHERE id=$1", [id]);
  assert.equal((await request(trip, rider.token)).body.trip.atStop, null, 'Old GPS never announces an arrival');

  const issues = `${trip}/issues`;
  const report = { category: 'safety', details: 'Followed by a car' };
  assert.equal((await request(issues, customer.token, 'POST', report)).status, 403);
  assert.equal((await request(issues, otherRider.token, 'POST', report)).status, 404);
  assert.equal((await request(issues, rider.token, 'POST', { category: 'bad' })).status, 400);
  assert.equal((await request(issues, rider.token, 'POST', { category: 'other' })).status, 400);
  assert.equal((await request(issues, rider.token, 'POST', { category: 'other', details: 'Gate locked' })).status, 201);
  const reported = await request(issues, rider.token, 'POST', report);
  assert.equal(reported.status, 201);
  assert.equal((await request('/trips/issues', rider.token)).status, 403);
  const queue = await request('/trips/issues', admin.token);
  assert.equal(queue.body.issues[0].category, 'safety', 'Safety reports come first');
  assert.equal(queue.body.issues[0].orderId, id);
  const resolve = `/trips/issues/${reported.body.issue.id}/resolve`;
  assert.equal((await request(resolve, rider.token, 'POST', {})).status, 403);
  assert.equal((await request(resolve, admin.token, 'POST', {})).status, 200);
  assert.equal((await request(resolve, admin.token, 'POST', {})).status, 409);
  assert.equal((await request('/trips/issues', admin.token)).body.issues.length, 1);

  assert.equal((await request(`${trip}/complete`, rider.token, 'POST')).status, 200);
  const { rowCount } = await db.query('SELECT 1 FROM trip_routes WHERE order_id=$1', [id]);
  assert.equal(rowCount, 0, 'Live routes end with the trip');
  console.log('Road routes, missed turns, arrival status, rider reports, and fare stability passed');
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.end();
}
