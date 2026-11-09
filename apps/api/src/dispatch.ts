import { hasStaffPermission } from './staff.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { authenticatedAccount, db, limited, readJson } from './auth.ts';
import { point, uuid } from './orders.ts';
import { unpaidCashCommission } from './commission.ts';

const radiusMeters = 5000;
const locationMaxAgeSeconds = 120;
const send = (status: number, body: object) => ({ status, body });
const unavailable = () => send(409, { error: 'This delivery or rider is no longer available' });
const riderReady = `r.identity_verified_at IS NOT NULL AND r.available
  AND r.location_at > clock_timestamp() - make_interval(secs => ${locationMaxAgeSeconds})
  AND NOT EXISTS (${unpaidCashCommission('r.rider_id')})
  AND NOT EXISTS (SELECT 1 FROM delivery_orders active
    WHERE active.assigned_rider_id=r.rider_id AND active.status IN ('assigned','picked_up'))`;
const withinRange = `ST_DWithin(o.pickup,r.location,${radiusMeters})`;
const riderOrderEligible = `NOT EXISTS (
  SELECT 1 FROM trip_recovery_events e WHERE e.order_id=o.id AND e.rider_id=r.rider_id
    AND e.reason IN ('rider_cancelled','replacement_requested'))
  AND (o.bidding_expires_at <= clock_timestamp()+interval '50 seconds'
    OR 2 > (SELECT count(*) FROM trip_recovery_events e WHERE e.rider_id=r.rider_id
      AND e.reason='rider_cancelled' AND e.created_at>clock_timestamp()-interval '24 hours'))`;
const open = `o.status='pending_dispatch' AND o.bidding_expires_at>clock_timestamp()`;
const orderStatus = `CASE WHEN o.status='pending_dispatch' AND o.bidding_expires_at<=clock_timestamp()
  THEN 'expired' ELSE o.status END`;

export function isDispatchPath(path: string) {
  return path.startsWith('/dispatch/') || path.startsWith('/orders/') && path !== '/orders/quote';
}

export async function dispatch(request: IncomingMessage, path: string) {
  const account = await authenticatedAccount(request);
  if (!account) return send(401, { error: 'Sign in required' });

  const method = request.method;
  if (path === '/dispatch/availability' && method === 'GET') {
    if (account.role !== 'rider') return send(403, { error: 'Rider access required' });
    const { rows: [state] } = await db.query(
      `SELECT r.identity_verified_at IS NOT NULL AS "identityApproved",
         COALESCE((${riderReady}),false) AS available,
         EXISTS (${unpaidCashCommission('a.id')}) AS "commissionOverdue",
         (SELECT id FROM delivery_orders WHERE assigned_rider_id=a.id
           AND status IN ('assigned','picked_up')) AS "activeTripId"
       FROM accounts a LEFT JOIN rider_dispatch r ON r.rider_id=a.id WHERE a.id=$1`, [account.id],
    );
    return send(200, state);
  }

  if (path === '/dispatch/nearby' && method === 'GET') {
    if (account.role !== 'rider') return send(403, { error: 'Rider access required' });
    const { rows } = await db.query(
      `SELECT o.id, o.offered_fare_kobo AS "offeredFareKobo", o.fare_floor_kobo AS "fareFloorKobo",
        o.payment_method AS "paymentMethod", o.route_distance_meters AS "distanceMeters", o.bidding_expires_at AS "biddingExpiresAt",
        o.pickup_label AS "pickupLabel", o.dropoff_label AS "dropoffLabel",
        round(ST_Distance(o.pickup,r.location)) AS "pickupDistanceMeters"
       FROM rider_dispatch r JOIN delivery_orders o ON ${withinRange}
       WHERE r.rider_id=$1 AND ${riderReady} AND ${open} AND ${riderOrderEligible}
       ORDER BY o.bidding_expires_at, o.id LIMIT 50`, [account.id],
    );
    return send(200, { orders: rows });
  }

  const match = path.match(/^\/orders\/([^/]+)\/(bids|claim|accept)$/);
  const orderId = match?.[1];
  if (orderId && !uuid.test(orderId)) return send(400, { error: 'Invalid order ID' });
  const action = match?.[2];
  if (action === 'bids' && method === 'GET') {
    const { rows: [order] } = await db.query(
      `SELECT o.id, ${orderStatus} AS status, o.bidding_expires_at AS "biddingExpiresAt",
         o.offered_fare_kobo AS "offeredFareKobo", o.payment_method AS "paymentMethod", o.assigned_rider_id AS "assignedRiderId", o.agreed_fare_kobo AS "agreedFareKobo",
         o.route_distance_meters AS "distanceMeters", o.pickup_label AS "pickupLabel", o.dropoff_label AS "dropoffLabel",
         json_build_object('latitude', ST_Y(o.pickup::geometry), 'longitude', ST_X(o.pickup::geometry)) AS pickup,
         json_build_object('latitude', ST_Y(o.dropoff::geometry), 'longitude', ST_X(o.dropoff::geometry)) AS dropoff,
         COALESCE((SELECT json_agg(json_build_object('id', b.id, 'riderId', b.rider_id,
           'fareKobo', b.fare_kobo) ORDER BY b.created_at, b.id)
           FROM delivery_bids b WHERE b.order_id=o.id), '[]'::json) AS bids
       FROM delivery_orders o WHERE o.id=$1 AND o.customer_id=$2`, [orderId, account.id],
    );
    return order ? send(200, { order }) : send(404, { error: 'Order not found' });
  }

  if (method !== 'POST' && method !== 'PUT') return send(405, { error: 'Method not supported' });
  const input = await readJson(request).catch(() => null);
  if (!input) return send(400, { error: 'Invalid request body' });
  if (path === '/dispatch/availability' && method === 'PUT') {
    if (account.role !== 'rider') return send(403, { error: 'Rider access required' });
    if (await limited(`availability:${account.id}`, 180)) return send(429, { error: 'Too many updates' });
    if (typeof input.available !== 'boolean') return send(400, { error: 'Provide availability' });
    const location = input.available ? point(input.location) : undefined;
    if (input.available && !location) return send(400, { error: 'Provide a valid location' });
    const result = await db.query(
      `UPDATE rider_dispatch r SET available=$2,
         location=ST_SetSRID(ST_MakePoint($3,$4),4326)::geography,
         location_at=CASE WHEN $2 THEN clock_timestamp() ELSE NULL END
       WHERE rider_id=$1 AND identity_verified_at IS NOT NULL
         AND (NOT $2 OR (NOT EXISTS (${unpaidCashCommission('r.rider_id')}) AND NOT EXISTS (
           SELECT 1 FROM delivery_orders WHERE assigned_rider_id=$1 AND status IN ('assigned','picked_up'))))`,
      [account.id, input.available, location?.longitude ?? null, location?.latitude ?? null],
    );
    return result.rowCount ? send(200, { available: input.available })
      : send(409, { error: 'Identity approval, settled overdue commission, and no active assignment are required' });
  }
  const review = path.match(/^\/dispatch\/riders\/([^/]+)\/identity$/);
  if (review && method === 'POST') {
    if (!await hasStaffPermission(account, 'rider_verifier')) {
      return send(403, { error: 'Verified admin access required' });
    }
    if (!uuid.test(review[1]) || typeof input.approved !== 'boolean') {
      return send(400, { error: 'Provide a rider ID and approval decision' });
    }
    if (input.approved === true && process.env.SMILE_SANDBOX_PARTNER_ID) {
      if (process.env.NODE_ENV === 'production') return send(503, { error: 'Sandbox identity checks cannot approve production riders' });
      if (input.samePersonConfirmed !== true) return send(400, { error: 'Confirm both results identify the same rider' });
      const checks = await db.query(
        `SELECT count(DISTINCT kind)::int AS cleared FROM rider_identity_checks
         WHERE rider_id=$1 AND status='clear'`, [review[1]],
      );
      if (checks.rows[0].cleared !== 2) return send(409, { error: 'Both Smile ID checks must clear before approval' });
    }
    const result = await db.query(
      `WITH reviewed AS (
         INSERT INTO rider_dispatch (rider_id, identity_verified_at)
         SELECT id, CASE WHEN $2 THEN clock_timestamp() END FROM accounts WHERE id=$1 AND role='rider' AND deleted_at IS NULL
         ON CONFLICT (rider_id) DO UPDATE SET identity_verified_at=excluded.identity_verified_at,
           available=false, location=NULL, location_at=NULL
         RETURNING rider_id
       )
       INSERT INTO rider_identity_reviews (rider_id,admin_id,approved)
       SELECT rider_id,$3,$2 FROM reviewed`, [review[1], input.approved, account.id],
    );
    return result.rowCount ? send(200, { approved: input.approved }) : send(404, { error: 'Rider not found' });
  }
  if (!orderId || method !== 'POST') return send(404, { error: 'Route not found' });
  if (action === 'accept' ? account.role !== 'customer' : account.role !== 'rider') {
    return send(403, { error: 'Role cannot perform this action' });
  }
  if (await limited(`bidding:${account.id}`, 120)) return send(429, { error: 'Too many bid requests' });

  const bidId = input.bidId;
  const acceptedFare = input.fareKobo;
  if (action === 'bids' || action === 'accept') {
    if (typeof acceptedFare !== 'number' || !Number.isInteger(acceptedFare) ||
        acceptedFare <= 0 || acceptedFare > 2_147_483_647) {
      return send(400, { error: 'Provide a valid fare in kobo' });
    }
  }

  let riderId = account.id;
  if (action === 'accept') {
    if (typeof bidId !== 'string' || !uuid.test(bidId)) return send(400, { error: 'Provide a valid bid ID' });
    const { rows: [bid] } = await db.query(
      `SELECT b.rider_id FROM delivery_bids b JOIN delivery_orders o ON o.id=b.order_id
       WHERE b.id=$1 AND o.id=$2 AND o.customer_id=$3`, [bidId, orderId, account.id],
    );
    if (!bid) return send(404, { error: 'Bid not found' });
    riderId = bid.rider_id;
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // Lock rider before order for every bid and assignment. Recheck eligibility after both locks.
    const rider = await client.query('SELECT 1 FROM rider_dispatch WHERE rider_id=$1 FOR UPDATE', [riderId]);
    if (!rider.rowCount) return unavailable();
    const order = await client.query('SELECT 1 FROM delivery_orders WHERE id=$1 FOR UPDATE', [orderId]);
    if (!order.rowCount) return unavailable();
    const { rows: [eligible] } = await client.query(
      `SELECT o.offered_fare_kobo, o.fare_floor_kobo
       FROM delivery_orders o JOIN rider_dispatch r ON r.rider_id=$2
       WHERE o.id=$1 AND ${open} AND ${riderReady} AND ${withinRange} AND ${riderOrderEligible}`, [orderId, riderId],
    );
    if (!eligible) return unavailable();

    if (action === 'bids') {
      if ((acceptedFare as number) < eligible.fare_floor_kobo) {
        return send(422, { error: 'Counteroffer is below the fare floor', fareFloorKobo: eligible.fare_floor_kobo });
      }
      const { rows: [bid] } = await client.query(
        `INSERT INTO delivery_bids (order_id,rider_id,fare_kobo) VALUES ($1,$2,$3)
         ON CONFLICT (order_id,rider_id) DO UPDATE SET fare_kobo=excluded.fare_kobo
         RETURNING id, fare_kobo AS "fareKobo"`, [orderId, riderId, acceptedFare],
      );
      await client.query('COMMIT');
      return send(200, { bid });
    }

    if (action === 'accept') {
      const current = await client.query(
        'SELECT 1 FROM delivery_bids WHERE id=$1 AND order_id=$2 AND rider_id=$3 AND fare_kobo=$4',
        [bidId, orderId, riderId, acceptedFare],
      );
      if (!current.rowCount) return send(409, { error: 'Counteroffer changed. Refresh and review the fare' });
    }
    const { rows: [assignment] } = await client.query(
      `UPDATE delivery_orders o SET status='assigned', assigned_rider_id=$2,
         agreed_fare_kobo=$3, assigned_at=clock_timestamp()
       WHERE o.id=$1 AND ${open}
       RETURNING id, status, assigned_rider_id AS "assignedRiderId", agreed_fare_kobo AS "agreedFareKobo"`,
      [orderId, riderId, action === 'claim' ? eligible.offered_fare_kobo : acceptedFare],
    );
    if (!assignment) return unavailable();
    await client.query('UPDATE rider_dispatch SET available=false WHERE rider_id=$1', [riderId]);
    await client.query('COMMIT');
    return send(200, { assignment });
  } finally {
    try { await client.query('ROLLBACK'); } finally { client.release(); }
  }
}

export async function streamSnapshots(
  request: IncomingMessage,
  response: ServerResponse,
  read: () => Promise<{ status: number; body: object }>,
) {
  const initial = await read();
  if (initial.status !== 200) return initial;
  const account = await authenticatedAccount(request);
  if (!account) return send(401, { error: 'Sign in required' });
  if (await limited(`snapshot-stream:${account.id}`, 45)) return send(429, { error: 'Too many stream connections' });
  const abort = new AbortController();
  response.once('close', () => abort.abort());
  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store, no-transform',
    'X-Accel-Buffering': 'no',
  });
  // ponytail: short-lived DB polling suits the pilot. Use committed event fan-out if connection volume grows.
  let previous = JSON.stringify(initial.body);
  response.write(`event: snapshot\ndata: ${previous}\n\n`);
  try {
    for (let tick = 0; tick < 12; tick++) {
      await delay(2000, undefined, { signal: abort.signal });
      const snapshot = await read();
      if (snapshot.status !== 200) {
        response.write(`event: access-ended\ndata: {}\n\n`);
        break;
      }
      const data = JSON.stringify(snapshot.body);
      if (data === previous) continue;
      previous = data;
      if (!response.write(`event: snapshot\ndata: ${data}\n\n`)) break;
    }
  } catch {
    if (!abort.signal.aborted) response.write('event: unavailable\ndata: {}\n\n');
  } finally {
    response.end();
  }
}
