BEGIN;
ALTER TABLE delivery_orders
  ADD COLUMN IF NOT EXISTS tracking_received_at timestamptz,
  ADD COLUMN IF NOT EXISTS dropoff_wait_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS recovery_requested_at timestamptz;
CREATE TABLE IF NOT EXISTS trip_recovery_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES delivery_orders(id),
  rider_id uuid NOT NULL REFERENCES accounts(id),
  actor_id uuid NOT NULL REFERENCES accounts(id),
  reason text NOT NULL CHECK (reason IN ('rider_cancelled','replacement_requested','customer_unavailable')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trip_recovery_rider_reason_time
  ON trip_recovery_events (rider_id, reason, created_at);
COMMIT;
