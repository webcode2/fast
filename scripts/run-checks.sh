#!/usr/bin/env bash
# Runs each API integration check against its own fresh database.
# Usage: ADMIN_DATABASE_URL=postgresql://user:pass@host:port/postgres scripts/run-checks.sh [check ...]
set -uo pipefail
cd "$(dirname "$0")/.."
: "${ADMIN_DATABASE_URL:?Set ADMIN_DATABASE_URL to a server you can create test databases on}"
export REDIS_URL="${REDIS_URL:-redis://127.0.0.1:16379}"
export AUTH_CODE_SECRET="${AUTH_CODE_SECRET:-$(openssl rand -hex 32)}"
export ACCOUNT_ARCHIVE_KEY="${ACCOUNT_ARCHIVE_KEY:-$(openssl rand -hex 32)}"
export AUTH_DEV_CODES=1

checks=("$@")
if [ ${#checks[@]} -eq 0 ]; then checks=(auth orders dispatch trip-route payments accounts rider-identity trip-realtime waitlist maintenance); fi

failed=()
for check in "${checks[@]}"; do
  name="fl_check_$(echo "$check" | tr '-' '_')"
  base="${ADMIN_DATABASE_URL%/*}"
  node --input-type=module -e "
    import pg from 'pg';
    const c = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL });
    await c.connect();
    await c.query('DROP DATABASE IF EXISTS $name WITH (FORCE)');
    await c.query('CREATE DATABASE $name');
    await c.end();" || { failed+=("$check"); continue; }
  args=()
  [ "$check" = orders ] && args=(cache)
  if DATABASE_URL="$base/$name" node apps/api/src/migrate.ts >/dev/null \
    && DATABASE_URL="$base/$name" timeout 300 node "apps/api/checks/$check.ts" "${args[@]}"; then
    echo "PASS $check"
  else
    echo "FAIL $check"
    failed+=("$check")
  fi
  node --input-type=module -e "
    import pg from 'pg';
    const c = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL });
    await c.connect();
    await c.query('DROP DATABASE IF EXISTS $name WITH (FORCE)');
    await c.end();" || true
done

if [ ${#failed[@]} -gt 0 ]; then
  echo "Failed: ${failed[*]}"
  exit 1
fi
echo "All checks passed"
