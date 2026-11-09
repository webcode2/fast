import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { authenticatedAccount, db, limited, readJson, readRaw } from './auth.ts';
import { uuid } from './orders.ts';
import { bachs, bachsKey, isProviderId, naira } from './bachs.ts';
import { describeError } from './runtime.ts';
import { hasStaffPermission } from './staff.ts';
import { commissionKobo } from './commission.ts';
import { settleCashCollection } from './cash-commission.ts';
import { payoutDueAt } from './payment-settlement.ts';

const send = (status: number, body: object) => ({ status, body });

const unavailable = () => send(409, { error: 'This trip is not eligible for checkout' });
const staleHours = 24;
const workerStaleMinutes = 5;

async function collect(data: Record<string, unknown>) {
  const reference = data.reference;
  if (typeof reference !== 'string' || !/^fl-[a-f0-9-]{36}$/.test(reference)) return true;
  if (!isProviderId(data.checkout_id, 'chk_') || !isProviderId(data.charge_id, 'ch_') ||
      data.status !== 'SUCCEEDED' || data.currency !== 'NGN' || data.settlement_currency !== 'NGN') return false;
  const { rows: [payment] } = await db.query('SELECT * FROM trip_payments WHERE reference=$1', [reference]);
  if (!payment || data.amount !== naira(payment.amount_kobo) ||
      (payment.checkout_id && data.checkout_id !== payment.checkout_id)) return false;
  if (payment.collected_at) return payment.charge_id === data.charge_id;
  const result = await db.query(
    `WITH collected AS (
       UPDATE trip_payments SET collected_at=clock_timestamp(),checkout_id=$2,charge_id=$3,checkout_url=NULL
       WHERE reference=$1 AND collected_at IS NULL AND (checkout_id IS NULL OR checkout_id=$2) RETURNING *
     )
     INSERT INTO payment_ledger (order_id,kind,amount_kobo)
     SELECT order_id,k.kind,k.amount FROM collected CROSS JOIN LATERAL (VALUES
       ('collection',amount_kobo),('commission',commission_kobo),('rider_earnings',amount_kobo-commission_kobo)
     ) k(kind,amount) ON CONFLICT DO NOTHING`, [reference, data.checkout_id, data.charge_id],
  );
  if (result.rowCount) return true;
  const existing = await db.query('SELECT 1 FROM trip_payments WHERE reference=$1 AND charge_id=$2', [reference, data.charge_id]);
  return Boolean(existing.rowCount);
}

/**
 * Reads a checkout session as a collection event. collect() applies the same strict
 * checks as a signed webhook, so an unexpected shape changes nothing.
 */
function sessionAsCollection(session: Record<string, any>) {
  const charge = session.charge && typeof session.charge === 'object' ? session.charge : null;
  return {
    reference: session.reference,
    checkout_id: session.checkout_id,
    charge_id: charge?.id ?? session.charge_id ?? (typeof session.charge === 'string' ? session.charge : undefined),
    status: charge?.status ?? session.status,
    amount: charge?.amount ?? session.amount ?? session.pricing?.amount,
    currency: charge?.currency ?? session.currency ?? session.pricing?.currency,
    settlement_currency: charge?.settlement_currency ?? session.settlement_currency,
  };
}

/** Asks Bachs about a payment whose webhook may have been lost. True when it is collected. */
export async function reconcileCollection(orderId: string) {
  const { rows: [payment] } = await db.query(
    `UPDATE trip_payments SET last_reconciled_at=clock_timestamp() WHERE order_id=$1
     RETURNING reference,checkout_id,collected_at`, [orderId],
  );
  if (!payment) return false;
  if (payment.collected_at) return true;
  if (!payment.checkout_id) return false;
  const session = await bachs('/checkout-sessions/' + payment.checkout_id);
  if (session?.checkout_id !== payment.checkout_id || session.reference !== payment.reference) return false;
  const event = sessionAsCollection(session);
  if (!event.charge_id) return false;
  if (!await collect(event)) {
    console.error(`Checkout session did not match its payment: order=${orderId}`);
    return false;
  }
  const { rows: [after] } = await db.query('SELECT collected_at FROM trip_payments WHERE order_id=$1', [orderId]);
  return Boolean(after?.collected_at);
}

/** True only when Bachs confirms the session ended with no charge, so it can't be paid later. */
export async function checkoutIsClosed(checkoutId: string) {
  const session = await bachs('/checkout-sessions/' + checkoutId);
  return session?.checkout_id === checkoutId && session.status === 'expired' && session.charge === null;
}

/** Worker sweep for webhooks that never arrived. */
export async function reconcileCollections() {
  const { rows } = await db.query(
    `SELECT order_id FROM trip_payments WHERE collected_at IS NULL AND checkout_id IS NOT NULL
       AND COALESCE(last_reconciled_at,'-infinity'::timestamptz)<clock_timestamp()-interval '2 minutes'
     ORDER BY last_reconciled_at NULLS FIRST,order_id LIMIT 25`,
  );
  for (const { order_id: id } of rows) {
    await reconcileCollection(id).catch((error) =>
      console.error(`Collection check failed: order=${id} ${describeError(error)}`));
  }
  return rows.length;
}

async function paymentHealth() {
  const [{ rows: operations }, { rows: held }, { rows: workers }] = await Promise.all([
    db.query(
      `SELECT order_id AS "orderId",kind,state,amount_kobo AS "amountKobo",last_attempt_at AS "lastAttemptAt"
       FROM payment_operations
       WHERE state='needs_review' OR (state='pending' AND created_at<clock_timestamp()-interval '${staleHours} hours')
       ORDER BY state,created_at LIMIT 100`,
    ),
    db.query(
      `SELECT o.id AS "orderId",p.amount_kobo-p.commission_kobo AS "amountKobo",o.completed_at AS "completedAt"
       FROM delivery_orders o JOIN trip_payments p ON p.order_id=o.id
       WHERE o.status='completed' AND o.completed_near_dropoff=false AND o.payout_released_at IS NULL
         AND p.collected_at IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM payment_operations x WHERE x.order_id=o.id AND x.kind='payout')
       ORDER BY o.completed_at LIMIT 100`,
    ),
    db.query(
      `SELECT worker,beat_at AS "beatAt",last_failed_at AS "lastFailedAt",
         beat_at<clock_timestamp()-interval '${workerStaleMinutes} minutes' AS stale
       FROM worker_heartbeats ORDER BY worker`,
    ),
  ]);
  return { operations, heldPayouts: held, workers };
}

export async function payments(request: IncomingMessage, path: string) {
  if (path === '/payments/bachs/webhook' && request.method === 'POST') {
    const signature = request.headers['x-bachs-signature'];
    const timestamp = request.headers['x-bachs-timestamp'];
    const secret = process.env.BACHS_SANDBOX_WEBHOOK_SECRET;
    if (!secret) return send(503, { error: 'Webhook unavailable' });
    if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature) ||
        typeof timestamp !== 'string' || !/^\d{10}$/.test(timestamp) ||
        Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
      return send(401, { error: 'Invalid signature' });
    }
    const body = await readRaw(request, 65_536).catch(() => null);
    if (!body) return send(400, { error: 'Invalid event' });
    const expected = createHmac('sha256', secret).update(timestamp + '.').update(body).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) return send(401, { error: 'Invalid signature' });
    const event = JSON.parse(body.toString());
    if (event?.type === 'collection.succeeded' && event.data &&
        !await (typeof event.data.reference === 'string' && event.data.reference.startsWith('cash-')
          ? settleCashCollection(event.data) : collect(event.data))) {
      return send(409, { error: 'Payment does not match the reserved checkout' });
    }
    return send(200, { ok: true });
  }
  const user = await authenticatedAccount(request);
  if (!user) return send(401, { error: 'Sign in required' });

  if (path === '/admin/payments/operations' && request.method === 'GET') {
    if (!await hasStaffPermission(user, 'recovery_operator')) return send(403, { error: 'Recovery operator access required' });
    return send(200, await paymentHealth());
  }
  const [, heldOrder] = path.match(/^\/admin\/payments\/([^/]+)\/release-payout$/) ?? [];
  if (heldOrder && request.method === 'POST') {
    if (!await hasStaffPermission(user, 'administrator')) return send(403, { error: 'Administrator access required' });
    if (!uuid.test(heldOrder)) return send(404, { error: 'Trip not found' });
    const released = await db.query(
      `UPDATE delivery_orders SET payout_released_at=clock_timestamp(),payout_released_by=$2
       WHERE id=$1 AND status='completed' AND completed_near_dropoff=false AND payout_released_at IS NULL`,
      [heldOrder, user.id],
    );
    return released.rowCount ? send(200, { ok: true }) : send(409, { error: 'This payout is not on hold' });
  }

  const [, riderId] = path.match(/^\/admin\/payments\/riders\/([^/]+)\/recipient$/) ?? [];
  if (riderId && request.method === 'PUT') {
    if (!await hasStaffPermission(user, 'administrator')) return send(403, { error: 'Administrator access required' });
    const input = await readJson(request).catch(() => null);
    const account = input?.accountId;
    const destination = input?.destinationId;
    if (!uuid.test(riderId) || !isProviderId(account, 'acct_') || !isProviderId(destination, 'pd_')) {
      return send(400, { error: 'Provide a Bachs connected account and payout destination' });
    }
    const verified = await bachs('/payouts/destinations/' + destination, { account });
    if (verified?.id !== destination || verified.currency !== 'NGN' || verified.is_usable !== true ||
        verified.type !== 'bank_account') return send(422, { error: 'Bachs bank destination is unavailable' });
    const result = await db.query(
      `INSERT INTO payout_recipients (rider_id,recipient_code,destination_code)
       SELECT id,$2,$3 FROM accounts WHERE id=$1 AND role='rider' AND deleted_at IS NULL
       ON CONFLICT (rider_id) DO UPDATE SET recipient_code=excluded.recipient_code,
         destination_code=excluded.destination_code`, [riderId, account, destination],
    );
    return result.rowCount ? send(200, { ok: true }) : send(404, { error: 'Rider not found' });
  }

  const [, id, action] = path.match(/^\/trips\/([^/]+)\/payment(?:\/(checkout|verify))?$/) ?? [];
  if (!id || !uuid.test(id)) return send(404, { error: 'Trip not found' });
  if (request.method === 'GET' && !action) {
    const { rows: [payment] } = await db.query(
      `SELECT p.order_id AS "orderId",p.amount_kobo AS "amountKobo",p.commission_kobo AS "commissionKobo",
         p.amount_kobo-p.commission_kobo AS "riderEarningsKobo",p.collected_at AS "collectedAt",
         ${payoutDueAt} AS "payoutDueAt",
         (SELECT status FROM trip_disputes WHERE order_id=p.order_id) AS "disputeStatus",
         (SELECT state FROM payment_operations WHERE order_id=p.order_id AND kind='payout') AS "payoutState",
         (SELECT state FROM payment_operations WHERE order_id=p.order_id AND kind='refund') AS "refundState",
         (SELECT amount_kobo FROM payment_ledger WHERE order_id=p.order_id AND kind='rider_recovery_due') AS "riderRecoveryDueKobo"
       FROM trip_payments p JOIN delivery_orders o ON o.id=p.order_id
       WHERE p.order_id=$1 AND (o.customer_id=$2 OR p.rider_id=$2)`, [id, user.id],
    );
    return payment ? send(200, { payment }) : send(404, { error: 'Payment not found' });
  }
  if (request.method !== 'POST' || !action) return send(405, { error: 'Method not supported' });
  if (user.role !== 'customer' || !user.email_verified || !user.phone_verified) {
    return send(403, { error: 'Verified customer access required' });
  }
  if (await limited(`payments:${user.id}`, 30)) return send(429, { error: 'Too many payment requests' });
  bachsKey();
  if (action === 'verify') {
    const { rows: [payment] } = await db.query(
      'SELECT p.collected_at FROM trip_payments p JOIN delivery_orders o ON o.id=p.order_id WHERE p.order_id=$1 AND o.customer_id=$2',
      [id, user.id],
    );
    if (!payment) return send(404, { error: 'Payment not found' });
    if (payment.collected_at) return send(200, { collected: true });
    // A customer asking is the fastest signal that a webhook was lost.
    return send(200, { collected: await reconcileCollection(id) });
  }

  const client = await db.connect();
  let payment;
  let amount: number;
  try {
    await client.query('BEGIN');
    const { rows: [trip] } = await client.query(
      `SELECT agreed_fare_kobo,assigned_rider_id FROM delivery_orders
       WHERE id=$1 AND customer_id=$2 AND status='assigned' AND recovery_requested_at IS NULL AND payment_method IS DISTINCT FROM 'cash' FOR UPDATE`,
      [id, user.id],
    );
    if (!trip) return unavailable();
    amount = trip.agreed_fare_kobo;
    const reserved = await client.query(
      `INSERT INTO trip_payments (order_id,rider_id,reference,amount_kobo,commission_kobo)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (order_id) DO UPDATE SET reference=trip_payments.reference
       RETURNING reference,checkout_id,checkout_url,checkout_expires_at,collected_at`,
      [id, trip.assigned_rider_id, 'fl-' + id, amount, commissionKobo(amount)],
    );
    payment = reserved.rows[0];
    // Commit the stable provider reference before attempting checkout initialization.
    await client.query('COMMIT');
  } finally {
    try { await client.query('ROLLBACK'); } finally { client.release(); }
  }
  if (payment.collected_at) return send(200, { collected: true });
  if (payment.checkout_id && payment.checkout_expires_at && Date.now() >= Number(payment.checkout_expires_at)) {
    if (await reconcileCollection(id)) return send(200, { collected: true });
    if (!await checkoutIsClosed(payment.checkout_id)) {
      return send(409, { error: 'The previous checkout is still being confirmed. Please try again shortly.' });
    }
    // Bachs replays a reference, so a new attempt needs a new one.
    const { rows: [fresh] } = await db.query(
      `UPDATE trip_payments SET reference=$2,checkout_id=NULL,checkout_url=NULL,checkout_expires_at=NULL
       WHERE order_id=$1 AND collected_at IS NULL AND checkout_id=$3 RETURNING reference`,
      [id, 'fl-' + randomUUID(), payment.checkout_id],
    );
    if (!fresh) return send(409, { error: 'Checkout changed. Please try again.' });
    payment = { reference: fresh.reference };
  } else if (payment.checkout_url) {
    return send(200, { authorizationUrl: payment.checkout_url, reference: payment.reference });
  }
  const checkout = await bachs('/checkout-sessions', {
    key: payment.reference,
    body: {
      pricing: { amount: naira(amount), currency: 'NGN' },
      customer: { email: user.email }, reference: payment.reference,
      payment_method_types: ['NGN_CARD'],
    },
  });
  if (checkout?.reference !== payment.reference ||
      !isProviderId(checkout.checkout_id, 'chk_') ||
      typeof checkout.checkout_url !== 'string' ||
      new URL(checkout.checkout_url).origin !== 'https://checkout.bachs.io') {
    const { rows: [saved] } = await db.query('SELECT checkout_url FROM trip_payments WHERE order_id=$1', [id]);
    return saved?.checkout_url
      ? send(200, { authorizationUrl: saved.checkout_url, reference: payment.reference })
      : send(503, { error: 'Checkout unavailable. Retry or contact support.' });
  }
  const saved = await db.query(
    `UPDATE trip_payments SET checkout_url=CASE WHEN collected_at IS NULL THEN $2 END,checkout_id=$3,checkout_expires_at=$4
     WHERE order_id=$1 AND (checkout_id IS NULL OR checkout_id=$3)`,
    [id, checkout.checkout_url, checkout.checkout_id, Number.isFinite(Date.parse(checkout.expires_at)) ? checkout.expires_at : null],
  );
  if (!saved.rowCount) return send(409, { error: 'Checkout does not match the reserved payment' });
  return send(200, { authorizationUrl: checkout.checkout_url, reference: payment.reference });
}
