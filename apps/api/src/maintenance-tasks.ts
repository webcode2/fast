import { db } from './auth.ts';
import { describeError } from './runtime.ts';

const batch = 500;
const unverifiedDays = 7;

/** Records that a worker ran, so a stopped worker is visible to staff. */
export async function heartbeat(worker: string, failed = false) {
  await db.query(
    `INSERT INTO worker_heartbeats (worker,last_failed_at) VALUES ($1,CASE WHEN $2 THEN clock_timestamp() END)
     ON CONFLICT (worker) DO UPDATE SET beat_at=clock_timestamp(),
       last_failed_at=CASE WHEN $2 THEN clock_timestamp() ELSE worker_heartbeats.last_failed_at END`,
    [worker, failed],
  ).catch((error) => console.error(`Worker heartbeat failed: ${describeError(error)}`));
}

/** Moves overdue orders out of the live dispatch index, which riders poll constantly. */
export async function expireOverdueOrders() {
  const { rowCount } = await db.query(
    `UPDATE delivery_orders SET status='expired' WHERE id IN (
       SELECT id FROM delivery_orders WHERE status='pending_dispatch' AND bidding_expires_at<=clock_timestamp()
       LIMIT ${batch})`,
  );
  return rowCount ?? 0;
}

export async function purgeExpiredAuthRows() {
  await db.query('DELETE FROM auth_sessions WHERE expires_at<=now()');
  await db.query('DELETE FROM auth_codes WHERE expires_at<=now()');
  await db.query('DELETE FROM auth_limits WHERE expires_at<=now()');
}

/**
 * Frees emails and phones held by accounts nobody ever verified. Registration
 * accepts any contact details, so these may belong to someone else.
 */
export async function removeUnverifiedAccounts() {
  const { rowCount } = await db.query(
    `DELETE FROM accounts a WHERE a.id IN (
       SELECT id FROM accounts WHERE role IN ('customer','rider') AND NOT email_verified AND NOT phone_verified
         AND deleted_at IS NULL AND archived_at IS NULL AND created_at<clock_timestamp()-interval '${unverifiedDays} days'
       LIMIT ${batch})
       AND NOT EXISTS (SELECT 1 FROM delivery_orders o WHERE o.customer_id=a.id OR o.assigned_rider_id=a.id)
       AND NOT EXISTS (SELECT 1 FROM rider_identity_checks c WHERE c.rider_id=a.id)`,
  );
  return rowCount ?? 0;
}
