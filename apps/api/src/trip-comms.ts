import { createHmac } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { authenticatedAccount, db, limited, readJson } from './auth.ts';
import { uuid } from './orders.ts';

const send = (status: number, body: object) => ({ status, body });
const member = 'o.assigned_rider_id IS NOT NULL AND (o.customer_id=$2 OR o.assigned_rider_id=$2)';
const active = "o.status IN ('assigned','picked_up')";
const callFields = 'id, caller_id AS "callerId", offer, answer, expires_at AS "expiresAt"';
const messageFields = 'id, sender_id AS "senderId", body, sent_at AS "sentAt"';
const unavailable = () => send(409, { error: 'Trip or call is no longer active' });

function turnSettings() {
  const secret = process.env.TURN_SHARED_SECRET;
  const urls = process.env.TURN_URLS?.split(',').map((url) => url.trim()).filter(Boolean);
  if (!secret || Buffer.byteLength(secret) < 32 || !urls?.length ||
      urls.some((url) => !/^turns?:[^\s]+$/.test(url))) return;
  return { secret, urls };
}

export async function tripComms(request: IncomingMessage, target: string) {
  const url = new URL(target, 'http://localhost');
  const [, orderId, action] = url.pathname.match(/^\/trips\/([^/]+)\/comms(?:\/(messages|ice|call|answer|hangup))?$/) ?? [];
  if (!orderId || !uuid.test(orderId)) return send(404, { error: 'Trip not found' });
  const account = await authenticatedAccount(request);
  if (!account) return send(401, { error: 'Sign in required' });

  if (request.method === 'GET') {
    if (action === 'ice') {
      const result = await db.query(`SELECT 1 FROM delivery_orders o WHERE o.id=$1 AND ${member} AND ${active}`,
        [orderId, account.id]);
      if (!result.rowCount) return unavailable();
      const settings = turnSettings();
      if (!settings) return send(503, { error: 'Voice relay is unavailable' });
      if (await limited(`trip-ice:${account.id}`, 30)) return send(429, { error: 'Too many call requests' });
      const username = `${Math.floor(Date.now() / 1000) + 3900}:${account.id}`;
      const credential = createHmac('sha1', settings.secret).update(username).digest('base64');
      return send(200, { iceServers: [{ urls: settings.urls, username, credential }] });
    }
    if (action && action !== 'messages') return send(405, { error: 'Method not supported' });
    const before = url.searchParams.get('before');
    if (before !== null && (!/^\d{1,19}$/.test(before) || BigInt(before) > 9223372036854775807n)) {
      return send(400, { error: 'Invalid message cursor' });
    }
    const { rows: [snapshot] } = await db.query(
      `SELECT o.status, (${active}) AS active, $2::uuid AS "accountId", o.assigned_at::text AS assignment,
       COALESCE((SELECT json_agg(m ORDER BY m.sequence) FROM (
         SELECT id::text AS id, id AS sequence, sender_id AS "senderId", body, sent_at AS "sentAt"
         FROM trip_messages WHERE order_id=o.id AND assignment_at=o.assigned_at
           AND ($3::bigint IS NULL OR id<$3) ORDER BY id DESC LIMIT 50
       ) m), '[]'::json) AS messages,
       (SELECT row_to_json(c) FROM (SELECT ${callFields} FROM trip_calls
         WHERE order_id=o.id AND assignment_at=o.assigned_at AND expires_at>clock_timestamp()
         AND ${active}) c) AS call
       FROM delivery_orders o WHERE o.id=$1 AND ${member}`, [orderId, account.id, before],
    );
    return snapshot ? send(200, snapshot) : send(404, { error: 'Trip not found' });
  }

  if (request.method !== 'POST' || !action || action === 'ice') return send(405, { error: 'Method not supported' });
  const input = await readJson(request, 32_768).catch(() => null);
  if (!input) return send(400, { error: 'Invalid request body' });
  const id = input.id;
  if (typeof id !== 'string' || !uuid.test(id)) return send(400, { error: 'Provide a valid request ID' });
  const message = typeof input.body === 'string' ? input.body.trim() : '';
  const sdp = input.sdp;
  if (action === 'messages' && (!message || message.length > 2000 || message.includes('\0'))) {
    return send(400, { error: 'Enter a message of up to 2000 characters' });
  }
  if ((action === 'call' || action === 'answer') &&
      (typeof sdp !== 'string' || !sdp.startsWith('v=0') || sdp.length > 24_000 || sdp.includes('\0') ||
        !/^m=audio /m.test(sdp) || /^m=(?!audio )/m.test(sdp) ||
        !/^a=candidate:.* typ relay(?: |\r?$)/m.test(sdp) ||
        /^a=candidate:(?!.* typ relay(?: |\r?$))/m.test(sdp))) {
    return send(400, { error: 'Provide an audio-only session description' });
  }
  if (await limited(`trip-comms:${account.id}`, 180)) return send(429, { error: 'Too many communication requests' });
  if (action === 'call' && !turnSettings()) return send(503, { error: 'Voice relay is unavailable' });

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows: [trip] } = await client.query(
      `SELECT o.assigned_at::text AS assignment FROM delivery_orders o
       WHERE o.id=$1 AND ${member} AND ${active} FOR UPDATE`, [orderId, account.id],
    );
    if (!trip || trip.assignment !== input.assignment) return unavailable();
    const scope = [orderId, trip.assignment];
    if (action === 'messages') {
      const { rows: [saved] } = await client.query(
        `INSERT INTO trip_messages (order_id,assignment_at,sender_id,client_id,body) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (order_id,assignment_at,sender_id,client_id) DO UPDATE SET body=trip_messages.body
         WHERE trip_messages.body=excluded.body RETURNING ${messageFields}`,
        [...scope, account.id, id, message],
      );
      if (!saved) return send(409, { error: 'Message ID already used' });
      await client.query('COMMIT');
      return send(200, { message: saved });
    }
    const { rows: [current] } = await client.query(
      `SELECT ${callFields} FROM trip_calls
       WHERE order_id=$1 AND assignment_at=$2 AND expires_at>clock_timestamp()`, scope,
    );
    if (action === 'hangup') {
      await client.query('DELETE FROM trip_calls WHERE order_id=$1 AND assignment_at=$2 AND id=$3', [...scope, id]);
      await client.query('COMMIT');
      return send(200, { ok: true });
    }
    if (action === 'call') {
      if (current) {
        return current.id === id && current.callerId === account.id && current.offer === sdp
          ? send(200, { call: current }) : send(409, { error: 'A call is already active' });
      }
      const { rows: [call] } = await client.query(
        `INSERT INTO trip_calls (order_id,assignment_at,id,caller_id,offer,expires_at)
         VALUES ($1,$2,$3,$4,$5,clock_timestamp()+interval '90 seconds')
         ON CONFLICT (order_id) DO UPDATE SET assignment_at=excluded.assignment_at,id=excluded.id,
           caller_id=excluded.caller_id,offer=excluded.offer,answer=NULL,expires_at=excluded.expires_at
         RETURNING ${callFields}`, [...scope, id, account.id, sdp],
      );
      await client.query('COMMIT');
      return send(201, { call });
    }
    if (!current || current.id !== id || current.callerId === account.id) return unavailable();
    if (current.answer) return current.answer === sdp ? send(200, { call: current }) : unavailable();
    const { rows: [call] } = await client.query(
      `UPDATE trip_calls SET answer=$2,expires_at=clock_timestamp()+interval '1 hour'
       WHERE id=$1 AND expires_at>clock_timestamp() RETURNING ${callFields}`, [id, sdp],
    );
    if (!call) return unavailable();
    await client.query('COMMIT');
    return send(200, { call });
  } finally {
    try { await client.query('ROLLBACK'); } finally { client.release(); }
  }
}
