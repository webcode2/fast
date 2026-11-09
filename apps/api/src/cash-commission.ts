import type { IncomingMessage } from 'node:http';
import { authenticatedAccount, db, limited, readJson } from './auth.ts';
import { bachs, bachsKey, BachsRequestError, isProviderId, naira } from './bachs.ts';
import { uuid } from './orders.ts';
import { hasStaffPermission } from './staff.ts';

const send = (status: number, body: object) => ({ status, body });
const conflict = () => send(409, { error: 'Commission balance or repayment changed. Refresh and try again.' });

async function reserve(rider: string, manual?: { actor: string; reference: string; amount: number }) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const account = await client.query(
      "SELECT 1 FROM accounts WHERE id=$1 AND role='rider' AND deleted_at IS NULL FOR UPDATE", [rider],
    );
    if (!account.rowCount) return send(404, { error: 'Rider not found' });
    const pending = await client.query(
      "SELECT * FROM cash_commission_repayments WHERE rider_id=$1 AND state='pending' FOR UPDATE", [rider],
    );
    if (manual) {
      const { rows: [saved] } = await client.query(
        'SELECT rider_id, recorded_by, amount_kobo FROM cash_commission_repayments WHERE external_reference=$1',
        [manual.reference],
      );
      if (saved) return saved.rider_id === rider && saved.recorded_by === manual.actor &&
        Number(saved.amount_kobo) === manual.amount ? send(200, { paid: true }) : conflict();
      if (pending.rowCount) return conflict();
    } else if (pending.rowCount) {
      return pending.rows[0];
    }
    const { rows: [balance] } = await client.query(
      'SELECT COALESCE(sum(amount_kobo),0) AS amount FROM cash_commissions WHERE rider_id=$1 AND paid_at IS NULL',
      [rider],
    );
    const amount = Number(balance.amount);
    if (!Number.isSafeInteger(amount) || (manual && manual.amount !== amount)) return conflict();
    if (amount === 0) return send(200, { amountKobo: '0' });
    const { rows: [batch] } = await client.query(
      `INSERT INTO cash_commission_repayments (rider_id,amount_kobo,state,paid_at,external_reference,recorded_by)
       VALUES ($1,$2,$3,CASE WHEN $3='paid' THEN clock_timestamp() END,$4,$5)
       ON CONFLICT (external_reference) DO NOTHING RETURNING *`,
      [rider, amount, manual ? 'paid' : 'pending', manual?.reference ?? null, manual?.actor ?? null],
    );
    if (!batch) return conflict();
    await client.query(
      `INSERT INTO cash_commission_repayment_items (repayment_id,order_id)
       SELECT $1,order_id FROM cash_commissions WHERE rider_id=$2 AND paid_at IS NULL`, [batch.id, rider],
    );
    if (manual) await applyRepayment(client, batch.id);
    await client.query('COMMIT');
    return manual ? send(200, { paid: true }) : batch;
  } finally {
    try { await client.query('ROLLBACK'); } finally { client.release(); }
  }
}

async function applyRepayment(client: Awaited<ReturnType<typeof db.connect>>, id: string) {
  await client.query(
    `UPDATE cash_commissions c SET paid_at=b.paid_at,repayment_id=b.id
     FROM cash_commission_repayment_items i JOIN cash_commission_repayments b ON b.id=i.repayment_id
     WHERE b.id=$1 AND c.order_id=i.order_id AND c.paid_at IS NULL`, [id],
  );
}

export async function settleCashCollection(data: Record<string, unknown>) {
  const reference = data.reference;
  if (typeof reference !== 'string' || !uuid.test(reference.slice(5)) ||
      !isProviderId(data.checkout_id, 'chk_') || !isProviderId(data.charge_id, 'ch_') ||
      data.status !== 'SUCCEEDED' || data.currency !== 'NGN' || data.settlement_currency !== 'NGN') return false;
  const id = reference.slice(5);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows: [batch] } = await client.query(
      'SELECT * FROM cash_commission_repayments WHERE id=$1 FOR UPDATE', [id],
    );
    if (!batch || data.amount !== naira(Number(batch.amount_kobo)) ||
        (batch.checkout_id && batch.checkout_id !== data.checkout_id)) return false;
    if (batch.state === 'paid') return batch.charge_id === data.charge_id;
    if (batch.state !== 'pending') return false;
    await client.query(
      `UPDATE cash_commission_repayments SET state='paid',checkout_id=$2,charge_id=$3,
         paid_at=clock_timestamp(),checkout_url=NULL WHERE id=$1`, [id, data.checkout_id, data.charge_id],
    );
    await applyRepayment(client, id);
    await client.query('COMMIT');
    return true;
  } finally {
    try { await client.query('ROLLBACK'); } finally { client.release(); }
  }
}

export async function cashCommission(request: IncomingMessage, path: string) {
  const account = await authenticatedAccount(request);
  if (!account) return send(401, { error: 'Sign in required' });
  const [, rider] = path.match(/^\/admin\/cash-commission\/([^/]+)\/record$/) ?? [];
  if (rider && request.method === 'POST') {
    if (!await hasStaffPermission(account, 'administrator')) return send(403, { error: 'Administrator access required' });
    const input = await readJson(request).catch(() => null);
    const reference = input?.externalReference;
    const amount = input?.amountKobo;
    if (!uuid.test(rider) || typeof reference !== 'string' || !/^[A-Za-z0-9_-]{6,128}$/.test(reference) ||
        typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) {
      return send(400, { error: 'Provide the confirmed repayment amount and external reference' });
    }
    return reserve(rider, { actor: account.id, reference, amount });
  }
  if (account.role !== 'rider') return send(403, { error: 'Rider access required' });
  if (path === '/cash-commission' && request.method === 'GET') {
    const { rows: [balance] } = await db.query(
      `SELECT COALESCE(sum(amount_kobo),0)::text AS "outstandingKobo",
         COALESCE(sum(amount_kobo) FILTER (WHERE due_at<=clock_timestamp()),0)::text AS "overdueKobo",
         min(due_at) AS "nextDueAt" FROM cash_commissions WHERE rider_id=$1 AND paid_at IS NULL`, [account.id],
    );
    return send(200, { ...balance, blocked: balance.overdueKobo !== '0' });
  }
  if (path !== '/cash-commission/checkout' || request.method !== 'POST') return send(405, { error: 'Method not supported' });
  if (!account.email_verified) return send(403, { error: 'Verify your email before repaying commission' });
  if (await limited(`cash-checkout:${account.id}`, 15)) return send(429, { error: 'Too many requests' });
  bachsKey();
  let batch = await reserve(account.id);
  if ('status' in batch) return batch;
  if (batch.checkout_id && batch.checkout_expires_at && Date.now() >= Number(batch.checkout_expires_at)) {
    const session = await bachs('/checkout-sessions/' + batch.checkout_id);
    if (session?.checkout_id !== batch.checkout_id || session.status !== 'expired' || session.charge !== null) {
      return send(409, { error: 'The previous checkout is awaiting reconciliation' });
    }
    await db.query(
      "UPDATE cash_commission_repayments SET state='expired',checkout_url=NULL WHERE id=$1 AND state='pending'", [batch.id],
    );
    batch = await reserve(account.id);
    if ('status' in batch) return batch;
  }
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows: [current] } = await client.query(
      "SELECT * FROM cash_commission_repayments WHERE id=$1 AND state='pending' FOR UPDATE", [batch.id],
    );
    if (!current) return conflict();
    if (current.checkout_url) return send(200, { authorizationUrl: current.checkout_url, amountKobo: current.amount_kobo });
    const reference = 'cash-' + current.id;
    let checkout;
    try {
      checkout = await bachs('/checkout-sessions', {
        key: reference,
        body: {
          pricing: { amount: naira(Number(current.amount_kobo)), currency: 'NGN' },
          customer: { email: account.email }, reference, payment_method_types: ['NGN_CARD'],
        },
      });
    } catch (error) {
      const rejected = !current.checkout_started_at && error instanceof BachsRequestError &&
        (error.status === 400 || error.status === 422) && error.code === 'VALIDATION_ERROR';
      await client.query(
        `UPDATE cash_commission_repayments SET checkout_started_at=COALESCE(checkout_started_at,clock_timestamp()),
           state=CASE WHEN $2 THEN 'expired' ELSE state END WHERE id=$1`, [current.id, rejected],
      );
      await client.query('COMMIT');
      return rejected
        ? send(422, { error: 'Bachs declined this checkout. Contact support to arrange a verified repayment.' })
        : send(503, { error: 'Bachs commission checkout is unavailable. Retry to resume.' });
    }
    const valid = checkout?.reference === reference && isProviderId(checkout.checkout_id, 'chk_') &&
      typeof checkout.checkout_url === 'string' && URL.canParse(checkout.checkout_url) &&
      new URL(checkout.checkout_url).origin === 'https://checkout.bachs.io' &&
      Number.isFinite(Date.parse(checkout.expires_at));
    await client.query(
      `UPDATE cash_commission_repayments SET checkout_started_at=COALESCE(checkout_started_at,clock_timestamp()),
         checkout_id=$2,checkout_url=$3,checkout_expires_at=$4 WHERE id=$1`,
      [current.id, valid ? checkout.checkout_id : null, valid ? checkout.checkout_url : null,
        valid ? checkout.expires_at : null],
    );
    await client.query('COMMIT');
    return valid ? send(200, { authorizationUrl: checkout.checkout_url, amountKobo: current.amount_kobo })
      : send(503, { error: 'Bachs commission checkout is unavailable. Retry to resume.' });
  } finally {
    try { await client.query('ROLLBACK'); } finally { client.release(); }
  }
}
