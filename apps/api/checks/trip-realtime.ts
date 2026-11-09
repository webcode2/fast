import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from 'redis';
import { WebSocket } from 'ws';
import { db } from '../src/auth.ts';
import { TRIP_REALTIME } from '../src/cache-keys.ts';
import { server } from '../src/server.ts';

if (!process.env.DATABASE_URL || !process.env.REDIS_URL) throw new Error('Use a disposable migrated database and Redis');
const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
assert(address && typeof address !== 'string');
const peer = spawn(process.execPath, ['--input-type=module', '-e',
  "import { server } from './apps/api/src/server.ts'; server.listen(0,'127.0.0.1',()=>console.log(server.address().port));"],
  { stdio: ['ignore', 'pipe', 'inherit'] });
const peerExit = once(peer, 'exit');
let ws: WebSocket | undefined;

async function account(role: string) {
  const id = randomUUID();
  const token = randomBytes(32).toString('hex');
  await db.query('INSERT INTO accounts (id,role,email,phone,password_hash) VALUES ($1,$2,$3,$4,$5)',
    [id, role, id + '@example.test', id, 'unusable']);
  await db.query("INSERT INTO auth_sessions VALUES ($1,$2,now()+interval '1 hour')",
    [createHash('sha256').update(token).digest('hex'), id]);
  return { id, token };
}

try {
  const [port] = await once(peer.stdout, 'data');
  const base = 'http://127.0.0.1:' + String(port).trim();
  const customer = await account('customer');
  const rider = await account('rider');
  const { rows: [trip] } = await db.query(
    `INSERT INTO delivery_orders (customer_id,idempotency_key,request_hash,pickup,dropoff,
        route_distance_meters,fare_floor_kobo,offered_fare_kobo,status,assigned_rider_id,agreed_fare_kobo,assigned_at,payment_method)
     VALUES ($1,gen_random_uuid(),'test','POINT(7 4.8)','POINT(7.01 4.81)',
        1800,27000,30000,'assigned',$2,30000,clock_timestamp(),'cash') RETURNING id`, [customer.id, rider.id]);
  const path = '/trips/' + trip.id;
  const url = 'ws://127.0.0.1:' + address.port + path + '/comms/ws';
  const outsider = await account('rider');
  const forbidden = new WebSocket(url, { headers: { Authorization: 'Bearer ' + outsider.token } });
  const [, rejection] = await once(forbidden, 'unexpected-response');
  assert.equal(rejection.statusCode, 404);
  forbidden.on('error', () => {});
  forbidden.terminate();

  ws = new WebSocket(url, { headers: { Authorization: 'Bearer ' + customer.token } });
  const snapshots: any[] = [];
  ws.on('message', raw => snapshots.push(JSON.parse(String(raw))));
  const until = async (condition: () => unknown | Promise<unknown>) => {
    for (let i = 0; i < 100; i++) {
      if (await condition()) return;
      await delay(50);
    }
    assert.fail('WebSocket or Redis update timed out');
  };
  const presence = TRIP_REALTIME.PRESENCE + ':' + trip.id + ':' + customer.id + ':*';
  await until(() => snapshots.some(event => event.body.status === 'assigned'));
  await until(async () => (await redis.keys(presence)).length === 1);
  const post = (suffix: string, data?: object) => fetch(base + path + suffix, {
    method: 'POST', headers: { Authorization: 'Bearer ' + rider.token, 'Content-Type': 'application/json' },
    body: data && JSON.stringify(data),
  });
  assert.equal((await post('/comms/messages', {
    id: randomUUID(), assignment: snapshots[0].body.assignment, body: 'I am at pickup.',
  })).status, 200);
  await until(() => snapshots.some(event => event.body.messages?.some(message => message.body === 'I am at pickup.')));
  assert.equal((await post('/pickup')).status, 200);
  await until(() => snapshots.some(event => event.body.status === 'picked_up'));
  assert.equal((await post('/complete')).status, 200);
  await until(() => snapshots.some(event => event.body.status === 'completed' && event.body.active === false));
  ws.close();
  await once(ws, 'close');
  await until(async () => (await redis.keys(presence)).length === 0);
  ws = new WebSocket(url, { headers: { Authorization: 'Bearer ' + customer.token } });
  const [restored] = await once(ws, 'message', { signal: AbortSignal.timeout(5000) });
  const { body } = JSON.parse(String(restored));
  assert.equal(body.status, 'completed');
  assert.deepEqual(body.messages.map(({ body }) => body), ['I am at pickup.']);
  ws.close();
  await once(ws, 'close');
  console.log('Redis relayed cross-process updates, presence cleared, and reconnect restored history and status.');
} finally {
  ws?.terminate();
  peer.kill();
  await peerExit;
  await new Promise<void>(resolve => server.close(() => resolve()));
  await redis.quit();
  await db.end();
}
