BEGIN;
CREATE TABLE IF NOT EXISTS trip_reviews (
  order_id uuid PRIMARY KEY REFERENCES delivery_orders(id),
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text NOT NULL CHECK (char_length(comment) <= 1000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS trip_disputes (
  order_id uuid PRIMARY KEY REFERENCES delivery_orders(id),
  details text NOT NULL CHECK (char_length(details) BETWEEN 1 AND 2000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','upheld','dismissed')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES accounts(id),
  resolution text CHECK (char_length(resolution) BETWEEN 1 AND 1000),
  CHECK ((status='open' AND resolved_at IS NULL AND resolved_by IS NULL AND resolution IS NULL)
    OR (status<>'open' AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND resolution IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS trip_disputes_open ON trip_disputes (created_at, order_id) WHERE status='open';
COMMIT;
