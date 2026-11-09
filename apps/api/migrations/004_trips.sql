BEGIN;
ALTER TABLE delivery_orders
  ADD COLUMN IF NOT EXISTS picked_up_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS rider_location geography(Point, 4326),
  ADD COLUMN IF NOT EXISTS rider_location_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS delivery_orders_one_active_per_rider
  ON delivery_orders (assigned_rider_id) WHERE status IN ('assigned', 'picked_up');
DROP INDEX IF EXISTS delivery_orders_one_assigned_per_rider;
COMMIT;
