import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { authenticatedAccount, db, limited, readJson } from './auth.ts';
import { NoStreetRoute, streetRoute, type Point, type StreetRoute } from './routing.ts';

export const fareFloorKoboPerMeter = 15;
const fields = `id, CASE WHEN status='pending_dispatch' AND bidding_expires_at<=clock_timestamp()
  THEN 'expired' ELSE status END AS status, bidding_expires_at AS "biddingExpiresAt", route_distance_meters AS "distanceMeters",
  fare_floor_kobo AS "fareFloorKobo", offered_fare_kobo AS "offeredFareKobo",
  payment_method AS "paymentMethod", created_at AS "createdAt",
  pickup_label AS "pickupLabel", dropoff_label AS "dropoffLabel"`;
export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const send = (status: number, body: object) => ({ status, body });
const conflict = () => send(409, { error: 'Idempotency key already used for a different order' });

export function point(value: unknown): Point | undefined {
  if (typeof value !== 'object' || value === null) return;
  const { latitude, longitude } = value as Partial<Point>;
  if (typeof latitude !== 'number' || typeof longitude !== 'number' ||
      !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return;
  return { latitude, longitude };
}

const placeLabel = (value: unknown) => {
  if (typeof value !== 'string') return null;
  // Labels are display text only, so unusable input falls back to no label.
  const label = value.replace(/\p{Cc}/gu, ' ').trim();
  return label.length > 0 && label.length <= 160 ? label : null;
};

export async function orders(request: IncomingMessage, path: string) {
  if (request.method === 'GET' && path === '/orders') {
    const customer = await authenticatedAccount(request);
    if (!customer) return send(401, { error: 'Sign in required' });
    if (customer.role !== 'customer') return send(403, { error: 'Customer access required' });
    const { rows } = await db.query(
      `SELECT ${fields} FROM delivery_orders WHERE customer_id=$1
       ORDER BY created_at DESC,id LIMIT 50`, [customer.id],
    );
    return send(200, { orders: rows });
  }
  if (request.method !== 'POST') return send(405, { error: 'Only POST is supported' });
  const account = await authenticatedAccount(request);
  const creating = path === '/orders';
  if (!account && (creating || request.headers.authorization)) return send(401, { error: 'Sign in required' });
  if (account && account.role !== 'customer') return send(403, { error: 'Customer access required' });

  const input = await readJson(request).catch(() => null);
  const pickup = point(input?.pickup);
  const dropoff = point(input?.dropoff);
  if (!pickup || !dropoff || (pickup.latitude === dropoff.latitude && pickup.longitude === dropoff.longitude)) {
    return send(400, { error: 'Provide distinct, valid pickup and drop-off coordinates' });
  }

  const offered = input?.offeredFareKobo;
  const paymentMethod = input?.paymentMethod;
  const key = request.headers['idempotency-key'];
  let requestHash = '';
  if (creating) {
    if (!account.phone_verified) return send(403, { error: 'Verify your phone before placing an order' });
    if (typeof key !== 'string' || !uuid.test(key) || typeof offered !== 'number' ||
        !Number.isInteger(offered) || offered <= 0 || offered > 2_147_483_647) {
      return send(400, { error: 'Provide a UUID Idempotency-Key and a positive offeredFareKobo' });
    }
    if (paymentMethod !== undefined && paymentMethod !== 'cash' && paymentMethod !== 'digital') {
      return send(400, { error: 'Payment method must be cash or digital' });
    }
    const details = [pickup, dropoff, offered];
    requestHash = createHash('sha256')
      .update(JSON.stringify(paymentMethod === undefined ? details : [...details, paymentMethod])).digest('hex');
    const { rows: [saved] } = await db.query(
      `SELECT ${fields}, request_hash FROM delivery_orders WHERE customer_id=$1 AND idempotency_key=$2`,
      [account.id, key],
    );
    if (saved) {
      const { request_hash, ...order } = saved;
      return request_hash === requestHash ? send(200, { order }) : conflict();
    }
  }

  const bucket = account ? `route:${account.id}` : `guest-route:${request.socket.remoteAddress ?? 'unknown'}`;
  if (await limited(bucket, account ? 60 : 15)) return send(429, { error: 'Too many quote requests' });
  let route: StreetRoute;
  try {
    route = await streetRoute(pickup, dropoff);
  } catch (error) {
    if (error instanceof NoStreetRoute) return send(422, { error: 'No street route found' });
    return send(503, { error: 'Street routing temporarily unavailable' });
  }
  const distanceMeters = route.meters;
  const fareFloorKobo = distanceMeters * fareFloorKoboPerMeter;
  if (!creating) {
    return send(200, { distanceMeters, fareFloorKobo, currency: 'NGN', ...(route.path.length ? { path: route.path } : {}) });
  }
  if ((offered as number) < fareFloorKobo) {
    return send(422, { error: 'Offer is below the route fare floor', fareFloorKobo });
  }

  const { rows: [saved] } = await db.query(
    `INSERT INTO delivery_orders
       (customer_id,idempotency_key,request_hash,pickup,dropoff,route_distance_meters,fare_floor_kobo,offered_fare_kobo,payment_method,pickup_label,dropoff_label,route_path)
     VALUES ($1,$2,$3,ST_SetSRID(ST_MakePoint($4,$5),4326)::geography,
       ST_SetSRID(ST_MakePoint($6,$7),4326)::geography,$8,$9,$10,$11,$12,$13,$14::jsonb)
     ON CONFLICT (customer_id,idempotency_key) DO NOTHING RETURNING ${fields}`,
    [account.id, key, requestHash, pickup.longitude, pickup.latitude, dropoff.longitude, dropoff.latitude,
      distanceMeters, fareFloorKobo, offered, paymentMethod ?? null, placeLabel(input?.pickupLabel), placeLabel(input?.dropoffLabel),
      route.path.length ? JSON.stringify(route.path) : null],
  );
  if (saved) return send(201, { order: saved });
  const { rows: [existing] } = await db.query(
    `SELECT ${fields}, request_hash FROM delivery_orders WHERE customer_id=$1 AND idempotency_key=$2`,
    [account.id, key],
  );
  const { request_hash, ...order } = existing;
  return request_hash === requestHash ? send(200, { order }) : conflict();
}
