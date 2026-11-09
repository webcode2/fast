BEGIN;
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE TABLE IF NOT EXISTS delivery_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES accounts(id),
  idempotency_key uuid NOT NULL,
  request_hash text NOT NULL,
  pickup geography(Point, 4326) NOT NULL,
  dropoff geography(Point, 4326) NOT NULL,
  route_distance_meters integer NOT NULL CHECK (route_distance_meters > 0),
  fare_floor_kobo integer NOT NULL CHECK (fare_floor_kobo > 0),
  offered_fare_kobo integer NOT NULL CHECK (offered_fare_kobo >= fare_floor_kobo),
  status text NOT NULL DEFAULT 'pending_dispatch',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, idempotency_key)
);
COMMIT;
