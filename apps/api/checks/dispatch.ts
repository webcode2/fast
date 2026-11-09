import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { once } from 'node:events';
import { db } from '../src/auth.ts';
import { server } from '../src/server.ts';

if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL to an isolated, migrated test database');
process.env.MAPBOX_ACCESS_TOKEN = 'test-token';
process.env.ROUTE_CACHE_TTL_SECONDS = '0';
const network = globalThis.fetch;
globalThis.fetch = (input, init) => new URL(String(input)).hostname === 'api.mapbox.com'
  ? Promise.resolve(Response.json({ code: 'Ok', routes: [{ distance: 1000 }] }))
  : network(input, init);
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
assert(address && typeof address !== 'string');
const base = `http://127.0.0.1:${address.port}`;

async function actor(role: string, number: number) {
  const { rows: [user] } = await db.query(
    `INSERT INTO accounts (role,email,phone,password_hash,email_verified,phone_verified)
     VALUES ($1,$2,$3,'test-only',true,true) RETURNING id`,
    [role, `${role}${number}@dispatch.example.test`, `+23480123457${number}`],
  );
  if (role === 'admin') await db.query(
    "INSERT INTO staff_role_assignments (account_id,role) VALUES ($1,'administrator')", [user.id],
  );
  const token = randomBytes(32).toString('hex');
  await db.query("INSERT INTO auth_sessions VALUES ($1,$2,now()+interval '1 hour')",
    [createHash('sha256').update(token).digest('hex'), user.id]);
  return { id: user.id, token };
}

async function request(path: string, token = '', method = 'GET', body?: object, key?: string) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}

try {
  const customer = await actor('customer', 1);
  const outsider = await actor('customer', 2);
  const first = await actor('rider', 3);
  const second = await actor('rider', 4);
  const distant = await actor('rider', 5);
  const admin = await actor('admin', 6);
  const pickup = { latitude: 4.81, longitude: 7.01 };
  const dropoff = { latitude: 4.82, longitude: 7.02 };
  const payload = { pickup, dropoff, offeredFareKobo: 20_000, paymentMethod: 'cash' };
  assert.equal((await request('/orders/quote', '', 'POST', payload)).status, 200);
  assert.equal((await request('/orders', '', 'POST', payload)).status, 401);
  const online = { available: true, location: pickup };
  assert.equal((await request('/dispatch/availability', customer.token)).status, 403);
  assert.deepEqual((await request('/dispatch/availability', first.token)).body, {
    identityApproved: false, available: false, commissionOverdue: false, activeTripId: null,
  });
  assert.equal((await request('/dispatch/availability', first.token, 'PUT', online)).status, 409);
  assert.equal((await request(`/dispatch/riders/${first.id}/identity`, first.token, 'POST', { approved: true })).status, 403);
  for (const rider of [first, second, distant]) {
    assert.equal((await request(`/dispatch/riders/${rider.id}/identity`, admin.token, 'POST', { approved: true })).status, 200);
    const location = rider === distant ? { ...pickup, latitude: 5.5 } : pickup;
    assert.equal((await request('/dispatch/availability', rider.token, 'PUT', { available: true, location })).status, 200);
  }

  assert.equal((await request('/dispatch/availability', first.token)).body.available, true);
  await db.query("UPDATE rider_dispatch SET location_at=now()-interval '3 minutes' WHERE rider_id=$1", [first.id]);
  assert.equal((await request('/dispatch/availability', first.token)).body.available, false);
  assert.equal((await request('/dispatch/availability', first.token, 'PUT', online)).status, 200);
  const order = await request('/orders', customer.token, 'POST', payload, '8abce144-aa70-4eca-b9bc-1ef281112001');
  assert.equal(order.status, 201);
  const path = '/orders/' + order.body.order.id;
  assert.equal((await request(path + '/bids', outsider.token)).status, 404);
  assert.equal((await request('/dispatch/nearby', distant.token)).body.orders.length, 0);
  assert.equal((await request('/dispatch/nearby', first.token)).body.orders[0].id, order.body.order.id);
  assert.equal((await request(path + '/claim', distant.token, 'POST', {})).status, 409);
  assert.equal((await request(path + '/bids', first.token, 'POST', { fareKobo: 14_999 })).status, 422);
  const bid = await request(path + '/bids', first.token, 'POST', { fareKobo: 21_000 });
  assert.equal(bid.status, 200);
  const stream = await fetch(base + path + '/bids/stream', {
    headers: { Authorization: `Bearer ${customer.token}` },
  });
  assert.match(stream.headers.get('content-type') ?? '', /text\/event-stream/);
  const reader = stream.body!.getReader();
  const snapshot = new TextDecoder().decode((await reader.read()).value);
  assert.match(snapshot, /21000/);
  assert.equal((await request(path + '/bids', first.token, 'POST', { fareKobo: 22_000 })).status, 200);
  const changed = new TextDecoder().decode((await reader.read()).value);
  assert.match(changed, /22000/);
  await reader.cancel();
  assert.equal((await request(path + '/accept', customer.token, 'POST', {
    bidId: bid.body.bid.id, fareKobo: 21_000,
  })).status, 409);
  const race = await Promise.all([
    request(path + '/claim', second.token, 'POST', {}),
    request(path + '/accept', customer.token, 'POST', { bidId: bid.body.bid.id, fareKobo: 22_000 }),
  ]);
  assert.deepEqual(race.map(({ status }) => status).sort(), [200, 409]);
  const winner = race.find(({ status }) => status === 200)!.body.assignment;
  const view = await request(path + '/bids', customer.token);
  assert.equal(view.body.order.assignedRiderId, winner.assignedRiderId);
  assert.equal(view.body.order.agreedFareKobo, winner.agreedFareKobo);
  const assigned = winner.assignedRiderId === first.id ? first : second;
  const free = assigned === first ? second : first;
  assert.equal((await request('/dispatch/availability', assigned.token, 'PUT', online)).status, 409);

  assert.equal((await request('/dispatch/availability', distant.token, 'PUT', online)).status, 200);
  const secondOrder = await request('/orders', customer.token, 'POST', payload, '8abce144-aa70-4eca-b9bc-1ef281112002');
  assert.equal(secondOrder.status, 201);
  const claimPath = `/orders/${secondOrder.body.order.id}/claim`;
  const claims = await Promise.all([
    request(claimPath, free.token, 'POST', {}),
    request(claimPath, distant.token, 'POST', {}),
  ]);
  assert.deepEqual(claims.map(({ status }) => status).sort(), [200, 409]);
  const available = claims[0].status === 200 ? distant : free;

  const expired = await request('/orders', customer.token, 'POST', payload, '8abce144-aa70-4eca-b9bc-1ef281112003');
  assert.equal(expired.status, 201);
  const expiredId = expired.body.order.id;
  await db.query("UPDATE delivery_orders SET bidding_expires_at=now()-interval '1 second' WHERE id=$1", [expiredId]);
  assert.equal((await request(`/orders/${expiredId}/claim`, available.token, 'POST', {})).status, 409);
  assert.equal((await request(`/orders/${expiredId}/bids`, customer.token)).body.order.status, 'expired');
  assert.equal((await request('/dispatch/availability', assigned.token)).body.activeTripId, winner.id);
  const tripPath = '/trips/' + winner.id;
  assert.equal((await request(tripPath, outsider.token)).status, 404);
  assert.equal((await request(tripPath, assigned.token)).body.trip.status, 'assigned');
  assert.equal((await request(tripPath + '/pickup', customer.token, 'POST')).status, 403);
  assert.equal((await request(tripPath + '/complete', assigned.token, 'POST')).status, 409);
  assert.equal((await request(tripPath + '/pickup', assigned.token, 'POST')).body.trip.status, 'picked_up');
  assert.equal((await request('/dispatch/availability', assigned.token, 'PUT', online)).status, 409);

  const updates = await fetch(base + tripPath + '/stream', {
    headers: { Authorization: `Bearer ${customer.token}` },
  });
  assert.match(updates.headers.get('content-type') ?? '', /text\/event-stream/);
  const locations = updates.body!.getReader();
  assert.match(new TextDecoder().decode((await locations.read()).value), /"riderLocation":null/);
  const recordedAtMs = Date.now();
  const location = { location: pickup, recordedAtMs };
  assert.equal((await request(tripPath + '/location', available.token, 'POST', location)).status, 409);
  assert.equal((await request(tripPath + '/location', assigned.token, 'POST', location)).status, 200);
  assert.equal((await request(tripPath + '/location', assigned.token, 'POST', location)).status, 409);
  assert.equal((await request(tripPath + '/location', assigned.token, 'POST', {
    location: { latitude: 9, longitude: 9 }, recordedAtMs: recordedAtMs + 1000,
  })).status, 409);
  assert.match(new TextDecoder().decode((await locations.read()).value), /"riderLocation":\{/);
  const completed = await request(tripPath + '/complete', assigned.token, 'POST');
  assert.equal(completed.body.trip.status, 'completed');
  assert.equal(completed.body.trip.riderLocation, null);
  assert.equal((await request(tripPath + '/complete', assigned.token, 'POST')).body.trip.completedAt,
    completed.body.trip.completedAt);
  assert.match(new TextDecoder().decode((await locations.read()).value), /"status":"completed"/);
  await locations.cancel();
  assert.equal((await request(tripPath + '/location', assigned.token, 'POST', {
    ...location, recordedAtMs: Date.now(),
  })).status, 409);
  assert.equal((await request('/dispatch/availability', assigned.token, 'PUT', online)).status, 200);
  const report = { details: 'The parcel was marked complete but never arrived.' };
  assert.equal((await request(tripPath + '/dispute', outsider.token, 'POST', report)).status, 404);
  assert.equal((await request(tripPath + '/review', assigned.token, 'POST', { rating: 5 })).status, 403);
  assert.equal((await request('/trips/' + secondOrder.body.order.id + '/dispute', customer.token, 'POST', report)).status, 404);
  const filed = await request(tripPath + '/dispute', customer.token, 'POST', report);
  assert.equal(filed.body.dispute.status, 'open');
  assert.equal((await request(tripPath + '/dispute', customer.token, 'POST', report)).body.dispute.createdAt,
    filed.body.dispute.createdAt);
  assert.equal((await request(tripPath + '/dispute', customer.token, 'POST', { details: 'Changed' })).status, 409);
  assert.equal((await request(tripPath + '/review', customer.token, 'POST', { rating: 0 })).status, 400);
  assert.equal((await request(tripPath + '/review', customer.token, 'POST', { rating: 1, comment: 'Missing parcel' })).body.review.rating, 1);
  assert.equal((await request('/admin/disputes', customer.token)).status, 403);
  assert.ok((await request('/admin/disputes', admin.token)).body.disputes
    .some((item: { orderId: string }) => item.orderId === winner.id));
  const resolvePath = '/admin/disputes/' + winner.id + '/resolve';
  const decisions = [
    { decision: 'upheld', resolution: 'The investigation confirmed non-delivery.' },
    { decision: 'dismissed', resolution: 'The investigation confirmed delivery.' },
  ];
  const resolutions = await Promise.all(decisions.map((body) => request(resolvePath, admin.token, 'POST', body)));
  assert.deepEqual(resolutions.map(({ status }) => status).sort(), [200, 409]);
  const resolution = resolutions.find(({ status }) => status === 200)!.body.dispute;
  const retry = await request(resolvePath, admin.token, 'POST', {
    decision: resolution.status, resolution: resolution.resolution,
  });
  assert.equal(retry.body.dispute.resolvedAt, resolution.resolvedAt);
  assert.ok(!(await request('/admin/disputes', admin.token)).body.disputes
    .some((item: { orderId: string }) => item.orderId === winner.id));
  const feedback = await request(tripPath + '/feedback', customer.token);
  assert.equal(feedback.body.review.rating, 1);
  assert.equal(feedback.body.dispute.status, resolution.status);
  assert.equal(feedback.body.dispute.resolved_by, undefined);
  assert.equal((await request('/trips/feedback', customer.token)).body.trips[0].disputeStatus, resolution.status);
  console.log('Completed-trip review, dispute ownership, and concurrent resolution passed');

  const recovery = await request('/orders', customer.token, 'POST', payload, '8abce144-aa70-4eca-b9bc-1ef281112004');
  assert.equal(recovery.status, 201);
  const recoveryId = recovery.body.order.id;
  const recoveryOrder = '/orders/' + recoveryId;
  const recoveryTrip = '/trips/' + recoveryId;
  assert.equal((await request(recoveryOrder + '/claim', assigned.token, 'POST', {})).status, 200);
  assert.equal((await request(recoveryTrip + '/replace', customer.token, 'POST')).status, 409);
  assert.equal((await request(recoveryTrip + '/cancel', assigned.token, 'POST')).body.status, 'pending_dispatch');
  assert.equal((await request('/dispatch/availability', assigned.token, 'PUT', online)).status, 200);
  assert.equal((await request(recoveryOrder + '/claim', assigned.token, 'POST', {})).status, 409);
  assert.equal((await request(recoveryOrder + '/claim', available.token, 'POST', {})).status, 200);
  await db.query("UPDATE delivery_orders SET assigned_at=now()-interval '11 minutes' WHERE id=$1", [recoveryId]);
  assert.equal((await request(recoveryTrip, customer.token)).body.trip.trackingDropout, true);
  assert.equal((await request('/trips/recovery-alerts', outsider.token)).status, 403);
  assert.ok((await request('/trips/recovery-alerts', admin.token)).body.alerts
    .some((alert: { id: string }) => alert.id === recoveryId));
  assert.equal((await request(recoveryTrip + '/replace', customer.token, 'POST')).body.status, 'pending_dispatch');

  const noShow = await request('/orders', customer.token, 'POST', payload, '8abce144-aa70-4eca-b9bc-1ef281112005');
  assert.equal(noShow.status, 201);
  const noShowId = noShow.body.order.id;
  const noShowTrip = '/trips/' + noShowId;
  assert.equal((await request('/orders/' + noShowId + '/claim', assigned.token, 'POST', {})).status, 200);
  assert.equal((await request(noShowTrip + '/pickup', assigned.token, 'POST')).status, 200);
  assert.equal((await request(noShowTrip + '/cancel', assigned.token, 'POST')).body.status, 'support_requested');
  assert.equal((await request(noShowTrip, customer.token)).body.trip.status, 'picked_up');
  assert.ok((await request('/trips/recovery-alerts', admin.token)).body.alerts
    .some((alert: { id: string; recoveryRequestedAt: string }) => alert.id === noShowId && alert.recoveryRequestedAt));
  const sample = Date.now();
  assert.equal((await request(noShowTrip + '/location', assigned.token, 'POST', {
    location: dropoff, recordedAtMs: sample,
  })).status, 200);
  assert.ok((await request(noShowTrip, customer.token)).body.trip.noShowEligibleAt);
  assert.equal((await request(noShowTrip + '/no-show', assigned.token, 'POST')).status, 409);
  assert.equal((await request(noShowTrip + '/location', assigned.token, 'POST', {
    location: { ...dropoff, latitude: dropoff.latitude + 0.0012 }, recordedAtMs: sample + 4000,
  })).status, 200);
  assert.equal((await request(noShowTrip, customer.token)).body.trip.noShowEligibleAt, null);
  assert.equal((await request(noShowTrip + '/location', assigned.token, 'POST', {
    location: dropoff, recordedAtMs: sample + 4900,
  })).status, 409);
  // Simulate the preceding ten minutes of accepted in-zone observations.
  await db.query(
    `UPDATE delivery_orders SET dropoff_wait_started_at=now()-interval '11 minutes',
       rider_location=dropoff, rider_location_at=now(), tracking_received_at=now() WHERE id=$1`, [noShowId],
  );
  assert.equal((await request(noShowTrip + '/no-show', assigned.token, 'POST')).body.status, 'customer_unavailable');
  assert.equal((await request(noShowTrip + '/no-show', assigned.token, 'POST')).status, 200);
  assert.equal((await request(noShowTrip, customer.token)).body.trip.riderLocation, null);
  assert.equal((await request('/dispatch/availability', assigned.token, 'PUT', online)).status, 200);
  console.log('Cancellation, re-bidding, dropout alerts, support escalation, and no-show passed');
  console.log('Trip access, tracking stream, pickup, idempotent completion, and rider release passed');
  console.log('Guest quote, rider eligibility, live bid updates, expiry, and exactly one assignment passed');
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.end();
}
