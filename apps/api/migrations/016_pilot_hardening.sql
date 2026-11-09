BEGIN;
-- One active device per account. Keep the newest session for anyone with several.
DELETE FROM auth_sessions a USING auth_sessions b
  WHERE a.account_id = b.account_id AND (a.expires_at, a.token_hash) < (b.expires_at, b.token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS auth_sessions_one_device ON auth_sessions (account_id);

-- Existing accounts count from now, so nobody is cleaned up by surprise.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT clock_timestamp();

ALTER TABLE trip_payments
  ADD COLUMN IF NOT EXISTS checkout_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_reconciled_at timestamptz;

-- False means the rider ended the trip without recent GPS near the drop-off.
ALTER TABLE delivery_orders
  ADD COLUMN IF NOT EXISTS completed_near_dropoff boolean,
  ADD COLUMN IF NOT EXISTS payout_released_at timestamptz,
  ADD COLUMN IF NOT EXISTS payout_released_by uuid REFERENCES accounts(id);

-- Orders without a method skipped both card checkout and cash commission.
UPDATE delivery_orders o SET payment_method =
    CASE WHEN EXISTS (SELECT 1 FROM trip_payments p WHERE p.order_id = o.id) THEN 'digital' ELSE 'cash' END
  WHERE payment_method IS NULL;
ALTER TABLE delivery_orders ALTER COLUMN payment_method SET NOT NULL;

ALTER TABLE trip_recovery_events DROP CONSTRAINT IF EXISTS trip_recovery_events_reason_check;
ALTER TABLE trip_recovery_events ADD CONSTRAINT trip_recovery_events_reason_check CHECK (reason IN
  ('rider_cancelled','replacement_requested','customer_unavailable','staff_reopened','staff_cancelled','staff_completed'));

CREATE TABLE IF NOT EXISTS worker_heartbeats (
  worker text PRIMARY KEY,
  beat_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_failed_at timestamptz
);
COMMIT;
