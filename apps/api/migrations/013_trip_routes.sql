BEGIN;
-- The road route agreed at booking. It stays fixed so the fare distance never moves.
ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS route_path jsonb;

-- The road route the rider is following now, from their position to the next stop.
CREATE TABLE IF NOT EXISTS trip_routes (
  order_id uuid PRIMARY KEY REFERENCES delivery_orders(id) ON DELETE CASCADE,
  rider_id uuid NOT NULL,
  target text NOT NULL CHECK (target IN ('pickup', 'dropoff')),
  path jsonb NOT NULL,
  distance_meters integer NOT NULL CHECK (distance_meters >= 0),
  off_route_samples integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Live routes reveal rider movement, so they end with the assignment.
CREATE OR REPLACE FUNCTION clear_ended_trip_route() RETURNS trigger AS $$
BEGIN
  IF NEW.status NOT IN ('assigned', 'picked_up') OR NEW.assigned_rider_id IS DISTINCT FROM OLD.assigned_rider_id THEN
    DELETE FROM trip_routes WHERE order_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS clear_ended_trip_route ON delivery_orders;
CREATE TRIGGER clear_ended_trip_route AFTER UPDATE OF status, assigned_rider_id ON delivery_orders
  FOR EACH ROW EXECUTE FUNCTION clear_ended_trip_route();
COMMIT;
