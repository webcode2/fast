BEGIN;
CREATE TABLE IF NOT EXISTS rider_identity_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('nin','licence')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','clear','block','attention','error')),
  provider_user_id text UNIQUE NOT NULL,
  provider_job_id text UNIQUE,
  provider_link_id uuid UNIQUE,
  verification_url text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS rider_identity_checks_latest
  ON rider_identity_checks(rider_id,kind,created_at DESC,id DESC);
COMMIT;
