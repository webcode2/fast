import { createHash } from 'node:crypto';
import { db } from './auth.ts';

export function archiveKey() {
  const key = process.env.ACCOUNT_ARCHIVE_KEY;
  if (!key || !/^[a-f0-9]{64}$/i.test(key)) throw new Error('Set ACCOUNT_ARCHIVE_KEY to 32 random bytes in hex');
  return key;
}

export async function maintainAccounts() {
  // Purge remains available if an archive key is temporarily unavailable.
  const purged = await db.query('DELETE FROM account_archives WHERE purge_at<=clock_timestamp()');
  const key = archiveKey();
  const client = await db.connect();
  let archived = 0;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id,email FROM accounts WHERE deleted_at<=clock_timestamp()-interval '720 hours'
         AND archived_at IS NULL ORDER BY deleted_at,id LIMIT 25 FOR UPDATE SKIP LOCKED`,
    );
    for (const { id, email } of rows) {
      await client.query(
        `INSERT INTO account_archives (account_id,purge_at,encrypted_data)
         SELECT a.id,a.deleted_at+interval '3600 hours',pgp_sym_encrypt(
           jsonb_build_object('accountId',a.id,'email',a.email,'phone',a.phone,
             'accountType',a.role,'emailVerified',a.email_verified,'phoneVerified',a.phone_verified,
             'profile',(SELECT to_jsonb(p)-'account_id' FROM account_profiles p WHERE p.account_id=a.id),
             'identityChecks',COALESCE((SELECT jsonb_agg(jsonb_build_object(
               'kind',c.kind,'status',c.status,'updatedAt',c.updated_at))
               FROM rider_identity_checks c WHERE c.rider_id=a.id),'[]'::jsonb),
             'messages',COALESCE((SELECT jsonb_agg(to_jsonb(m)-'sender_id') FROM trip_messages m WHERE m.sender_id=a.id),'[]'::jsonb),
             'reviews',COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM trip_reviews r
               JOIN delivery_orders o ON o.id=r.order_id WHERE o.customer_id=a.id),'[]'::jsonb),
             'riderReports',COALESCE((SELECT jsonb_agg(to_jsonb(i)-'resolved_by') FROM trip_issues i
               WHERE i.reporter_id=a.id),'[]'::jsonb),
             'reports',COALESCE((SELECT jsonb_agg(to_jsonb(d)-'resolved_by') FROM trip_disputes d
               JOIN delivery_orders o ON o.id=d.order_id WHERE o.customer_id=a.id),'[]'::jsonb),
             'deliveryLocations',COALESCE((SELECT jsonb_agg(jsonb_build_object('orderId',o.id,
               'pickup',ST_AsGeoJSON(o.pickup)::jsonb,'dropoff',ST_AsGeoJSON(o.dropoff)::jsonb,
               'pickupLabel',o.pickup_label,'dropoffLabel',o.dropoff_label,'routePath',o.route_path))
               FROM delivery_orders o WHERE o.customer_id=a.id),'[]'::jsonb))::text,$2,'cipher-algo=aes256')
         FROM accounts a WHERE a.id=$1 AND a.deleted_at+interval '3600 hours'>clock_timestamp()`, [id, key],
      );
      // Messages from either side of the account's trips can contain its addresses.
      await client.query(
        `DELETE FROM trip_messages WHERE sender_id=$1 OR order_id IN
           (SELECT id FROM delivery_orders WHERE customer_id=$1 OR assigned_rider_id=$1)`, [id],
      );
      await client.query(
        `UPDATE trip_issues SET details='Removed with account' WHERE details<>'' AND (reporter_id=$1 OR order_id IN
           (SELECT id FROM delivery_orders WHERE customer_id=$1))`, [id],
      );
      await client.query(
        "UPDATE trip_reviews r SET comment='' FROM delivery_orders o WHERE o.id=r.order_id AND o.customer_id=$1", [id],
      );
      await client.query(
        `UPDATE trip_disputes d SET details='Removed with account',
           resolution=CASE WHEN resolution IS NOT NULL THEN 'Removed with account' END
         FROM delivery_orders o WHERE o.id=d.order_id AND o.customer_id=$1`, [id],
      );
      await client.query(
        `UPDATE trip_payments p SET checkout_url=NULL FROM delivery_orders o
         WHERE o.id=p.order_id AND o.customer_id=$1`, [id],
      );
      await client.query('UPDATE delivery_orders SET pickup=NULL,dropoff=NULL,pickup_label=NULL,dropoff_label=NULL,route_path=NULL WHERE customer_id=$1', [id]);
      await client.query('DELETE FROM payout_recipients WHERE rider_id=$1', [id]);
      await client.query('UPDATE payment_operations SET recipient_code=$2,destination_code=$2 WHERE order_id IN (SELECT order_id FROM trip_payments WHERE rider_id=$1) AND kind=$3', [id, 'archived', 'payout']);
      await client.query('DELETE FROM rider_identity_checks WHERE rider_id=$1', [id]);
      await client.query('DELETE FROM rider_dispatch WHERE rider_id=$1', [id]);
      await client.query('DELETE FROM account_profiles WHERE account_id=$1', [id]);
      await client.query('DELETE FROM auth_sessions WHERE account_id=$1', [id]);
      await client.query('DELETE FROM auth_codes WHERE account_id=$1', [id]);
      const emailHash = createHash('sha256').update(email ?? '').digest('hex');
      await client.query(
        "DELETE FROM auth_limits WHERE bucket LIKE '%:' || $1::text OR bucket LIKE '%:' || $1::text || ':%' OR bucket LIKE '%:' || $2",
        [id, emailHash],
      );
      await client.query(
        `UPDATE accounts SET email=NULL,phone=NULL,password_hash=NULL,email_verified=false,
           phone_verified=false,archived_at=clock_timestamp() WHERE id=$1`, [id],
      );
      archived++;
    }
    await client.query('COMMIT');
  } finally {
    try { await client.query('ROLLBACK'); } finally { client.release(); }
  }
  return { archived, purged: purged.rowCount ?? 0 };
}
