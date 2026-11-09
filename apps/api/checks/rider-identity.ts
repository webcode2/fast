import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { db, hashPassword } from '../src/auth.ts';
import { server } from '../src/server.ts';

if (!process.env.DATABASE_URL) throw new Error('Use a fresh migrated test database');
Object.assign(process.env, {
  NODE_ENV: 'test',
  SMILE_SANDBOX_PARTNER_ID: '1234',
  SMILE_SANDBOX_API_KEY: 'contract-test-key',
  SMILE_CALLBACK_SECRET: 'contract-test-callback-secret-123456',
  SMILE_CALLBACK_BASE_URL: 'https://fastlogistics.example',
  SMILE_PRIVACY_URL: 'https://fastlogistics.example/privacy',
});

const network = globalThis.fetch;
const links = new Map<string, { user: string; callback: string }>();
const jobs = new Map<string, { user: string; status: string }>();
globalThis.fetch = async (input, options) => {
  const url = new URL(String(input));
  if (url.hostname !== 'testapi.smileidentity.com') return network(input, options);
  const headers = new Headers(options?.headers);
  assert.equal(headers.get('smileid-partner-id'), '1234');
  if (url.pathname === '/v3/token') {
    assert.equal(headers.get('smileid-api-key'), 'contract-test-key');
    return Response.json({ token: 'contract-test-token' });
  }
  assert.equal(headers.get('smileid-token'), 'contract-test-token');
  if (url.pathname === '/v3/smile_links') {
    assert.ok(options?.body instanceof FormData);
    const form = options.body;
    const idType = JSON.parse(String(form.get('id_types')))[0];
    assert.equal(idType.country, 'NG');
    assert.equal(idType.verification_method, idType.id_type === 'NIN' ? 'biometric_kyc' : 'document_verification');
    assert.equal(form.get('is_single_use'), 'true');
    assert.equal(form.get('notice_privacy_policy_url'), 'https://fastlogistics.example/privacy');
    const user = String(form.get('user_id'));
    const callback = new URL(String(form.get('callback_url'))).pathname;
    links.set(idType.id_type, { user, callback });
    const ref = randomUUID();
    return Response.json({ user_id: user, ref_id: ref, link: 'https://links.usesmileid.com/v3/1234/' + ref }, { status: 201 });
  }
  if (url.pathname.startsWith('/v3/status/')) {
    const jobId = url.pathname.split('/').at(-1)!;
    const job = jobs.get(jobId);
    return job ? Response.json({ job_id: jobId, user_id: job.user, status: job.status }) : new Response(null, { status: 404 });
  }
  throw new Error('Unexpected Smile ID request');
};

server.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
assert(address && typeof address !== 'string');
const base = 'http://127.0.0.1:' + address.port;
const password = 'identity-test-password';

async function call(path: string, token?: string, body?: object) {
  const response = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}

try {
  const email = 'rider@identity.example.test';
  assert.equal((await call('/auth/register', undefined, {
    role: 'rider', name: 'Identity rider', email, password, phone: '+2348012345991',
  })).status, 202);
  const rider = (await call('/auth/login', undefined, { email, password })).body;
  const start = (kind: string, consent = true) => call('/identity/rider/start', rider.token, { kind, consent });
  assert.equal((await start('nin')).status, 403);
  await db.query('UPDATE accounts SET phone_verified=true WHERE id=$1', [rider.user.id]);
  assert.equal((await start('nin', false)).status, 400);
  const { rows: [admin] } = await db.query(
    `INSERT INTO accounts (role,email,phone,password_hash,email_verified,phone_verified)
     VALUES ('admin','admin@identity.example.test','+2348012345992',$1,true,true) RETURNING id`,
    [await hashPassword(password)],
  );
  await db.query("INSERT INTO staff_role_assignments (account_id,role) VALUES ($1,'administrator')", [admin.id]);
  const staff = (await call('/auth/login', undefined, { email: 'admin@identity.example.test', password })).body;
  const approve = (samePersonConfirmed = true) =>
    call('/dispatch/riders/' + rider.user.id + '/identity', staff.token, { approved: true, samePersonConfirmed });
  assert.equal((await approve()).status, 409);
  const first = await start('nin');
  assert.equal(first.status, 201);
  assert.equal((await start('nin')).body.url, first.body.url);
  const nin = links.get('NIN')!;
  const ninJob = 'job_' + '1'.repeat(26);
  jobs.set(ninJob, { user: 'wrong-user', status: 'clear' });
  assert.equal((await call(nin.callback.slice(0, -64) + '0'.repeat(64), undefined, { job_id: ninJob })).status, 401);
  assert.equal((await call(nin.callback, undefined, { job_id: ninJob })).status, 409);
  jobs.set(ninJob, { user: nin.user, status: 'processing' });
  assert.equal((await call(nin.callback, undefined, { job_id: ninJob })).status, 200);
  jobs.set(ninJob, { user: nin.user, status: 'clear' });
  assert.equal((await call('/identity/rider/refresh', rider.token, {})).status, 200);
  assert.equal((await approve()).status, 409);
  assert.equal((await start('licence')).status, 201);
  const licence = links.get('DRIVERS_LICENSE')!;
  const licenceJob = 'job_' + '2'.repeat(26);
  jobs.set(licenceJob, { user: licence.user, status: 'clear' });
  assert.equal((await call(licence.callback, undefined, { job_id: licenceJob })).status, 200);
  assert.equal((await call(licence.callback, undefined, { job_id: licenceJob })).status, 200);
  const before = await call('/identity/rider', rider.token);
  assert.deepEqual(before.body.checks, [{ kind: 'licence', status: 'clear' }, { kind: 'nin', status: 'clear' }]);
  assert.equal(before.body.approved, false);
  assert.equal((await call('/admin/rider-identity', rider.token)).status, 403);
  const queue = await call('/admin/rider-identity', staff.token);
  assert.equal(queue.body.riders[0].ninJob, ninJob);
  assert.equal(queue.body.riders[0].licenceJob, licenceJob);
  assert.equal((await approve(false)).status, 400);
  assert.equal((await approve()).status, 200);
  assert.equal((await call('/identity/rider', rider.token)).body.approved, true);
  assert.equal((await call('/admin/rider-identity', staff.token)).body.riders.length, 0);
  console.log('Hosted check creation, callback ownership, two-check gate, and staff approval passed');
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.end();
}
