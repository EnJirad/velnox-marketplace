#!/usr/bin/env bash
# ============================================================================
# VELNOX MVP — guarded development / test database reset
# ============================================================================
# USAGE
#   scripts/db-reset.sh --database-url postgresql://user:pass@host:5432/velnox_dev
#   VELNOX_RESET_DATABASE_URL=... scripts/db-reset.sh
#   scripts/db-reset.sh --database-url ... --seed
#
# WHAT IT DOES
#   Installs the canonical MVP schema (db/schema.sql) into the database you name
#   explicitly, then optionally applies scripts/db-seed.sql (platform categories
#   only). Every statement is idempotent, so re-running is safe. It never reads
#   DATABASE_URL, so a production URL sitting in the shell cannot be used by
#   accident. Nothing here drops or deletes: to rebuild a development database
#   from scratch, drop it yourself and run this script.
#
# WHAT IT REFUSES (fail closed, no fallback)
#   * no explicit URL
#   * a URL equal to DATABASE_URL
#   * a database name that does not end in _dev or _test
#   * a Neon host, unless TEST_DATABASE_ALLOW_NEON_BRANCH=1 and the target is
#     not the DATABASE_URL endpoint (reuses backend/db/test-database.ts)
#   * a process carrying RENDER=true or NODE_ENV/APP_ENV/ENVIRONMENT/
#     VERCEL_ENV=production (same guard)
#
# The guard lives in this wrapper (the _dev/_test name rule plus the shared
# production detector); db/schema.sql itself only ever creates.
# ============================================================================
set -euo pipefail

usage() {
  sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
}

DB_URL="${VELNOX_RESET_DATABASE_URL:-}"
WITH_SEED=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --database-url)
      [ "$#" -ge 2 ] || { echo "FATAL: --database-url needs a value" >&2; exit 2; }
      DB_URL="$2"
      shift 2
      ;;
    --database-url=*)
      DB_URL="${1#--database-url=}"
      shift
      ;;
    --seed)
      WITH_SEED=1
      shift
      ;;
    -h|--help)
      usage
      ;;
    *)
      echo "FATAL: unknown argument: $1" >&2
      usage
      ;;
  esac
done

if [ -z "$DB_URL" ]; then
  echo "FATAL: no database URL. Pass --database-url or set VELNOX_RESET_DATABASE_URL." >&2
  echo "       DATABASE_URL is deliberately ignored: it is the production connection string in this repo." >&2
  exit 2
fi

# Shipped as `bash scripts/db-reset.sh` from anywhere; resolve repository-relative
# paths and the bun import below against the repo root.
cd "$(dirname "$0")/.."

# A caller pasting DATABASE_URL is a mistake, not a request.
if [ -n "${DATABASE_URL:-}" ] && [ "$DB_URL" = "${DATABASE_URL:-}" ]; then
  echo "FATAL: the reset target is DATABASE_URL, which is the application/production database. Refusing." >&2
  exit 1
fi

command -v psql >/dev/null 2>&1 || { echo "FATAL: psql is required." >&2; exit 1; }
command -v bun >/dev/null 2>&1 || { echo "FATAL: bun is required for the shared test-database guard." >&2; exit 1; }

# Extract the database name without echoing credentials.
_url_no_query="${DB_URL%%\?*}"
_db_name="${_url_no_query##*/}"
case "$_db_name" in
  *_dev|*_test) ;;
  *)
    echo "FATAL: database '${_db_name:-<none>}' does not end in _dev or _test. This reset is destructive; refusing." >&2
    exit 1
    ;;
esac
unset _url_no_query _db_name

# The ONE existing production-detection guard, reused instead of reimplemented.
# It never opens a connection and never prints credentials.
NODE_ENV=test TEST_DATABASE_URL="$DB_URL" bun -e '
  import { decideTestDatabase, describeTarget } from "./backend/db/test-database.ts";
  const decision = decideTestDatabase();
  if (!decision.available) {
    console.error("FATAL: " + (decision.reason ?? "the target is not a usable test database"));
    process.exit(1);
  }
  console.log("[reset] target " + describeTarget(decision.target));
' || { echo "FATAL: refusing to reset this target." >&2; exit 1; }

echo "[reset] rebuilding from db/schema.sql ..."
PGOPTIONS="${PGOPTIONS:+$PGOPTIONS }-c velnox.allow_reset=yes" \
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f db/schema.sql

if [ "$WITH_SEED" -eq 1 ]; then
  echo "[reset] seeding deterministic development data ..."
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f scripts/db-seed.sql
fi

echo "[reset] OK — schema rebuilt and guards passed."
