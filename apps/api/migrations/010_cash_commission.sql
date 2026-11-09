BEGIN;
ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS payment_method text
  CHECK (payment_method IN ('cash','digital'));
CREATE TABLE IF NOT EXISTS cash_commission_repayments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id uuid NOT NULL REFERENCES accounts(id),
  amount_kobo bigint NOT NULL CHECK (amount_kobo>0),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','paid','expired')),
  checkout_id text UNIQUE,
  checkout_started_at timestamptz,
  checkout_url text,
  checkout_expires_at timestamptz,
  charge_id text UNIQUE,
  external_reference text UNIQUE,
  recorded_by uuid REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  paid_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS cash_commission_one_pending
  ON cash_commission_repayments(rider_id) WHERE state='pending';

CREATE TABLE IF NOT EXISTS cash_commissions (
  order_id uuid PRIMARY KEY REFERENCES delivery_orders(id),
  rider_id uuid NOT NULL REFERENCES accounts(id),
  amount_kobo integer NOT NULL CHECK (amount_kobo>0),
  business_date date NOT NULL,
  due_at timestamptz NOT NULL,
  paid_at timestamptz,
  repayment_id uuid REFERENCES cash_commission_repayments(id)
);
CREATE INDEX IF NOT EXISTS cash_commission_overdue
  ON cash_commissions(rider_id,due_at) WHERE paid_at IS NULL;

CREATE TABLE IF NOT EXISTS cash_commission_repayment_items (
  repayment_id uuid NOT NULL REFERENCES cash_commission_repayments(id),
  order_id uuid NOT NULL REFERENCES cash_commissions(order_id),
  PRIMARY KEY (repayment_id,order_id)
);
COMMIT;
