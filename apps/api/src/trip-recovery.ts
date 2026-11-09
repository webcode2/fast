import { db } from './auth.ts';

export const gpsDropout = `COALESCE(tracking_received_at, rider_location_at, assigned_at)
  <= clock_timestamp() - interval '10 minutes'`;

export async function recoveryAlerts() {
  const { rows } = await db.query(
    `SELECT id, status, assigned_rider_id AS "riderId",
       COALESCE(tracking_received_at, rider_location_at, assigned_at) AS "lastTrackingAt",
       recovery_requested_at AS "recoveryRequestedAt",
       (${gpsDropout}) AS "trackingDropout"
     FROM delivery_orders WHERE status IN ('assigned','picked_up')
       AND (recovery_requested_at IS NOT NULL OR ${gpsDropout})
     ORDER BY COALESCE(recovery_requested_at, tracking_received_at, rider_location_at, assigned_at), id
     LIMIT 100`,
  );
  return rows;
}

export async function reopenTrip(id: string, actorId: string, replacing: boolean) {
  const actor = replacing ? 'customer_id' : 'assigned_rider_id';
  const reason = replacing ? 'replacement_requested' : 'rider_cancelled';
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows: [trip] } = await client.query(
      `SELECT status, assigned_rider_id, recovery_requested_at, (${gpsDropout}) AS dropout
       FROM delivery_orders WHERE id=$1 AND ${actor}=$2 AND assigned_rider_id IS NOT NULL FOR UPDATE`,
      [id, actorId],
    );
    if (!trip) return;
    const payment = await client.query('SELECT 1 FROM trip_payments WHERE order_id=$1', [id]);
    if (trip.status === 'picked_up' || (trip.status === 'assigned' && payment.rowCount)) {
      if (replacing && !trip.dropout && !trip.recovery_requested_at) return;
      await client.query(
        'UPDATE delivery_orders SET recovery_requested_at=COALESCE(recovery_requested_at,clock_timestamp()) WHERE id=$1',
        [id],
      );
      await client.query('COMMIT');
      return 'support_requested';
    }
    if (trip.status !== 'assigned' || replacing && !trip.dropout) return;
    await client.query(
      `UPDATE delivery_orders SET status='pending_dispatch',
         bidding_expires_at=clock_timestamp()+interval '60 seconds',
         assigned_rider_id=NULL, agreed_fare_kobo=NULL, assigned_at=NULL,
         rider_location=NULL, rider_location_at=NULL, tracking_received_at=NULL,
         dropoff_wait_started_at=NULL, recovery_requested_at=NULL WHERE id=$1`, [id],
    );
    await client.query('DELETE FROM delivery_bids WHERE order_id=$1', [id]);
    await client.query(
      'INSERT INTO trip_recovery_events (order_id,rider_id,actor_id,reason) VALUES ($1,$2,$3,$4)',
      [id, trip.assigned_rider_id, actorId, reason],
    );
    await client.query('COMMIT');
    return 'pending_dispatch';
  } finally {
    try { await client.query('ROLLBACK'); } finally { client.release(); }
  }
}

export async function markCustomerUnavailable(id: string, riderId: string) {
  const result = await db.query(
    `WITH changed AS (
       UPDATE delivery_orders SET status='customer_unavailable', rider_location=NULL,
         rider_location_at=NULL, tracking_received_at=NULL, dropoff_wait_started_at=NULL,
         recovery_requested_at=NULL
       WHERE id=$1 AND assigned_rider_id=$2 AND status='picked_up'
         AND dropoff_wait_started_at <= clock_timestamp()-interval '10 minutes'
         AND tracking_received_at > clock_timestamp()-interval '2 minutes'
         AND rider_location_at > clock_timestamp()-interval '2 minutes'
       RETURNING id
     )
     INSERT INTO trip_recovery_events (order_id,rider_id,actor_id,reason)
     SELECT id,$2,$2,'customer_unavailable' FROM changed`, [id, riderId],
  );
  if (result.rowCount) return true;
  const existing = await db.query(
    "SELECT 1 FROM delivery_orders WHERE id=$1 AND assigned_rider_id=$2 AND status='customer_unavailable'",
    [id, riderId],
  );
  return Boolean(existing.rowCount);
}
