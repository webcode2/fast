BEGIN;
CREATE TABLE IF NOT EXISTS trip_messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES delivery_orders(id),
  assignment_at timestamptz NOT NULL,
  sender_id uuid NOT NULL REFERENCES accounts(id),
  client_id uuid NOT NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  sent_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (order_id, assignment_at, sender_id, client_id)
);
CREATE INDEX IF NOT EXISTS trip_messages_history ON trip_messages (order_id, assignment_at, id DESC);

CREATE TABLE IF NOT EXISTS trip_calls (
  order_id uuid PRIMARY KEY REFERENCES delivery_orders(id),
  assignment_at timestamptz NOT NULL,
  id uuid NOT NULL UNIQUE,
  caller_id uuid NOT NULL REFERENCES accounts(id),
  offer text NOT NULL,
  answer text,
  expires_at timestamptz NOT NULL
);
CREATE OR REPLACE FUNCTION clear_ended_trip_call() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.assigned_at IS DISTINCT FROM OLD.assigned_at
     OR NEW.status NOT IN ('assigned','picked_up') THEN
    DELETE FROM trip_calls WHERE order_id=NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS clear_ended_trip_call ON delivery_orders;
CREATE TRIGGER clear_ended_trip_call AFTER UPDATE OF assigned_at,status ON delivery_orders
FOR EACH ROW EXECUTE FUNCTION clear_ended_trip_call();
COMMIT;
