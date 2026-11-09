#!/usr/bin/env bash
set -euo pipefail

db="fastlogistics_seed_$(date +%s)_$$"
postgres=(docker compose exec -T postgres)
dump=$(mktemp)
trap 'rm -f "$dump"' EXIT
"${postgres[@]}" createdb -U fastlogistics -T template0 "$db"
trap 'rm -f "$dump"; "${postgres[@]}" dropdb -U fastlogistics "$db"' EXIT

sql=("${postgres[@]}" psql -X -q -v ON_ERROR_STOP=1 -U fastlogistics -d "$db")
for migration in apps/api/migrations/*.sql; do
  "${sql[@]}" < "$migration"
done

"${sql[@]}" <<'SQL'
INSERT INTO accounts (role,email,phone,password_hash) VALUES
  ('customer','backup-customer@example.test','+2348000000001','unusable'),
  ('rider','backup-rider@example.test','+2348000000002','unusable'),
  ('customer','backup-archived@example.test','+2348000000003','unusable');

INSERT INTO delivery_orders
  (customer_id,idempotency_key,request_hash,pickup,dropoff,route_distance_meters,fare_floor_kobo,offered_fare_kobo)
SELECT id,gen_random_uuid(),'backup-drill','SRID=4326;POINT(7 4.8)','SRID=4326;POINT(7.01 4.81)',1800,27000,30000
FROM accounts WHERE email='backup-customer@example.test';

INSERT INTO trip_payments (order_id,rider_id,reference,amount_kobo,commission_kobo)
SELECT o.id,a.id,'backup-payment',30000,3000 FROM delivery_orders o
CROSS JOIN accounts a WHERE a.role='rider';
INSERT INTO payment_ledger (order_id,kind,amount_kobo)
SELECT order_id,'collection',amount_kobo FROM trip_payments;

INSERT INTO account_archives (account_id,purge_at,encrypted_data)
SELECT id,now()+interval '120 days',pgp_sym_encrypt('{"name":"Archived Customer"}','disposable-test-key')
FROM accounts WHERE email='backup-archived@example.test';

INSERT INTO rider_identity_checks (rider_id,kind,provider_user_id,expires_at)
SELECT id,'nin','backup-rider-nin',now()+interval '1 day' FROM accounts WHERE role='rider';
SQL

"${postgres[@]}" pg_dump -U fastlogistics -Fc "$db" > "$dump"
result=$(bash scripts/check-postgres-backup.sh "$dump")
printf '%s\n' "$result"
for expected in 'accounts|3' 'delivery_orders|1' 'payment_ledger|1' 'account_archives|1' 'rider_identity_checks|1'; do
  grep -Fxq "$expected" <<< "$result"
done
printf 'All seeded relation counts matched after restore.\n'
