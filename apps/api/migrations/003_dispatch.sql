BEGIN;
ALTER TABLE delivery_orders
  ADD COLUMN IF NOT EXISTS bidding_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS assigned_rider_id uuid REFERENCES accounts(id),
  ADD COLUMN IF NOT EXISTS agreed_fare_kobo integer CHECK (agreed_fare_kobo >= fare_floor_kobo),
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz;
UPDATE delivery_orders SET bidding_expires_at = created_at + interval '60 seconds'
WHERE bidding_expires_at IS NULL;
ALTER TABLE delivery_orders
  ALTER COLUMN bidding_expires_at SET DEFAULT (clock_timestamp() + interval '60 seconds'),
  ALTER COLUMN bidding_expires_at SET NOT NULL;
CREATE INDEX IF NOT EXISTS delivery_orders_open_pickup
  ON delivery_orders USING gist (pickup) WHERE status = 'pending_dispatch';
CREATE UNIQUE INDEX IF NOT EXISTS delivery_orders_one_assigned_per_rider
  ON delivery_orders (assigned_rider_id) WHERE status = 'assigned';

CREATE TABLE IF NOT EXISTS rider_dispatch (
  rider_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  identity_verified_at timestamptz,
  available boolean NOT NULL DEFAULT false,
  location geography(Point, 4326),
  location_at timestamptz
);
CREATE TABLE IF NOT EXISTS rider_identity_reviews (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rider_id uuid NOT NULL REFERENCES accounts(id),
  admin_id uuid NOT NULL REFERENCES accounts(id),
  approved boolean NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS delivery_bids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES delivery_orders(id) ON DELETE CASCADE,
  rider_id uuid NOT NULL REFERENCES accounts(id),
  fare_kobo integer NOT NULL CHECK (fare_kobo > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, rider_id)
);
COMMIT;
