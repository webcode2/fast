BEGIN;
CREATE TABLE IF NOT EXISTS payout_recipients (
  rider_id uuid PRIMARY KEY REFERENCES accounts(id),
  recipient_code text NOT NULL,
  destination_code text NOT NULL
);
CREATE TABLE IF NOT EXISTS trip_payments (
  order_id uuid PRIMARY KEY REFERENCES delivery_orders(id),
  rider_id uuid NOT NULL REFERENCES accounts(id),
  reference text UNIQUE NOT NULL,
  amount_kobo integer NOT NULL CHECK (amount_kobo>0),
  commission_kobo integer NOT NULL CHECK (commission_kobo>=0 AND commission_kobo<amount_kobo),
  checkout_url text,
  checkout_id text UNIQUE,
  charge_id text UNIQUE,
  collected_at timestamptz
);
CREATE TABLE IF NOT EXISTS payment_operations (
  order_id uuid NOT NULL REFERENCES trip_payments(order_id),
  kind text NOT NULL CHECK (kind IN ('payout','refund')),
  reference text UNIQUE NOT NULL,
  amount_kobo integer NOT NULL CHECK (amount_kobo>0),
  recipient_code text,
  destination_code text,
  transfer_id text,
  transfer_started_at timestamptz,
  transfer_key_hash text,
  provider_id text,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','succeeded','needs_review')),
  last_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  settled_at timestamptz,
  PRIMARY KEY (order_id,kind),
  CHECK ((kind='payout')=(recipient_code IS NOT NULL AND destination_code IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS payment_ledger (
  order_id uuid NOT NULL REFERENCES trip_payments(order_id),
  kind text NOT NULL CHECK (kind IN ('collection','commission','rider_earnings','payout','refund',
    'commission_reversal','earnings_reversal','rider_credit','rider_recovery_due')),
  amount_kobo integer NOT NULL CHECK (amount_kobo>=0),
  posted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (order_id,kind)
);
CREATE OR REPLACE FUNCTION lock_trip_dispute_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM delivery_orders WHERE id=NEW.order_id FOR UPDATE;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS lock_trip_dispute_order ON trip_disputes;
CREATE TRIGGER lock_trip_dispute_order BEFORE INSERT ON trip_disputes
FOR EACH ROW EXECUTE FUNCTION lock_trip_dispute_order();
COMMIT;
