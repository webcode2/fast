import { createHash } from 'node:crypto';
import { db } from './auth.ts';
import { bachs, bachsKey, BachsRequestError, isProviderId, naira } from './bachs.ts';
import { describeError } from './runtime.ts';

const lock = '649012203';
export const payoutDueAt = "(((o.completed_at AT TIME ZONE 'Africa/Lagos')::date + 1 + time '06:00') AT TIME ZONE 'Africa/Lagos')";
const noHold = "NOT EXISTS (SELECT 1 FROM trip_disputes d WHERE d.order_id=o.id AND d.status<>'dismissed')";
// Completed away from the drop-off: staff release these after checking.
const deliveryTrusted = '(o.completed_near_dropoff IS DISTINCT FROM false OR o.payout_released_at IS NOT NULL)';
const owedRefund = "(o.status='cancelled' OR EXISTS (SELECT 1 FROM trip_disputes d WHERE d.order_id=o.id AND d.status='upheld'))";

async function postLedger(id: string, kind: 'payout' | 'refund' | 'rider_credit', providerId: string) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM delivery_orders WHERE id=$1 FOR UPDATE', [id]);
    const amount = await client.query(
      `UPDATE payment_operations SET
         state=CASE WHEN $2='rider_credit' THEN state ELSE 'succeeded' END,
         transfer_id=CASE WHEN $2='rider_credit' THEN $3 ELSE transfer_id END,
         provider_id=CASE WHEN $2='rider_credit' THEN provider_id ELSE $3 END,
         settled_at=CASE WHEN $2='rider_credit' THEN settled_at ELSE clock_timestamp() END
       WHERE order_id=$1 AND kind=CASE WHEN $2='rider_credit' THEN 'payout' ELSE $2 END AND state='pending'
       RETURNING amount_kobo`, [id, kind, providerId],
    );
    if (amount.rowCount) {
      await client.query(
        'INSERT INTO payment_ledger (order_id,kind,amount_kobo) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [id, kind, amount.rows[0].amount_kobo],
      );
      if (kind === 'refund') {
        await client.query(
          `INSERT INTO payment_ledger (order_id,kind,amount_kobo)
           SELECT order_id,CASE kind WHEN 'commission' THEN 'commission_reversal' ELSE 'earnings_reversal' END,amount_kobo
           FROM payment_ledger WHERE order_id=$1 AND kind IN ('commission','rider_earnings') ON CONFLICT DO NOTHING`, [id],
        );
      }
      await client.query(
        `INSERT INTO payment_ledger (order_id,kind,amount_kobo)
         SELECT c.order_id,'rider_recovery_due',c.amount_kobo FROM payment_ledger c
         WHERE c.order_id=$1 AND c.kind='rider_credit'
           AND EXISTS (SELECT 1 FROM payment_ledger WHERE order_id=$1 AND kind='refund')
         ON CONFLICT DO NOTHING`, [id],
      );
    }
    await client.query('COMMIT');
  } finally {
    try { await client.query('ROLLBACK'); } finally { client.release(); }
  }
}

async function review(id: string, kind: string) {
  await db.query("UPDATE payment_operations SET state='needs_review' WHERE order_id=$1 AND kind=$2 AND state='pending'", [id, kind]);
}

// A dispute hold waits quietly. A changed bank destination needs a person.
async function payoutCanSend(client: Awaited<ReturnType<typeof db.connect>>, id: string, recipient: string, destination: string) {
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM delivery_orders WHERE id=$1 FOR UPDATE', [id]);
    const { rows: [state] } = await client.query(
      `SELECT (r.recipient_code=$2 AND r.destination_code=$3) AS matches, ${noHold} AS unheld
       FROM delivery_orders o JOIN trip_payments p ON p.order_id=o.id
       LEFT JOIN payout_recipients r ON r.rider_id=p.rider_id WHERE o.id=$1`,
      [id, recipient, destination],
    );
    await client.query('COMMIT');
    if (state?.matches !== true) {
      await review(id, 'payout');
      return false;
    }
    return state.unheld === true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

export async function settlePayments() {
  const keyHash = createHash('sha256').update(bachsKey()).digest('hex');
  const guard = await db.connect();
  try {
    const { rows: [state] } = await guard.query('SELECT pg_try_advisory_lock($1::bigint) AS acquired', [lock]);
    if (!state.acquired) return { attempted: 0 };

    const { rows: candidates } = await db.query(
      `SELECT p.order_id,'refund' AS kind FROM trip_payments p JOIN delivery_orders o ON o.id=p.order_id
       WHERE p.collected_at IS NOT NULL AND ${owedRefund}
         AND NOT EXISTS (SELECT 1 FROM payment_operations x WHERE x.order_id=p.order_id AND x.kind='refund')
       UNION ALL
       SELECT p.order_id,'payout' FROM trip_payments p
       JOIN delivery_orders o ON o.id=p.order_id JOIN payout_recipients r ON r.rider_id=p.rider_id
       WHERE p.collected_at IS NOT NULL AND o.status='completed' AND ${payoutDueAt}<=clock_timestamp()
         AND ${noHold} AND ${deliveryTrusted}
         AND NOT EXISTS (SELECT 1 FROM payment_operations x WHERE x.order_id=p.order_id AND x.kind='payout')
       LIMIT 25`,
    );
    for (const candidate of candidates) {
      await guard.query('BEGIN');
      try {
        await guard.query('SELECT 1 FROM delivery_orders WHERE id=$1 FOR UPDATE', [candidate.order_id]);
        const eligible = candidate.kind === 'payout'
          ? `o.status='completed' AND ${payoutDueAt}<=clock_timestamp() AND r.recipient_code IS NOT NULL AND ${noHold} AND ${deliveryTrusted}`
          : owedRefund;
        await guard.query(
          `INSERT INTO payment_operations (order_id,kind,reference,amount_kobo,recipient_code,destination_code,last_attempt_at)
           SELECT p.order_id,$2,$2||'-'||p.order_id::text,
             p.amount_kobo-CASE WHEN $2='payout' THEN p.commission_kobo ELSE 0 END,
             CASE WHEN $2='payout' THEN r.recipient_code END,
             CASE WHEN $2='payout' THEN r.destination_code END, '-infinity'::timestamptz
           FROM trip_payments p JOIN delivery_orders o ON o.id=p.order_id
           LEFT JOIN payout_recipients r ON r.rider_id=p.rider_id
           WHERE p.order_id=$1 AND p.collected_at IS NOT NULL AND ${eligible}
           ON CONFLICT DO NOTHING`, [candidate.order_id, candidate.kind],
        );
        await guard.query('COMMIT');
      } catch (error) {
        await guard.query('ROLLBACK');
        throw error;
      }
    }

    const { rows: operations } = await db.query(
      `SELECT x.*,p.charge_id FROM payment_operations x JOIN trip_payments p ON p.order_id=x.order_id
       WHERE x.state='pending' AND x.last_attempt_at<=clock_timestamp()-interval '1 minute'
       ORDER BY x.last_attempt_at,x.order_id,x.kind LIMIT 25`,
    );
    for (const operation of operations) {
      const { order_id: id, kind, reference, amount_kobo: kobo, recipient_code: account, destination_code: destination } = operation;
      const amount = naira(kobo);
      try {
        await guard.query('UPDATE payment_operations SET last_attempt_at=clock_timestamp() WHERE order_id=$1 AND kind=$2', [id, kind]);
        if (kind === 'refund') {
          const path = '/refunds/by-charge/' + operation.charge_id;
          const refund = await bachs(path) ?? await bachs('/refunds', { key: reference, body: {
            charge_id: operation.charge_id, reference, amount, fee_bearer: 'org', idempotency_key: reference,
          } });
          if (refund?.reference !== reference || refund.charge_id !== operation.charge_id ||
              refund.requested_amount !== amount || typeof refund.refund_id !== 'string' ||
              refund.status === 'failed' || (refund.status === 'success' && refund.refunded_amount !== amount)) {
            await review(id, kind);
          } else if (refund.status === 'success') {
            await postLedger(id, kind, refund.refund_id);
          }
          continue;
        }

        if (account === 'archived') {
          await review(id, kind);
          continue;
        }
        const transferKey = 'credit-' + id;
        if (!operation.transfer_id) {
          if (operation.transfer_started_at &&
              (Date.now() - Number(operation.transfer_started_at) > 23 * 3600_000 ||
                operation.transfer_key_hash !== keyHash)) {
            await review(id, kind);
            continue;
          }
          if (!await payoutCanSend(guard, id, account, destination)) continue;
          await guard.query(
            `UPDATE payment_operations SET transfer_started_at=COALESCE(transfer_started_at,clock_timestamp()),
               transfer_key_hash=COALESCE(transfer_key_hash,$2) WHERE order_id=$1 AND kind='payout'`, [id, keyHash],
          );
          const transfer = await bachs('/transfers', { key: transferKey, body: {
            destination: account, amount, currency: 'NGN', transfer_group: transferKey,
          } });
          if (!isProviderId(transfer?.id, 'tr_') || transfer.destination !== account ||
              transfer.amount !== amount || transfer.currency !== 'NGN' || transfer.transfer_group !== transferKey ||
              transfer.status !== 'paid') {
            await review(id, kind);
            continue;
          }
          await postLedger(id, 'rider_credit', transfer.id);
        }

        const listed = await bachs('/payouts?reference=' + reference, { account });
        if (!Array.isArray(listed?.items)) continue;
        let payout = listed.items.find((item) => item.reference === reference);
        if (!payout) {
          if (!await payoutCanSend(guard, id, account, destination)) continue;
          payout = await bachs('/payouts', { key: reference, account, body: { destination, amount, reference } });
        }
        if (!isProviderId(payout?.id, 'pay_') || payout.reference !== reference ||
            payout.destination !== destination || payout.amount !== amount || payout.currency !== 'NGN' ||
            payout.status === 'failed') {
          await review(id, kind);
        } else if (payout.status === 'completed') {
          await postLedger(id, kind, payout.id);
        }
      } catch (error) {
        console.error(`Payment operation failed: order=${id} kind=${kind} ${describeError(error)}`);
        // Bachs rejected the request itself, so retrying would repeat the same answer.
        if (error instanceof BachsRequestError && (error.status === 400 || error.status === 422)) await review(id, kind);
      }
    }
    return { attempted: operations.length };
  } finally {
    try { await guard.query('SELECT pg_advisory_unlock($1::bigint)', [lock]); } finally { guard.release(); }
  }
}
