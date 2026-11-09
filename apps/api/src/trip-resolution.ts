import type { IncomingMessage } from 'node:http';
import { authenticatedAccount, db, readJson } from './auth.ts';
import { recordCashCommission } from './cash-commission.ts';
import { uuid } from './orders.ts';
import { checkoutIsClosed, reconcileCollection } from './payments.ts';
import { hasStaffPermission } from './staff.ts';

const send = (status: number, body: object) => ({ status, body });
const actions = {
  reopen: { from: ['assigned'], reason: 'staff_reopened' },
  cancel: { from: ['assigned', 'picked_up', 'customer_unavailable'], reason: 'staff_cancelled' },
  complete: { from: ['picked_up', 'customer_unavailable'], reason: 'staff_completed' },
} as const;
const clearTracking = `rider_location=NULL,rider_location_at=NULL,tracking_received_at=NULL,
  dropoff_wait_started_at=NULL,recovery_requested_at=NULL`;

/**
 * Staff decisions for trips the rider cannot finish:
 * - reopen: send an unpaid, not-yet-picked-up order back to other riders.
 * - cancel: end the trip. A collected payment is refunded by the payment worker.
 * - complete: staff confirmed delivery, so the normal payout or commission applies.
 */
export async function staffResolveTrip(request: IncomingMessage, path: string) {
  const staff = await authenticatedAccount(request);
  if (!staff) return send(401, { error: 'Sign in required' });
  if (!await hasStaffPermission(staff, 'recovery_operator')) return send(403, { error: 'Recovery operator access required' });
  const id = path.split('/')[3];
  if (!uuid.test(id) || request.method !== 'POST') return send(404, { error: 'Trip not found' });
  const input = await readJson(request).catch(() => null);
  const action = input?.action;
  if (action !== 'reopen' && action !== 'cancel' && action !== 'complete') {
    return send(400, { error: 'Choose reopen, cancel, or complete' });
  }

  // Provider calls stay outside the transaction. A payment that arrives now must count.
  const { rows: [before] } = await db.query(
    'SELECT checkout_id,collected_at FROM trip_payments WHERE order_id=$1', [id],
  );
  if (before && !before.collected_at && before.checkout_id) {
    const collected = await reconcileCollection(id);
    if (!collected && action !== 'complete' && !await checkoutIsClosed(before.checkout_id)) {
      return send(409, { error: 'The customer’s checkout is still open. Try again after it expires.' });
    }
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows: [trip] } = await client.query(
      `SELECT o.status,o.assigned_rider_id,o.agreed_fare_kobo,o.payment_method,p.order_id AS payment_id,p.collected_at
       FROM delivery_orders o LEFT JOIN trip_payments p ON p.order_id=o.id
       WHERE o.id=$1 AND o.assigned_rider_id IS NOT NULL FOR UPDATE OF o`, [id],
    );
    if (!trip) return send(404, { error: 'Trip not found' });
    if (!(actions[action].from as readonly string[]).includes(trip.status)) {
      return send(409, { error: `A ${trip.status.replaceAll('_', ' ')} trip cannot be resolved that way` });
    }
    if (action === 'reopen' && trip.collected_at) {
      return send(409, { error: 'This trip is paid. Cancel it to refund the customer.' });
    }
    if (action === 'complete' && trip.payment_method === 'digital' && !trip.collected_at) {
      return send(409, { error: 'The card payment was not collected, so this trip cannot be completed.' });
    }
    if (trip.payment_id && !trip.collected_at && action !== 'complete') {
      await client.query('DELETE FROM trip_payments WHERE order_id=$1', [id]);
    }
    if (action === 'reopen') {
      await client.query(
        `UPDATE delivery_orders SET status='pending_dispatch',bidding_expires_at=clock_timestamp()+interval '60 seconds',
           assigned_rider_id=NULL,agreed_fare_kobo=NULL,assigned_at=NULL,${clearTracking} WHERE id=$1`, [id],
      );
      await client.query('DELETE FROM delivery_bids WHERE order_id=$1', [id]);
    } else if (action === 'cancel') {
      await client.query(`UPDATE delivery_orders SET status='cancelled',${clearTracking} WHERE id=$1`, [id]);
    } else {
      await client.query(
        `UPDATE delivery_orders SET status='completed',completed_at=clock_timestamp(),completed_near_dropoff=true,
           ${clearTracking} WHERE id=$1`, [id],
      );
      if (trip.payment_method === 'cash') await recordCashCommission(client, id, trip.agreed_fare_kobo);
    }
    await client.query(
      'INSERT INTO trip_recovery_events (order_id,rider_id,actor_id,reason) VALUES ($1,$2,$3,$4)',
      [id, trip.assigned_rider_id, staff.id, actions[action].reason],
    );
    await client.query('COMMIT');
    return send(200, { ok: true });
  } finally {
    try { await client.query('ROLLBACK'); } finally { client.release(); }
  }
}
