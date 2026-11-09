BEGIN;
CREATE TABLE IF NOT EXISTS waitlist_signups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact text NOT NULL UNIQUE CHECK (char_length(contact) <= 254),
  contact_type text NOT NULL CHECK (contact_type IN ('phone', 'email')),
  role text NOT NULL CHECK (role IN ('customer', 'rider')),
  consented_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS waitlist_signups_newest ON waitlist_signups (consented_at DESC);
COMMIT;
