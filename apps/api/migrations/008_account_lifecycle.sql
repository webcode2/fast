BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_role_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_role_check CHECK (role IN ('customer','rider','admin','staff'));
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ALTER COLUMN email DROP NOT NULL,
  ALTER COLUMN phone DROP NOT NULL,
  ALTER COLUMN password_hash DROP NOT NULL;
CREATE INDEX IF NOT EXISTS accounts_pending_archive ON accounts (deleted_at)
  WHERE deleted_at IS NOT NULL AND archived_at IS NULL;

CREATE TABLE IF NOT EXISTS account_profiles (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  account_type text NOT NULL CHECK (account_type IN ('customer','rider','admin','staff')),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 100)
);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='accounts' AND column_name='name'
      AND table_schema=current_schema()) THEN
    INSERT INTO account_profiles SELECT id,role,name FROM accounts ON CONFLICT DO NOTHING;
    ALTER TABLE accounts DROP COLUMN name;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS staff_role_assignments (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('administrator','staff_manager','archive_exporter',
    'dispute_resolver','rider_verifier','recovery_operator')),
  assigned_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (account_id,role)
);
INSERT INTO staff_role_assignments (account_id,role)
SELECT id,'administrator' FROM accounts WHERE role='admin' ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS staff_role_changes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES accounts(id),
  staff_id uuid NOT NULL REFERENCES accounts(id),
  previous_roles text[] NOT NULL,
  new_roles text[] NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS account_archives (
  account_id uuid PRIMARY KEY REFERENCES accounts(id),
  archived_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  purge_at timestamptz NOT NULL,
  encrypted_data bytea NOT NULL
);
CREATE INDEX IF NOT EXISTS account_archives_due ON account_archives(purge_at);
CREATE TABLE IF NOT EXISTS account_archive_exports (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  actor_id uuid NOT NULL REFERENCES accounts(id),
  exported_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE delivery_orders ALTER COLUMN pickup DROP NOT NULL, ALTER COLUMN dropoff DROP NOT NULL;
CREATE OR REPLACE FUNCTION require_live_order_customer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM accounts WHERE id=NEW.customer_id AND role='customer' AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Customer account unavailable'; END IF;
  IF NEW.pickup IS NULL OR NEW.dropoff IS NULL THEN RAISE EXCEPTION 'Order locations required'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS require_live_order_customer ON delivery_orders;
CREATE TRIGGER require_live_order_customer BEFORE INSERT ON delivery_orders
FOR EACH ROW EXECUTE FUNCTION require_live_order_customer();
COMMIT;
