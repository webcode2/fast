import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { db } from '../src/auth.ts';
import { server } from '../src/server.ts';
import { settlePayments } from '../src/payment-settlement.ts';

if (!process.env.DATABASE_URL) throw new Error('Use an isolated, migrated test database');
const key = 'sk_sandbox_localcontractcheck';
const signingSecret = 'local-test-webhook-secret';
process.env.BACHS_SANDBOX_SECRET_KEY = key;
process.env.BACHS_SANDBOX_WEBHOOK_SECRET = signingSecret;
process.env.MAPBOX_ACCESS_TOKEN = 'test-token';
process.env.ROUTE_CACHE_TTL_SECONDS = '0';
const network = globalThis.fetch;
const collections = new Map<string, { amount: string; checkout: string; charge: string }>();
const transfers = new Map<string, object>();
const payouts = new Map<string, object>();
const refunds = new Map<string, object>();
const posts = { transfers: 0, payouts: 0, refunds: 0 };
let loseTransferResponse = false;
let rejectCashCheckout = false;
const recipient = 'acct_contracttest';
const destination = 'pd_contracttest';
const missing = () => Response.json({}, { status: 404 });
globalThis.fetch = async (input, options) => {
  const url = new URL(String(input));
  if (url.hostname === 'api.mapbox.com') {
    return Response.json({ code: 'Ok', routes: [{ distance: 1000 }] });
  }
  if (url.hostname !== 'sandbox-api.bachs.io') return network(input, options);
  const headers = new Headers(options?.headers);
  assert.equal(headers.get('authorization'), 'Bearer ' + key);
  const body = options?.body ? JSON.parse(String(options.body)) : {};
  const path = url.pathname;
  if (path === '/v1/checkout-sessions') {
    if (rejectCashCheckout && body.reference.startsWith('cash-')) {
      return Response.json({ error_code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    assert.equal(body.pricing.currency, 'NGN');
    assert.deepEqual(body.payment_method_types, ['NGN_CARD']);
    assert.equal(headers.get('idempotency-key'), body.reference);
    const id = body.reference.slice(3);
    const checkout = 'chk_' + id;
    collections.set(body.reference, { amount: body.pricing.amount, checkout, charge: 'ch_' + id });
    return Response.json({ reference: body.reference, checkout_id: checkout, checkout_url: 'https://checkout.bachs.io/c/' + checkout,
      expires_at: new Date(Date.now() + 3600_000).toISOString() });
  }
  if (path === '/v1/payouts/destinations/' + destination) {
    assert.equal(headers.get('x-account-id'), recipient);
    return Response.json({ id: destination, is_usable: true, currency: 'NGN', type: 'bank_account' });
  }
  if (path === '/v1/transfers') {
    assert.equal(headers.get('idempotency-key'), body.transfer_group);
    assert.equal(body.destination, recipient);
    assert.equal(body.currency, 'NGN');
    let transfer = transfers.get(body.transfer_group);
    if (!transfer) {
      posts.transfers++;
      transfer = { id: 'tr_' + body.transfer_group, transfer_group: body.transfer_group,
        amount: body.amount, destination: body.destination, currency: 'NGN', status: 'paid' };
      transfers.set(body.transfer_group, transfer);
    }
    if (loseTransferResponse) {
      loseTransferResponse = false;
      throw new Error('Simulated lost response after provider accepted the credit');
    }
    return Response.json(transfer);
  }
  if (path === '/v1/payouts') {
    assert.equal(headers.get('x-account-id'), recipient);
    if (options?.method === 'POST') {
      assert.equal(headers.get('idempotency-key'), body.reference);
      assert.equal(body.destination, destination);
      assert.ok(!payouts.has(body.reference));
      posts.payouts++;
      const payout = { id: 'pay_' + body.reference, reference: body.reference, destination,
        amount: body.amount, currency: 'NGN', status: 'completed' };
      payouts.set(body.reference, payout);
      return Response.json(payout);
    }
    const payout = payouts.get(url.searchParams.get('reference')!);
    return Response.json({ items: payout ? [payout] : [] });
  }
  if (path === '/v1/refunds') {
    posts.refunds++;
    assert.equal(body.amount, [...collections.values()].find((payment) => payment.charge === body.charge_id)?.amount);
    assert.equal(body.fee_bearer, 'org');
    assert.equal(body.idempotency_key, body.reference);
    assert.ok(!refunds.has(body.charge_id));
    const refund = { refund_id: 'rfnd_' + body.reference, reference: body.reference, charge_id: body.charge_id,
      requested_amount: body.amount, refunded_amount: body.amount, status: 'success' };
    refunds.set(body.charge_id, refund);
    return Response.json(refund);
  }
  if (path.startsWith('/v1/refunds/by-charge/')) {
    const refund = refunds.get(path.split('/').at(-1)!);
    return refund ? Response.json(refund) : missing();
  }
  throw new Error('Unexpected Bachs request ' + path);
};

server.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
assert(address && typeof address !== 'string');
const base = `http://127.0.0.1:${address.port}`;

async function request(path: string, token = '', method = 'GET', body?: object, headers = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}),
      'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}

async function actor(role: string, number: number) {
  const email = `${role}@payments.example.test`;
  const password = 'payments-test-password';
  if (role !== 'admin') {
    assert.equal((await request('/auth/register', '', 'POST', {
      name: role, role, email, password, phone: `+23480123456${number}`,
    })).status, 202);
  } else {
    const { hashPassword } = await import('../src/auth.ts');
    const { rows: [account] } = await db.query(
      "INSERT INTO accounts (role,email,phone,password_hash) VALUES ('admin',$1,$2,$3) RETURNING id",
      [email, `+23480123456${number}`, await hashPassword(password)],
    );
    await db.query("INSERT INTO staff_role_assignments (account_id,role) VALUES ($1,'administrator')", [account.id]);
  }
  await db.query('UPDATE accounts SET phone_verified=true,email_verified=true WHERE email=$1', [email]);
  const login = await request('/auth/login', '', 'POST', { email, password });
  assert.equal(login.status, 200);
  return { id: login.body.user.id as string, token: login.body.token as string };
}

function webhook(reference: string, valid = true, wrongAmount = false) {
  const payment = collections.get(reference)!;
  const body = { type: 'collection.succeeded', data: {
    reference, checkout_id: payment.checkout, charge_id: payment.charge,
    currency: 'NGN', settlement_currency: 'NGN', status: 'SUCCEEDED',
    amount: wrongAmount ? '0.01' : payment.amount,
  } };
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', valid ? signingSecret : 'incorrect')
    .update(timestamp + '.' + JSON.stringify(body)).digest('hex');
  return request('/payments/bachs/webhook', '', 'POST', body,
    { 'x-bachs-timestamp': timestamp, 'x-bachs-signature': signature });
}

try {
  const customer = await actor('customer', 1);
  const rider = await actor('rider', 2);
  const admin = await actor('admin', 3);
  assert.equal((await request(`/admin/payments/riders/${rider.id}/recipient`, admin.token, 'PUT',
    { accountId: recipient, destinationId: destination })).status, 200);

  async function paidTrip() {
    const { rows: [trip] } = await db.query(
      `INSERT INTO delivery_orders (customer_id,idempotency_key,request_hash,pickup,dropoff,
         route_distance_meters,fare_floor_kobo,offered_fare_kobo,status,assigned_rider_id,agreed_fare_kobo,assigned_at,payment_method)
       VALUES ($1,$2,'test',ST_GeogFromText('POINT(7.01 4.81)'),ST_GeogFromText('POINT(7.02 4.82)'),
         1000,15000,200000,'assigned',$3,200000,now(),'digital') RETURNING id`, [customer.id, randomUUID(), rider.id],
    );
    const path = '/trips/' + trip.id;
    assert.equal((await request(path, rider.token)).body.trip.paymentPending, true);
    assert.equal((await request(path + '/pickup', rider.token, 'POST')).status, 409);
    const checkout = await request(path + '/payment/checkout', customer.token, 'POST');
    assert.equal(checkout.status, 200, JSON.stringify(checkout.body));
    assert.equal((await request(path + '/payment/checkout', customer.token, 'POST')).body.reference, checkout.body.reference);
    assert.equal((await request(path + '/pickup', rider.token, 'POST')).status, 409);
    assert.equal((await webhook(checkout.body.reference, false)).status, 401);
    assert.equal((await webhook(checkout.body.reference, true, true)).status, 409);
    assert.equal((await request(path + '/payment/verify', customer.token, 'POST')).body.collected, false);
    assert.equal((await webhook(checkout.body.reference)).status, 200);
    assert.equal((await webhook(checkout.body.reference)).status, 200);
    assert.equal((await request(path, rider.token)).body.trip.paymentPending, false);
    assert.equal((await request(path + '/pickup', rider.token, 'POST')).status, 200);
    assert.equal((await request(path + '/complete', rider.token, 'POST')).status, 200);
    return { id: trip.id, path };
  }

  const first = await paidTrip();
  await settlePayments();
  assert.equal(posts.transfers, 0, 'Same-day trip must not pay');
  await db.query("UPDATE delivery_orders SET completed_at='2025-01-02 22:59:59+00' WHERE id=$1", [first.id]);
  const payment = (await request(first.path + '/payment', rider.token)).body.payment;
  assert.equal(payment.payoutDueAt, '2025-01-03T05:00:00.000Z');
  assert.equal(payment.commissionKobo, 20000);
  assert.equal(payment.riderEarningsKobo, 180000);
  loseTransferResponse = true;
  await Promise.all([settlePayments(), settlePayments()]);
  assert.equal(posts.transfers, 1);
  assert.equal(posts.payouts, 0);
  await db.query("UPDATE payment_operations SET last_attempt_at='-infinity' WHERE order_id=$1", [first.id]);
  await settlePayments();
  assert.equal(posts.transfers, 1);
  assert.equal(posts.payouts, 1);
  assert.equal((await request(first.path + '/payment', rider.token)).body.payment.payoutState, 'succeeded');

  async function report(id: string, path: string, decision?: string) {
    assert.equal((await request(path + '/dispute', customer.token, 'POST', { details: 'Parcel not delivered' })).status, 200);
    if (decision) assert.equal((await request('/admin/disputes/' + id + '/resolve', admin.token, 'POST', {
      decision, resolution: 'Investigation complete',
    })).status, 200);
  }

  await report(first.id, first.path, 'upheld');
  await Promise.all([settlePayments(), settlePayments()]);
  assert.equal(posts.refunds, 1);
  const late = (await request(first.path + '/payment', rider.token)).body.payment;
  assert.equal(late.refundState, 'succeeded');
  assert.equal(late.riderRecoveryDueKobo, 180000);

  const held = await paidTrip();
  await db.query("UPDATE delivery_orders SET completed_at='2025-01-02 22:59:59+00' WHERE id=$1", [held.id]);
  await report(held.id, held.path);
  await settlePayments();
  assert.equal(posts.transfers, 1);
  assert.equal(posts.refunds, 1);
  assert.equal((await request('/admin/disputes/' + held.id + '/resolve', admin.token, 'POST', {
    decision: 'upheld', resolution: 'Non-delivery confirmed',
  })).status, 200);
  await settlePayments();
  assert.equal(posts.transfers, 1);
  assert.equal(posts.refunds, 2);
  assert.equal((await request(held.path + '/payment', rider.token)).body.payment.riderRecoveryDueKobo, null);

  const released = await paidTrip();
  await db.query("UPDATE delivery_orders SET completed_at='2025-01-02 22:59:59+00' WHERE id=$1", [released.id]);
  await report(released.id, released.path, 'dismissed');
  await settlePayments();
  assert.equal(posts.transfers, 2);
  assert.equal(posts.payouts, 2);
  const ledger = (await db.query('SELECT kind,amount_kobo FROM payment_ledger WHERE order_id=$1 ORDER BY kind', [first.id])).rows;
  assert.deepEqual(Object.fromEntries(ledger.map(({ kind, amount_kobo }) => [kind, amount_kobo])), {
    collection: 200000, commission: 20000, commission_reversal: 20000, earnings_reversal: 180000,
    payout: 180000, refund: 200000, rider_earnings: 180000, rider_credit: 180000,
    rider_recovery_due: 180000,
  });
  assert.equal((await request(`/dispatch/riders/${rider.id}/identity`, admin.token, 'POST',
    { approved: true })).status, 200);
  const location = { latitude: 4.81, longitude: 7.01 };
  const available = () => request('/dispatch/availability', rider.token, 'PUT', { available: true, location });
  const cashOrder = async () => {
    const payload = { pickup: location, dropoff: { latitude: 4.82, longitude: 7.02 },
      offeredFareKobo: 2000000, paymentMethod: 'cash' };
    const key = randomUUID();
    const order = await request('/orders', customer.token, 'POST', payload, { 'Idempotency-Key': key });
    assert.equal(order.status, 201, JSON.stringify(order.body));
    assert.equal(order.body.order.paymentMethod, 'cash');
    const history = await request('/orders', customer.token);
    assert.equal(history.status, 200);
    assert.ok(history.body.orders.some((item: { id: string }) => item.id === order.body.order.id));
    assert.equal((await request('/orders', rider.token)).status, 403);
    assert.equal((await request('/orders', customer.token, 'POST', { ...payload, paymentMethod: 'digital' },
      { 'Idempotency-Key': key })).status, 409);
    return order.body.order.id as string;
  };
  const finishCash = async (id: string) => {
    assert.equal((await available()).status, 200);
    assert.equal((await request(`/orders/${id}/claim`, rider.token, 'POST')).status, 200);
    const trip = '/trips/' + id;
    assert.equal((await request(trip + '/payment/checkout', customer.token, 'POST')).status, 409);
    assert.equal((await request(trip + '/pickup', rider.token, 'POST')).status, 200);
    assert.equal((await request(trip + '/complete', rider.token, 'POST')).status, 200);
    assert.equal((await request(trip + '/complete', rider.token, 'POST')).status, 200);
  };
  const cashOne = await cashOrder();
  await finishCash(cashOne);
  const cashTwo = await cashOrder();
  await finishCash(cashTwo);
  const { rows: [cashDates] } = await db.query(
    `SELECT c.amount_kobo, c.business_date::text,
       to_char(c.due_at AT TIME ZONE 'Africa/Lagos','HH24:MI:SS') AS cutoff
     FROM cash_commissions c WHERE order_id=$1`, [cashOne],
  );
  assert.equal(cashDates.amount_kobo, 200000);
  assert.equal(cashDates.cutoff, '00:00:00');
  const balance = () => request('/cash-commission', rider.token);
  assert.deepEqual([ (await balance()).body.outstandingKobo, (await balance()).body.blocked ], ['400000', false]);
  assert.equal((await available()).status, 200);
  const pending = await cashOrder();
  const bid = await request(`/orders/${pending}/bids`, rider.token, 'POST', { fareKobo: 2100000 });
  assert.equal(bid.status, 200);
  await db.query("UPDATE cash_commissions SET due_at=clock_timestamp()-interval '1 second' WHERE order_id=$1", [cashOne]);
  assert.deepEqual([ (await balance()).body.overdueKobo, (await balance()).body.blocked ], ['200000', true]);
  const blocked = await request('/dispatch/availability', rider.token);
  assert.equal(blocked.body.available, false);
  assert.equal(blocked.body.commissionOverdue, true);
  assert.equal((await available()).status, 409);
  assert.equal((await request('/dispatch/nearby', rider.token)).body.orders.length, 0);
  assert.equal((await request(`/orders/${pending}/claim`, rider.token, 'POST')).status, 409);
  assert.equal((await request(`/orders/${pending}/bids`, rider.token, 'POST', { fareKobo: 2150000 })).status, 409);
  assert.equal((await request(`/orders/${pending}/accept`, customer.token, 'POST',
    { bidId: bid.body.bid.id, fareKobo: 2100000 })).status, 409);

  const checkouts = await Promise.all([
    request('/cash-commission/checkout', rider.token, 'POST'),
    request('/cash-commission/checkout', rider.token, 'POST'),
  ]);
  assert.deepEqual(checkouts.map(({ status }) => status), [200, 200]);
  assert.equal(checkouts[0].body.amountKobo, '400000');
  assert.equal(checkouts[0].body.authorizationUrl, checkouts[1].body.authorizationUrl);
  const cashRefs = [...collections.keys()].filter((reference) => reference.startsWith('cash-'));
  assert.equal(cashRefs.length, 1);
  const cashRef = cashRefs[0];
  assert.equal((await webhook(cashRef, true, true)).status, 409);
  assert.equal((await balance()).body.blocked, true);
  assert.deepEqual((await Promise.all([webhook(cashRef), webhook(cashRef)])).map(({ status }) => status), [200, 200]);
  assert.deepEqual([ (await balance()).body.outstandingKobo, (await balance()).body.blocked ], ['0', false]);

  await finishCash(pending);
  rejectCashCheckout = true;
  assert.equal((await request('/cash-commission/checkout', rider.token, 'POST')).status, 422);
  const manualPath = `/admin/cash-commission/${rider.id}/record`;
  const external = { amountKobo: 200000, externalReference: 'bank-confirmed-12345' };
  assert.equal((await request(manualPath, rider.token, 'POST', external)).status, 403);
  assert.equal((await request(manualPath, admin.token, 'POST', { ...external, amountKobo: 1 })).status, 409);
  assert.equal((await request(manualPath, admin.token, 'POST', external)).status, 200);
  assert.equal((await request(manualPath, admin.token, 'POST', external)).status, 200);
  assert.equal((await balance()).body.outstandingKobo, '0');
  const repayments = await db.query("SELECT 1 FROM cash_commission_repayments WHERE rider_id=$1 AND state='paid'", [rider.id]);
  assert.equal(repayments.rowCount, 2);
  console.log('Cash commission accrual, overdue dispatch block, Bachs repayment, and audited manual reconciliation passed');
  console.log('Checkout, signed collection, Lagos cutoff, idempotent Connect credit, bank payout, dispute holds, and refunds passed');
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.end();
}
