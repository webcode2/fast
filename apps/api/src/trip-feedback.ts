import { hasStaffPermission } from './staff.ts';
import type { IncomingMessage } from 'node:http';
import { authenticatedAccount, db, readJson } from './auth.ts';
import { uuid } from './orders.ts';

const send = (status: number, body: object) => ({ status, body });
const missing = () => send(404, { error: 'Completed trip not found' });
const reviewFields = 'rating, comment, created_at AS "createdAt"';
const disputeFields = 'details, status, resolution, created_at AS "createdAt", resolved_at AS "resolvedAt"';

function text(value: unknown, max: number) {
  if (typeof value !== 'string' || value.length > max || value.includes('\0')) return;
  return value.trim();
}

export async function tripFeedback(request: IncomingMessage, path: string) {
  const user = await authenticatedAccount(request);
  if (!user) return send(401, { error: 'Sign in required' });
  const method = request.method;

  if (path.startsWith('/admin/disputes')) {
    if (!await hasStaffPermission(user, 'dispute_resolver')) {
      return send(403, { error: 'Verified admin access required' });
    }
    if (path === '/admin/disputes' && method === 'GET') {
      const { rows } = await db.query(
        `SELECT d.order_id AS "orderId", d.details, d.created_at AS "createdAt",
           o.customer_id AS "customerId", o.assigned_rider_id AS "riderId",
           o.completed_at AS "completedAt", o.agreed_fare_kobo AS "agreedFareKobo"
         FROM trip_disputes d JOIN delivery_orders o ON o.id=d.order_id
         WHERE d.status='open' ORDER BY d.created_at, d.order_id LIMIT 100`,
      );
      return send(200, { disputes: rows });
    }
    const [, id] = path.match(/^\/admin\/disputes\/([^/]+)\/resolve$/) ?? [];
    if (!id || !uuid.test(id) || method !== 'POST') return send(404, { error: 'Route not found' });
    const input = await readJson(request).catch(() => null);
    const decision = input?.decision;
    const resolution = text(input?.resolution, 1000);
    if ((decision !== 'upheld' && decision !== 'dismissed') || !resolution) {
      return send(400, { error: 'Provide a decision and a resolution summary' });
    }
    const { rows: [dispute] } = await db.query(
      `UPDATE trip_disputes SET status=$2, resolution=$3, resolved_by=$4, resolved_at=clock_timestamp()
       WHERE order_id=$1 AND status='open' RETURNING ${disputeFields}`,
      [id, decision, resolution, user.id],
    );
    if (dispute) return send(200, { dispute });
    const { rows: [saved] } = await db.query(
      `SELECT ${disputeFields}, resolved_by FROM trip_disputes WHERE order_id=$1`, [id],
    );
    if (!saved) return send(404, { error: 'Dispute not found' });
    const { resolved_by, ...existing } = saved;
    return resolved_by === user.id && existing.status === decision && existing.resolution === resolution
      ? send(200, { dispute: existing }) : send(409, { error: 'Dispute already resolved' });
  }

  if (user.role !== 'customer') return send(403, { error: 'Customer access required' });
  if (path === '/trips/feedback' && method === 'GET') {
    const { rows } = await db.query(
      `SELECT o.id, o.completed_at AS "completedAt", r.rating, d.status AS "disputeStatus"
       FROM delivery_orders o LEFT JOIN trip_reviews r ON r.order_id=o.id
       LEFT JOIN trip_disputes d ON d.order_id=o.id
       WHERE o.customer_id=$1 AND o.status='completed'
       ORDER BY o.completed_at DESC, o.id LIMIT 50`, [user.id],
    );
    return send(200, { trips: rows });
  }

  const [, id, action] = path.match(/^\/trips\/([^/]+)\/(feedback|review|dispute)$/) ?? [];
  if (!id || !uuid.test(id)) return missing();
  const ownership = "id=$1 AND customer_id=$2 AND status='completed'";
  if (method === 'GET' && action === 'feedback') {
    const { rows: [feedback] } = await db.query(
      `SELECT completed_at AS "completedAt",
         (SELECT row_to_json(r) FROM (SELECT ${reviewFields} FROM trip_reviews WHERE order_id=o.id) r) AS review,
         (SELECT row_to_json(d) FROM (SELECT ${disputeFields} FROM trip_disputes WHERE order_id=o.id) d) AS dispute
       FROM delivery_orders o WHERE ${ownership}`, [id, user.id],
    );
    return feedback ? send(200, feedback) : missing();
  }
  if (method !== 'POST' || action === 'feedback') return send(405, { error: 'Method not supported' });
  const input = await readJson(request).catch(() => null);
  if (action === 'review') {
    const rating = input?.rating;
    const comment = text(input?.comment ?? '', 1000);
    if (typeof rating !== 'number' || !Number.isInteger(rating) || rating < 1 || rating > 5 || comment === undefined) {
      return send(400, { error: 'Choose a rating from 1 to 5 and keep comments within 1000 characters' });
    }
    const { rows: [review] } = await db.query(
      `INSERT INTO trip_reviews (order_id,rating,comment)
       SELECT id,$3,$4 FROM delivery_orders WHERE ${ownership}
       ON CONFLICT (order_id) DO UPDATE SET rating=trip_reviews.rating
         WHERE trip_reviews.rating=excluded.rating AND trip_reviews.comment=excluded.comment
       RETURNING ${reviewFields}`, [id, user.id, rating, comment],
    );
    if (review) return send(200, { review });
  } else {
    const details = text(input?.details, 2000);
    if (!details) return send(400, { error: 'Describe what happened in up to 2000 characters' });
    const { rows: [dispute] } = await db.query(
      `INSERT INTO trip_disputes (order_id,details)
       SELECT id,$3 FROM delivery_orders WHERE ${ownership}
       ON CONFLICT (order_id) DO UPDATE SET details=trip_disputes.details
         WHERE trip_disputes.details=excluded.details
       RETURNING ${disputeFields}`, [id, user.id, details],
    );
    if (dispute) return send(200, { dispute });
  }
  const existing = await db.query(`SELECT 1 FROM delivery_orders WHERE ${ownership}`, [id, user.id]);
  return existing.rowCount ? send(409, { error: 'Feedback already submitted for this trip' }) : missing();
}
