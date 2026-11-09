import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { db } from '../src/auth.ts';
import { server } from '../src/server.ts';

if (!process.env.DATABASE_URL || !process.env.TURN_SHARED_SECRET || !process.env.TURN_URLS) {
  throw new Error('Set the isolated migrated database and real TURN configuration');
}

const host = createServer((request, response) => {
  if (request.url === '/media-check') {
    response.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>Trip media integration</title>');
  } else {
    server.emit('request', request, response);
  }
});
host.listen(0, '127.0.0.1');
await once(host, 'listening');
const address = host.address();
assert(address && typeof address !== 'string');
const base = `http://127.0.0.1:${address.port}`;
const profile = await mkdtemp(join(tmpdir(), 'fastlogistics-chrome-'));
// Provide deterministic microphone input to the test browser only.
const sampleRate = 48_000;
const tone = Buffer.alloc(44 + sampleRate * 2);
tone.write('RIFF', 0);
tone.writeUInt32LE(tone.length - 8, 4);
tone.write('WAVEfmt ', 8);
tone.writeUInt32LE(16, 16);
tone.writeUInt16LE(1, 20);
tone.writeUInt16LE(1, 22);
tone.writeUInt32LE(sampleRate, 24);
tone.writeUInt32LE(sampleRate * 2, 28);
tone.writeUInt16LE(2, 32);
tone.writeUInt16LE(16, 34);
tone.write('data', 36);
tone.writeUInt32LE(sampleRate * 2, 40);
for (let i = 0; i < sampleRate; i++) {
  tone.writeInt16LE(Math.round(12_000 * Math.sin(2 * Math.PI * 440 * i / sampleRate)), 44 + i * 2);
}
const microphoneFile = join(profile, 'microphone.wav');
await writeFile(microphoneFile, tone);
const chrome = spawn(process.env.CHROME_BIN ?? 'google-chrome', [
  '--headless', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
  '--autoplay-policy=no-user-gesture-required',
  `--use-file-for-fake-audio-capture=${microphoneFile}`, '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });

const sockets: WebSocket[] = [];
async function until<T>(probe: () => Promise<T | undefined>, timeout = 15_000): Promise<T> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await probe();
    if (value !== undefined) return value;
    await delay(100);
  }
  throw new Error('Timed out waiting for browser media');
}

async function peerPage(debugPort: string, token: string, path: string) {
  const target = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(base + '/media-check')}`,
    { method: 'PUT' }).then((response) => response.json());
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let sequence = 0;
  async function evaluate<T>(expression: string): Promise<T> {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.removeEventListener('message', onMessage);
        reject(new Error('Chrome evaluation timed out'));
      }, 25_000);
      function onMessage(event: MessageEvent) {
        const result = JSON.parse(String(event.data));
        if (result.id !== id) return;
        socket.removeEventListener('message', onMessage);
        clearTimeout(timer);
        if (result.error || result.result?.exceptionDetails) {
          reject(new Error(result.result?.exceptionDetails?.exception?.description ?? result.error?.message ?? 'Chrome error'));
        } else resolve(result.result.result.value);
      }
      socket.addEventListener('message', onMessage);
      socket.send(JSON.stringify({
        id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true },
      }));
    });
  }
  await until(async () => await evaluate('location.origin') === base ? true : undefined);
  await evaluate(`(${installPeer})(${JSON.stringify(token)},${JSON.stringify(path)})`);
  return evaluate;
}

// This function runs in each isolated browser page and exercises getUserMedia.
function installPeer(token: string, path: string) {
  let assignment: string | undefined;
  async function request(suffix = '', data?: object) {
    if (data && !assignment) await request();
    const response = await fetch(path + suffix, {
      method: data ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: data ? JSON.stringify({ ...data, assignment }) : undefined,
    });
    const body = await response.json();
    if (!suffix && response.ok) assignment = body.assignment;
    return { status: response.status, body };
  }
  let connection: RTCPeerConnection;
  let microphone: MediaStream;
  async function negotiate(offer?: string) {
    const config = await request('/ice');
    if (config.status !== 200) throw new Error('Could not obtain TURN credentials');
    connection = new RTCPeerConnection({ iceServers: config.body.iceServers, iceTransportPolicy: 'relay' });
    microphone = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    connection.addTrack(microphone.getAudioTracks()[0], microphone);
    connection.ontrack = ({ track }) => {
      const player = document.createElement('audio');
      player.autoplay = true;
      player.srcObject = new MediaStream([track]);
      document.body.appendChild(player);
      void player.play();
    };
    if (offer) await connection.setRemoteDescription({ type: 'offer', sdp: offer });
    await connection.setLocalDescription(offer ? await connection.createAnswer() : await connection.createOffer());
    await new Promise<void>((resolve, reject) => {
      if (connection.iceGatheringState === 'complete') return resolve();
      const timer = setTimeout(() => reject(new Error('ICE gathering timed out')), 15_000);
      connection.onicegatheringstatechange = () => {
        if (connection.iceGatheringState === 'complete') {
          clearTimeout(timer);
          resolve();
        }
      };
    });
    const sdp = connection.localDescription?.sdp;
    if (!sdp?.includes(' typ relay')) throw new Error('No TURN relay candidate');
    return sdp;
  }
  async function media() {
    if (!connection) return null;
    const stats = await connection.getStats();
    const reports = [...stats.values()];
    const transport = reports.find((report) => report.type === 'transport');
    const pair = stats.get(transport?.selectedCandidatePairId);
    const audioInbound = reports.find((report) => report.type === 'inbound-rtp' && report.kind === 'audio');
    return {
      connected: connection.connectionState === 'connected',
      relay: stats.get(pair?.localCandidateId)?.candidateType === 'relay' &&
        stats.get(pair?.remoteCandidateId)?.candidateType === 'relay',
      packets: audioInbound?.packetsReceived ?? 0,
      energy: audioInbound?.totalAudioEnergy ?? 0,
      samples: audioInbound?.totalSamplesReceived ?? 0,
      sentEnergy: reports.find((report) => report.type === 'media-source')?.totalAudioEnergy ?? 0,
    };
  }
  Object.assign(globalThis, { client: {
    request, negotiate, media,
    apply: (sdp: string) => connection.setRemoteDescription({ type: 'answer', sdp }),
    close: () => { connection.close(); microphone.getTracks().forEach((track) => track.stop()); },
  } });
}

async function createAccount(role: string, phone: string) {
  const email = `${randomUUID()}@communications.example.test`;
  const password = 'communications-test-password';
  const post = (path: string, body: object) => fetch(base + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert.equal((await post('/auth/register', { role, email, phone, password, name: role })).status, 202);
  const login = await post('/auth/login', { email, password });
  assert.equal(login.status, 200);
  return login.json();
}

try {
  const port = await until(async () => {
    if (chrome.exitCode !== null) throw new Error('Chrome exited before the test');
    return (await readFile(join(profile, 'DevToolsActivePort'), 'utf8').catch(() => '')).split('\n')[0] || undefined;
  });
  const customer = await createAccount('customer', '+2348012345801');
  const rider = await createAccount('rider', '+2348012345802');
  const outsider = await createAccount('rider', '+2348012345803');
  const { rows: [trip] } = await db.query(
    `INSERT INTO delivery_orders (customer_id,idempotency_key,request_hash,pickup,dropoff,
       route_distance_meters,fare_floor_kobo,offered_fare_kobo,status,assigned_rider_id,agreed_fare_kobo,assigned_at,payment_method)
     VALUES ($1,gen_random_uuid(),'test',ST_GeogFromText('POINT(7.01 4.81)'),
       ST_GeogFromText('POINT(7.02 4.82)'),1000,15000,20000,'assigned',$2,20000,clock_timestamp())
     RETURNING id`, [customer.user.id, rider.user.id],
  );
  const path = `/trips/${trip.id}/comms`;
  const a = await peerPage(port, customer.token, path);
  const b = await peerPage(port, rider.token, path);
  assert.equal((await fetch(base + path, { headers: { Authorization: 'Bearer ' + outsider.token } })).status, 404);

  const postChat = (evaluate: typeof a, text: string, id = randomUUID()) =>
    evaluate<{ status: number; body: { message: { id: string } } }>(
      `client.request('/messages', ${JSON.stringify({ id, body: text })})`,
    );
  const messageId = randomUUID();
  const first = await postChat(a, 'I am at the pickup point.', messageId);
  assert.equal(first.status, 200);
  assert.equal((await postChat(a, 'I am at the pickup point.', messageId)).body.message.id, first.body.message.id);
  const chat = await b<{ body: { messages: { body: string }[] } }>('client.request()');
  assert.deepEqual(chat.body.messages.map(({ body }) => body), ['I am at the pickup point.']);
  assert.equal((await postChat(b, 'I will meet you there.')).status, 200);
  assert.match(JSON.stringify(await a('client.request()')), /I will meet you there/);
  console.log('Two authenticated clients exchanged and retrieved messages from PostgreSQL');

  const id = randomUUID();
  const offer = await a<string>('client.negotiate()');
  assert.equal((await a<{ status: number }>(`client.request('/call', ${JSON.stringify({ id, sdp: offer })})`)).status, 201);
  const incoming = await b<{ body: { call: { id: string; offer: string } } }>('client.request()');
  assert.equal(incoming.body.call.id, id);
  const answer = await b<string>(`client.negotiate(${JSON.stringify(incoming.body.call.offer)})`);
  assert.equal((await b<{ status: number }>(`client.request('/answer', ${JSON.stringify({ id, sdp: answer })})`)).status, 200);
  const active = await a<{ body: { call: { answer: string } } }>('client.request()');
  await a(`client.apply(${JSON.stringify(active.body.call.answer)})`);

  type Media = { connected: boolean; relay: boolean; packets: number; energy: number };
  let lastSamples: (Media | null)[] = [];
  await until(async () => {
    const samples = lastSamples = await Promise.all([a<Media | null>('client.media()'), b<Media | null>('client.media()')]);
    return samples.every((sample) => sample?.connected && sample.relay && sample.packets > 15 && sample.energy > 0.001)
      ? true : undefined;
  }).catch((error) => {
    console.error('Last media observations:', lastSamples);
    throw error;
  });
  assert.equal((await b<{ status: number }>(`client.request('/hangup', { id: '${id}' })`)).status, 200);
  assert.equal((await a<{ body: { call: null } }>('client.request()')).body.call, null);
  await Promise.all([a('client.close()'), b('client.close()')]);
  await db.query(
    'UPDATE delivery_orders SET assigned_rider_id=$2, assigned_at=clock_timestamp() WHERE id=$1',
    [trip.id, outsider.user.id],
  );
  assert.equal((await b<{ status: number }>('client.request()')).status, 404);
  assert.equal((await postChat(a, 'Stale assignment message.')).status, 409);
  const replacement = await peerPage(port, outsider.token, path);
  const fresh = await replacement<{ body: { messages: unknown[]; call: null } }>('client.request()');
  assert.deepEqual(fresh.body.messages, []);
  assert.equal(fresh.body.call, null);
  console.log('Two independent WebRTC peers received bidirectional audio through coturn and ended the call');
} finally {
  for (const socket of sockets) socket.close();
  if (chrome.exitCode === null && chrome.signalCode === null) {
    chrome.kill();
    await once(chrome, 'exit');
  }
  await rm(profile, { recursive: true, force: true, maxRetries: 5 });
  host.closeAllConnections();
  await new Promise<void>((resolve) => host.close(() => resolve()));
  await db.end();
}
