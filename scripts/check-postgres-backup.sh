#!/usr/bin/env bash
set -euo pipefail

if [[ $# != 1 || ! -s $1 ]]; then
  printf 'Usage: bash scripts/check-postgres-backup.sh BACKUP.dump\n' >&2
  exit 2
fi

# Use the local Compose cluster and a fresh database, leaving the source alone.
db="fastlogistics_restore_$(date +%s)_$$"
postgres=(docker compose exec -T postgres)
"${postgres[@]}" createdb -U fastlogistics -T template0 "$db"
trap '"${postgres[@]}" dropdb -U fastlogistics "$db"' EXIT

"${postgres[@]}" pg_restore -U fastlogistics -d "$db" \
  --single-transaction --no-owner --no-privileges < "$1"

"${postgres[@]}" psql -X -At -v ON_ERROR_STOP=1 -U fastlogistics -d "$db" <<'SQL'
SELECT PostGIS_Version(), ST_Distance(
  ST_SetSRID(ST_MakePoint(7.00, 4.80), 4326)::geography,
  ST_SetSRID(ST_MakePoint(7.01, 4.81), 4326)::geography
) AS distance_metres;
SELECT 'accounts' AS relation, count(*) FROM accounts
UNION ALL SELECT 'delivery_orders', count(*) FROM delivery_orders
UNION ALL SELECT 'payment_ledger', count(*) FROM payment_ledger
UNION ALL SELECT 'account_archives', count(*) FROM account_archives
UNION ALL SELECT 'rider_identity_checks', count(*) FROM rider_identity_checks;
SQL
