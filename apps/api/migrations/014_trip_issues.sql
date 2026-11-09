BEGIN;
CREATE TABLE IF NOT EXISTS trip_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES delivery_orders(id) ON DELETE CASCADE,
  reporter_id uuid NOT NULL REFERENCES accounts(id),
  category text NOT NULL CHECK (category IN
    ('safety','customer_unreachable','wrong_address','parcel_problem','payment_problem','other')),
  details text NOT NULL DEFAULT '' CHECK (char_length(details) <= 1000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES accounts(id)
);
CREATE INDEX IF NOT EXISTS trip_issues_open ON trip_issues (created_at) WHERE resolved_at IS NULL;
COMMIT;
