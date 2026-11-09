import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { db } from '../src/auth.ts';
import { expireOverdueOrders, heartbeat, purgeExpiredAuthRows, removeUnverifiedAccounts } from '../src/maintenance-tasks.ts';
import { migrate } from '../src/migrate.ts';

if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL to an isolated, migrated test database');
const account = async (email: string, verified = false, days = 8) => (await db.query(
  `INSERT INTO accounts (role,email,phone,password_hash,phone_verified,created_at)
   VALUES ('customer',$1,$2,'test-only',$3,now()-make_interval(days => $4)) RETURNING id`,
  [email, '+234' + (8_000_000_000 + Math.floor(Math.random() * 99_999_999)), verified, days],
)).rows[0].id as string;
const exists = async (id: string) => Boolean((await db.query('SELECT 1 FROM accounts WHERE id=$1', [id])).rowCount);

try {
  assert.deepEqual(await migrate(), [], 'A second migration run applies nothing');
  const { rows: [{ count }] } = await db.query('SELECT count(*)::int FROM schema_migrations');
  assert.ok(count >= 16);
  assert.ok(readFileSync(new URL('../migrations/016_pilot_hardening.sql', import.meta.url), 'utf8').includes('auth_sessions_one_device'));

  const squatter = await account('squatter@example.test');
  const recent = await account('recent@example.test', false, 1);
  const verified = await account('verified@example.test', true);
  const orderer = await account('orderer@example.test');
  const { rows: [order] } = await db.query(
    `INSERT INTO delivery_orders (customer_id,idempotency_key,request_hash,pickup,dropoff,route_distance_meters,
       fare_floor_kobo,offered_fare_kobo,payment_method,bidding_expires_at)
     VALUES ($1,$2,'test',ST_GeogFromText('POINT(7.01 4.81)'),ST_GeogFromText('POINT(7.02 4.82)'),1000,15000,20000,'cash',
       now()-interval '1 minute') RETURNING id`, [orderer, randomUUID()],
  );
  assert.equal(await removeUnverifiedAccounts(), 1);
  assert.deepEqual(await Promise.all([squatter, recent, verified, orderer].map(exists)), [false, true, true, true],
    'Only old unverified accounts with no history are removed');

  assert.equal(await expireOverdueOrders(), 1);
  const { rows: [expired] } = await db.query('SELECT status FROM delivery_orders WHERE id=$1', [order.id]);
  assert.equal(expired.status, 'expired');

  await db.query("INSERT INTO auth_sessions (token_hash,account_id,expires_at) VALUES ('old',$1,now()-interval '1 hour')", [verified]);
  await db.query("INSERT INTO auth_limits VALUES ('old-limit',1,now()-interval '1 hour')");
  await purgeExpiredAuthRows();
  assert.equal((await db.query("SELECT 1 FROM auth_sessions WHERE token_hash='old'")).rowCount, 0);
  assert.equal((await db.query("SELECT 1 FROM auth_limits WHERE bucket='old-limit'")).rowCount, 0);

  await heartbeat('test');
  await heartbeat('test', true);
  const { rows: [beat] } = await db.query("SELECT last_failed_at FROM worker_heartbeats WHERE worker='test'");
  assert.ok(beat.last_failed_at);
  console.log('Migration tracking, unverified account cleanup, order expiry, auth purge, and heartbeats passed');
} finally {
  await db.end();
}
