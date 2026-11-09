BEGIN;
ALTER TABLE delivery_orders
  ADD COLUMN IF NOT EXISTS pickup_label text CHECK (char_length(pickup_label) <= 160),
  ADD COLUMN IF NOT EXISTS dropoff_label text CHECK (char_length(dropoff_label) <= 160);
COMMIT;
