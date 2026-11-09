import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { db } from '../src/auth.ts';
import { server } from '../src/server.ts';

if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL to an isolated, migrated test database');
const website = 'https://fastlogistics.example.test';
process.env.WAITLIST_ORIGINS = `${website}, http://127.0.0.1:8092`;
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
assert(address && typeof address !== 'string');
const base = `http://127.0.0.1:${address.port}`;

async function actor(role: string, assignment?: string) {
  const { rows: [user] } = await db.query(
    `INSERT INTO accounts (role,email,phone,password_hash,email_verified,phone_verified)
     VALUES ($1,$2,$3,'test-only',true,true) RETURNING id`,
    [role, `${randomUUID()}@waitlist.example.test`, `+234${8_000_000_000 + (randomBytes(4).readUInt32BE() % 99_999_999)}`],
  );
  if (assignment) await db.query('INSERT INTO staff_role_assignments (account_id,role) VALUES ($1,$2)', [user.id, assignment]);
  const token = randomBytes(32).toString('hex');
  await db.query("INSERT INTO auth_sessions VALUES ($1,$2,now()+interval '1 hour')",
    [createHash('sha256').update(token).digest('hex'), user.id]);
  return token;
}

const join = (body: object, origin: string | null = website) => fetch(`${base}/waitlist`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
  body: JSON.stringify(body),
});
const asStaff = (path: string, token: string, method = 'GET') =>
  fetch(base + path, { method, headers: { Authorization: `Bearer ${token}` } });
const signup = { contact: '0806 000 0000', role: 'customer', consent: true };

try {
  const preflight = await fetch(`${base}/waitlist`, { method: 'OPTIONS', headers: { Origin: website } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), website);
  const denied = await fetch(`${base}/waitlist`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example.test' } });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('access-control-allow-origin'), null);

  assert.equal((await join(signup, 'https://evil.example.test')).status, 403);
  assert.equal((await join({ ...signup, contact: 'nope' })).status, 400);
  assert.equal((await join({ ...signup, role: 'admin' })).status, 400);
  assert.equal((await join({ ...signup, consent: false })).status, 400);
  assert.equal((await db.query('SELECT 1 FROM waitlist_signups')).rowCount, 0, 'Invalid signups store nothing');

  const joined = await join(signup);
  assert.equal(joined.status, 202);
  assert.equal(joined.headers.get('access-control-allow-origin'), website);
  assert.equal((await join({ ...signup, contact: '+2348060000000', role: 'rider' })).status, 202, 'A repeat looks the same');
  assert.equal((await join({ ...signup, contact: 'Ada@Example.test', role: 'rider' })).status, 202);
  assert.equal((await join({ ...signup, contact: 'bot@example.test', website: 'spam.test' })).status, 202, 'Bots see success');

  const admin = await actor('admin', 'administrator');
  const operator = await actor('staff', 'recovery_operator');
  const customer = await actor('customer');
  assert.equal((await fetch(`${base}/admin/waitlist`)).status, 401);
  assert.equal((await asStaff('/admin/waitlist', customer)).status, 403);
  assert.equal((await asStaff('/admin/waitlist', operator)).status, 403, 'Contact data is for administrators only');

  const list = await (await asStaff('/admin/waitlist', admin)).json();
  assert.deepEqual([list.total, list.customers, list.riders], [2, 1, 1]);
  const contacts = list.signups.map(({ contact }: { contact: string }) => contact).sort();
  assert.deepEqual(contacts, ['+2348060000000', 'ada@example.test'], 'One entry each, with no bot entry');

  const { id } = list.signups[0];
  assert.equal((await asStaff(`/admin/waitlist/${id}/remove`, operator, 'POST')).status, 403);
  assert.equal((await asStaff(`/admin/waitlist/${id}/remove`, admin, 'POST')).status, 200);
  assert.equal((await asStaff(`/admin/waitlist/${id}/remove`, admin, 'POST')).status, 404);
  assert.equal((await (await asStaff('/admin/waitlist', admin)).json()).total, 1);

  let last = 202;
  for (let i = 0; i < 6 && last === 202; i++) last = (await join({ ...signup, contact: 'repeat@example.test' })).status;
  assert.equal(last, 429, 'Repeated attempts for one contact are limited');
  console.log('Waitlist origin rules, validation, privacy of repeats, staff access, removal, and limits passed');
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.end();
}
