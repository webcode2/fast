import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { db, hashPassword } from '../src/auth.ts';
import { maintainAccounts } from '../src/account-archive.ts';
import { server } from '../src/server.ts';

if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL to a fresh, migrated test database');
process.env.ACCOUNT_ARCHIVE_KEY = randomBytes(32).toString('hex');
const password = 'account-lifecycle-test-password';
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
assert(address && typeof address !== 'string');
const base = `http://127.0.0.1:${address.port}`;

async function request(path: string, data?: object, token?: string, method = data ? 'POST' : 'GET') {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(data ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  return { status: response.status, body: await response.json() };
}

async function staff(role: string, number: number) {
  const email = `${role}${number}@accounts.example.test`;
  const { rows: [user] } = await db.query(
    `INSERT INTO accounts (role,email,phone,password_hash,email_verified,phone_verified)
     VALUES ($1,$2,$3,$4,true,true) RETURNING id`,
    [role, email, `+23480123459${number}`, await hashPassword(password)],
  );
  await db.query('INSERT INTO account_profiles VALUES ($1,$2,$2)', [user.id, role]);
  if (role === 'admin') await db.query(
    "INSERT INTO staff_role_assignments (account_id,role) VALUES ($1,'administrator')", [user.id],
  );
  const login = await request('/auth/login', { email, password, client: 'admin' });
  assert.equal(login.status, 200);
  return { id: user.id, token: login.body.token as string };
}

try {
  const admin = await staff('admin', 1);
  const manager = await staff('staff', 2);
  const operator = await staff('staff', 3);
  const assign = (id: string, token: string, roles: string[]) =>
    request(`/admin/staff/${id}/roles`, { roles }, token, 'PUT');
  assert.equal((await assign(manager.id, manager.token, ['staff_manager'])).status, 403);
  assert.equal((await assign(manager.id, admin.token, ['staff_manager'])).status, 200);
  assert.equal((await assign(operator.id, manager.token, ['archive_exporter'])).status, 400);
  assert.deepEqual((await assign(operator.id, manager.token, ['dispute_resolver', 'recovery_operator'])).body.roles,
    ['dispute_resolver', 'recovery_operator']);
  assert.equal((await request('/admin/disputes', undefined, operator.token)).status, 200);
  assert.equal((await request('/trips/recovery-alerts', undefined, operator.token)).status, 200);
  assert.equal((await request('/admin/archives', undefined, operator.token)).status, 403);
  assert.equal((await assign(operator.id, admin.token, ['archive_exporter'])).status, 200);
  assert.equal((await request('/admin/disputes', undefined, operator.token)).status, 403);
  assert.equal((await request('/admin/archives', undefined, operator.token)).status, 200);

  const email = 'customer@accounts.example.test';
  const credentials = { email, password };
  const register = await request('/auth/register', {
    ...credentials, name: 'Lifecycle Customer', phone: '+234801234599', role: 'customer',
  });
  assert.equal(register.status, 202);
  const login = await request('/auth/login', credentials);
  assert.equal(login.body.user.name, 'Lifecycle Customer');
  const id = login.body.user.id;
  const token = login.body.token;
  const { rows: [rider] } = await db.query(
    "INSERT INTO accounts (role,email,phone,password_hash) VALUES ('rider','rider@accounts.example.test','+234801234598','test-only') RETURNING id",
  );
  const { rows: [trip] } = await db.query(
    `INSERT INTO delivery_orders (customer_id,idempotency_key,request_hash,pickup,dropoff,
       route_distance_meters,fare_floor_kobo,offered_fare_kobo,status,assigned_rider_id,
       agreed_fare_kobo,assigned_at,completed_at)
     VALUES ($1,gen_random_uuid(),'test',ST_GeogFromText('POINT(7.01 4.81)'),
       ST_GeogFromText('POINT(7.02 4.82)'),1000,15000,20000,'completed',$2,20000,now(),now())
     RETURNING id`, [id, rider.id],
  );
  await db.query(
    `INSERT INTO trip_messages (order_id,assignment_at,sender_id,client_id,body)
     SELECT id,assigned_at,customer_id,gen_random_uuid(),'Pickup instructions' FROM delivery_orders WHERE id=$1`, [trip.id],
  );
  await db.query("INSERT INTO trip_reviews (order_id,rating,comment) VALUES ($1,4,'Delivery feedback')", [trip.id]);
  await db.query("INSERT INTO trip_disputes (order_id,details) VALUES ($1,'Case details')", [trip.id]);
  const row = (await db.query('SELECT * FROM account_profiles WHERE account_id=$1', [id])).rows[0];
  assert.equal(row.account_type, 'customer');
  assert.equal((await request('/auth/delete', { password: 'not-the-right-password' }, token)).status, 401);
  const deletion = await request('/auth/delete', { password }, token);
  assert.equal(deletion.status, 200);
  assert.equal(Date.parse(deletion.body.recoverUntil) - Date.parse(deletion.body.deletedAt), 30 * 86_400_000);
  assert.equal((await request('/auth/profile', undefined, token)).status, 401);
  assert.equal((await request('/auth/login', credentials)).status, 403);
  assert.equal((await request('/auth/recover', credentials)).status, 200);
  const restored = await request('/auth/login', credentials);
  assert.equal(restored.status, 200);
  assert.equal((await request('/auth/delete', { password }, restored.body.token)).status, 200);
  await db.query("UPDATE accounts SET deleted_at=clock_timestamp()-interval '31 days' WHERE id=$1", [id]);
  assert.equal((await request('/auth/recover', credentials)).status, 409);

  assert.deepEqual(await maintainAccounts(), { archived: 1, purged: 0 });
  assert.deepEqual(await maintainAccounts(), { archived: 0, purged: 0 });
  const { rows: [scrubbed] } = await db.query('SELECT email,phone,password_hash,archived_at FROM accounts WHERE id=$1', [id]);
  assert.equal(scrubbed.email, null);
  assert.equal(scrubbed.phone, null);
  assert.equal(scrubbed.password_hash, null);
  assert.ok(scrubbed.archived_at);
  assert.equal((await db.query('SELECT 1 FROM account_profiles WHERE account_id=$1', [id])).rowCount, 0);
  assert.equal((await request('/auth/recover', credentials)).status, 401);
  const archive = (await request('/admin/archives', undefined, operator.token)).body.archives[0];
  assert.equal(archive.accountId, id);
  const { rows: [expiry] } = await db.query(
    'SELECT extract(epoch FROM (purge_at-deleted_at)) AS seconds FROM account_archives JOIN accounts ON id=account_id WHERE id=$1', [id],
  );
  assert.equal(Number(expiry.seconds), 150 * 86_400);
  const exportPath = '/admin/archives/' + id + '/export';
  assert.equal((await request(exportPath, {}, manager.token)).status, 403);
  const exported = await request(exportPath, {}, operator.token);
  assert.equal(exported.status, 200);
  assert.equal(exported.body.archive.email, email);
  assert.equal(exported.body.archive.profile.display_name, 'Lifecycle Customer');
  assert.equal(exported.body.archive.messages[0].body, 'Pickup instructions');
  assert.equal(exported.body.archive.reviews[0].comment, 'Delivery feedback');
  assert.equal(exported.body.archive.reports[0].details, 'Case details');
  assert.deepEqual(exported.body.archive.deliveryLocations[0].pickup.coordinates, [7.01, 4.81]);
  assert.equal((await db.query('SELECT 1 FROM trip_messages WHERE sender_id=$1', [id])).rowCount, 0);
  const retained = (await db.query(
    `SELECT o.pickup,o.dropoff,r.rating,r.comment,d.details FROM delivery_orders o
     JOIN trip_reviews r ON r.order_id=o.id JOIN trip_disputes d ON d.order_id=o.id WHERE o.id=$1`, [trip.id],
  )).rows[0];
  assert.deepEqual(retained, { pickup: null, dropoff: null, rating: 4, comment: '', details: 'Removed with account' });
  assert.equal(exported.body.archive.password_hash, undefined);
  assert.equal((await db.query('SELECT 1 FROM account_archive_exports WHERE account_id=$1 AND actor_id=$2', [id, operator.id])).rowCount, 1);
  await db.query("UPDATE account_archives SET purge_at=clock_timestamp()-interval '1 second' WHERE account_id=$1", [id]);
  assert.equal((await request(exportPath, {}, operator.token)).status, 404);
  assert.deepEqual(await maintainAccounts(), { archived: 0, purged: 1 });
  assert.equal((await db.query('SELECT 1 FROM account_archives WHERE account_id=$1', [id])).rowCount, 0);
  console.log('Recovery deadline, encrypted archive, audited export, purge, and multi-role access passed');
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.end();
}
