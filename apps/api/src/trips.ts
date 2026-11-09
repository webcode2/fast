import { hasStaffPermission } from './staff.ts';
import type { IncomingMessage } from 'node:http';
import { authenticatedAccount, db, limited, readJson } from './auth.ts';
import { point, uuid } from './orders.ts';
import { commissionKobo } from './commission.ts';
import { reportTripIssue, staffTripIssues } from './trip-issues.ts';
import { followRoute, tripRoute } from './trip-route.ts';
import { gpsDropout, markCustomerUnavailable, recoveryAlerts, reopenTrip } from './trip-recovery.ts';

const send = (status: number, body: object) => ({ status, body });
const notFound = () => send(404, { error: 'Trip not found' });
// Matches the distance that starts the no-show wait at the drop-off.
const arrivalMeters = 100;
const fields = `id, status, customer_id AS "customerId", assigned_rider_id AS "riderId",
  (status='assigned' AND (
    (payment_method IS NOT DISTINCT FROM 'digital' AND NOT EXISTS (
      SELECT 1 FROM trip_payments p WHERE p.order_id=delivery_orders.id AND p.collected_at IS NOT NULL))
    OR EXISTS (SELECT 1 FROM trip_payments p WHERE p.order_id=delivery_orders.id AND p.collected_at IS NULL)
  )) AS "paymentPending",
  payment_method AS "paymentMethod", agreed_fare_kobo AS "agreedFareKobo", assigned_at AS "assignedAt", picked_up_at AS "pickedUpAt",
  completed_at AS "completedAt", recovery_requested_at AS "recoveryRequestedAt",
  (status IN ('assigned','picked_up') AND COALESCE((${gpsDropout}),false)) AS "trackingDropout",
  CASE WHEN dropoff_wait_started_at IS NOT NULL
       AND tracking_received_at > clock_timestamp()-interval '2 minutes'
       AND rider_location_at > clock_timestamp()-interval '2 minutes'
    THEN dropoff_wait_started_at + interval '10 minutes' END AS "noShowEligibleAt",
  pickup_label AS "pickupLabel", dropoff_label AS "dropoffLabel",
  CASE WHEN rider_location_at > clock_timestamp()-interval '2 minutes' THEN CASE
    WHEN status='assigned' AND ST_DWithin(rider_location, pickup, ${arrivalMeters}) THEN 'pickup'
    WHEN status='picked_up' AND ST_DWithin(rider_location, dropoff, ${arrivalMeters}) THEN 'dropoff'
  END END AS "atStop",
  (SELECT r.updated_at FROM trip_routes r WHERE r.order_id=delivery_orders.id) AS "routeUpdatedAt",
  json_build_object('latitude', ST_Y(pickup::geometry), 'longitude', ST_X(pickup::geometry)) AS pickup,
  json_build_object('latitude', ST_Y(dropoff::geometry), 'longitude', ST_X(dropoff::geometry)) AS dropoff,
  CASE WHEN rider_location IS NOT NULL THEN json_build_object(
    'latitude', ST_Y(rider_location::geometry), 'longitude', ST_X(rider_location::geometry),
    'recordedAt', rider_location_at) END AS "riderLocation"`;

export async function trips(request: IncomingMessage, path: string) {
  if (path === '/trips/recovery-alerts' && request.method === 'GET') {
    const admin = await authenticatedAccount(request);
    if (!admin) return send(401, { error: 'Sign in required' });
    if (!await hasStaffPermission(admin, 'recovery_operator')) {
      return send(403, { error: 'Verified admin access required' });
    }
    return send(200, { alerts: await recoveryAlerts() });
  }
  if (path === '/trips/active' && request.method === 'GET') {
    const account = await authenticatedAccount(request);
    if (!account) return send(401, { error: 'Sign in required' });
    const { rows } = await db.query(
      `SELECT id, status, assigned_at AS "assignedAt", dropoff_label AS "dropoffLabel" FROM delivery_orders
       WHERE status IN ('assigned','picked_up') AND (customer_id=$1 OR assigned_rider_id=$1)
       ORDER BY assigned_at DESC LIMIT 50`, [account.id],
    );
    return send(200, { trips: rows });
  }
  if (path === '/trips/issues' || path.startsWith('/trips/issues/')) return staffTripIssues(request, path);
  const [, id, action] = path.match(/^\/trips\/([^/]+)(?:\/(pickup|complete|location|cancel|replace|no-show|route|issues))?$/) ?? [];
  if (!id || !uuid.test(id)) return notFound();
  const account = await authenticatedAccount(request);
  if (!account) return send(401, { error: 'Sign in required' });
  if (request.method === 'GET' && !action) {
    const { rows: [trip] } = await db.query(
      `SELECT ${fields} FROM delivery_orders
       WHERE id=$1 AND assigned_rider_id IS NOT NULL AND (customer_id=$2 OR assigned_rider_id=$2)`,
      [id, account.id],
    );
    return trip ? send(200, { trip }) : notFound();
  }

  if (request.method === 'GET' && action === 'route') {
    const route = await tripRoute(id, account.id);
    return route === undefined ? notFound() : send(200, { route });
  }

  if (request.method !== 'POST' || !action || action === 'route') return send(405, { error: 'Method not supported' });
  if (action === 'replace') {
    if (account.role !== 'customer') return send(403, { error: 'Customer access required' });
    const status = await reopenTrip(id, account.id, true);
    return status ? send(200, { status }) : send(409, { error: 'Replacement is not available' });
  }
  if (account.role !== 'rider') return send(403, { error: 'Rider access required' });
  if (action === 'issues') return reportTripIssue(request, id, account.id);
  if (action === 'cancel') {
    const status = await reopenTrip(id, account.id, false);
    return status ? send(200, { status }) : send(409, { error: 'Cancellation is not available' });
  }
  if (action === 'no-show') {
    return await markCustomerUnavailable(id, account.id)
      ? send(200, { status: 'customer_unavailable' })
      : send(409, { error: 'The drop-off wait is incomplete or tracking is stale' });
  }
  if (action === 'location') {
    const input = await readJson(request).catch(() => null);
    const location = point(input?.location);
    const time = input?.recordedAtMs;
    const now = Date.now();
    if (!location || typeof time !== 'number' || !Number.isSafeInteger(time) ||
        time < now - 120_000 || time > now + 5000) {
      return send(400, { error: 'Provide a valid recent location and recordedAtMs' });
    }
    if (await limited(`trip-location:${account.id}`, 450)) return send(429, { error: 'Too many location updates' });
    const result = await db.query(
      `UPDATE delivery_orders SET rider_location=ST_SetSRID(ST_MakePoint($3,$4),4326)::geography,
         rider_location_at=to_timestamp($5::double precision / 1000),
         tracking_received_at=clock_timestamp(),
         dropoff_wait_started_at=CASE WHEN status='picked_up'
           AND ST_DWithin(dropoff, ST_SetSRID(ST_MakePoint($3,$4),4326)::geography, 100)
           THEN CASE WHEN tracking_received_at>clock_timestamp()-interval '2 minutes'
             AND rider_location_at>to_timestamp($5::double precision/1000)-interval '2 minutes'
             THEN COALESCE(dropoff_wait_started_at,clock_timestamp())
             ELSE clock_timestamp() END END
       WHERE id=$1 AND assigned_rider_id=$2 AND status IN ('assigned','picked_up')
         AND (rider_location_at IS NULL OR
           (rider_location_at < to_timestamp($5::double precision / 1000) AND
            ST_Distance(rider_location, ST_SetSRID(ST_MakePoint($3,$4),4326)::geography)
            <= 50 + 35 * extract(epoch FROM (to_timestamp($5::double precision / 1000) - rider_location_at))))`,
      [id, account.id, location.longitude, location.latitude, time],
    );
    if (!result.rowCount) return send(409, { error: 'Location rejected or trip unavailable' });
    await followRoute(id, account.id, location).catch(() => console.error('Trip route update failed'));
    return send(200, { ok: true });
  }

  const completing = action === 'complete';
  const next = completing ? 'completed' : 'picked_up';
  const previous = completing ? 'picked_up' : 'assigned';
  const transition = completing
    ? 'completed_at=clock_timestamp(), rider_location=NULL, rider_location_at=NULL, tracking_received_at=NULL, dropoff_wait_started_at=NULL, recovery_requested_at=NULL'
    : 'picked_up_at=clock_timestamp()';
  const client = await db.connect();
  let changed;
  try {
    await client.query('BEGIN');
    await client.query('SELECT 1 FROM delivery_orders WHERE id=$1 AND assigned_rider_id=$2 FOR UPDATE', [id, account.id]);
    const result = await client.query(
      `UPDATE delivery_orders SET status=$3, ${transition}
       WHERE id=$1 AND assigned_rider_id=$2 AND status=$4
         AND ($4<>'assigned'
           OR (payment_method='digital' AND EXISTS (SELECT 1 FROM trip_payments WHERE order_id=$1 AND collected_at IS NOT NULL))
           OR (payment_method IS DISTINCT FROM 'digital' AND NOT EXISTS (
             SELECT 1 FROM trip_payments WHERE order_id=$1 AND collected_at IS NULL)))
       RETURNING ${fields}`,
      [id, account.id, next, previous],
    );
    changed = result.rows[0];
    if (changed?.status === 'completed' && changed.paymentMethod === 'cash') {
      const amount = commissionKobo(changed.agreedFareKobo);
      if (amount > 0) await client.query(
        `INSERT INTO cash_commissions (order_id,rider_id,amount_kobo,business_date,due_at)
         SELECT id,assigned_rider_id,$2,(completed_at AT TIME ZONE 'Africa/Lagos')::date,
           (((completed_at AT TIME ZONE 'Africa/Lagos')::date + 1)::timestamp AT TIME ZONE 'Africa/Lagos')
         FROM delivery_orders WHERE id=$1`, [id, amount],
      );
    }
    await client.query('COMMIT');
  } finally {
    try { await client.query('ROLLBACK'); } finally { client.release(); }
  }
  if (changed) return send(200, { trip: changed });
  const { rows: [existing] } = await db.query(
    `SELECT ${fields} FROM delivery_orders WHERE id=$1 AND assigned_rider_id=$2`, [id, account.id],
  );
  if (!existing) return notFound();
  return existing.status === next ? send(200, { trip: existing })
    : send(409, { error: 'Trip cannot make that transition' });
}
