import type { IncomingMessage } from 'node:http';
import { authenticatedAccount, db, limited, readJson } from './auth.ts';
import { uuid } from './orders.ts';
import { hasStaffPermission } from './staff.ts';

const categories = ['safety', 'customer_unreachable', 'wrong_address', 'parcel_problem', 'payment_problem', 'other'];
const maxDetails = 1000;
const hourlyLimitPerRider = 10;
const send = (status: number, body: object) => ({ status, body });

export async function reportTripIssue(request: IncomingMessage, orderId: string, riderId: string) {
  const input = await readJson(request).catch(() => null);
  const category = input?.category;
  const details = typeof input?.details === 'string' ? input.details.trim() : '';
  if (!categories.includes(category) || details.length > maxDetails || (category === 'other' && !details)) {
    return send(400, { error: 'Choose a problem type and describe it in up to 1000 characters' });
  }
  if (await limited(`trip-issue:${riderId}`, hourlyLimitPerRider)) {
    return send(429, { error: 'Too many reports. Try again later' });
  }
  const { rows: [issue] } = await db.query(
    `INSERT INTO trip_issues (order_id,reporter_id,category,details)
     SELECT id,$2,$3,$4 FROM delivery_orders WHERE id=$1 AND assigned_rider_id=$2 RETURNING id`,
    [orderId, riderId, category, details],
  );
  return issue ? send(201, { issue }) : send(404, { error: 'Trip not found' });
}

export async function staffTripIssues(request: IncomingMessage, path: string) {
  const staff = await authenticatedAccount(request);
  if (!staff) return send(401, { error: 'Sign in required' });
  if (!await hasStaffPermission(staff, 'recovery_operator')) {
    return send(403, { error: 'Verified admin access required' });
  }
  if (path === '/trips/issues' && request.method === 'GET') {
    // Safety reports always come first.
    const { rows } = await db.query(
      `SELECT id, order_id AS "orderId", reporter_id AS "riderId", category, details, created_at AS "createdAt"
       FROM trip_issues WHERE resolved_at IS NULL
       ORDER BY category='safety' DESC, created_at, id LIMIT 100`,
    );
    return send(200, { issues: rows });
  }
  const id = path.match(/^\/trips\/issues\/([^/]+)\/resolve$/)?.[1];
  if (!id || !uuid.test(id) || request.method !== 'POST') return send(404, { error: 'Route not found' });
  const { rowCount } = await db.query(
    'UPDATE trip_issues SET resolved_at=clock_timestamp(), resolved_by=$2 WHERE id=$1 AND resolved_at IS NULL',
    [id, staff.id],
  );
  return rowCount ? send(200, { ok: true }) : send(409, { error: 'Report is already resolved or was not found' });
}
