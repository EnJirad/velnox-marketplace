#!/usr/bin/env bash
# ============================================================================
# VELNOX MVP — API test suite runner (disposable database)
# ============================================================================
# The MVP API tests need a database built from db/schema.sql. They create their
# own (`velnox_mvp_app_test`) rather than reusing the job's test database, so a
# run can never mutate the database the static contract suite inspects.
#
# This script:
#   1. reads the cluster from TEST_DATABASE_URL (or PG* variables),
#   2. creates a DEDICATED database `velnox_mvp_app_test`,
#   3. applies db/schema.sql to it,
#   4. runs `bun test backend/mvp/tests` with TEST_DATABASE_URL pointing at it,
#   5. drops it afterwards (unless VELNOX_KEEP_TEST_DB=1).
#
# USAGE
#   TEST_DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/velnox_test \
#     bash scripts/db-test-run.sh        # or: bun run test:mvp
#
# It never reads DATABASE_URL, so the application/production database can never
# become the target by accident. The database name it creates ends in `_test`,
# which `backend/db/test-database.ts` requires anyway.
# ============================================================================
set -u

cd "$(dirname "$0")/.." || exit 1

_url="${TEST_DATABASE_URL:-}"
if [ -n "$_url" ]; then
  _query=""
  case "$_url" in *\?*) _query="${_url#*\?}"; _url="${_url%%\?*}";; esac
  _rest="${_url#*://}"
  if [ "$_rest" != "$_url" ] && [ "${_rest#*@}" != "$_rest" ]; then
    _userinfo="${_rest%@*}"
    _hostpath="${_rest##*@}"
    PGUSER="${_userinfo%%:*}"
    if [ "${_userinfo#*:}" != "$_userinfo" ]; then export PGPASSWORD="${_userinfo#*:}"; fi
    _hostport="${_hostpath%%/*}"
    PGHOST="${_hostport%%:*}"
    if [ "${_hostport##*:}" != "$_hostport" ]; then PGPORT="${_hostport##*:}"; fi
    ADMIN_DB="${_hostpath#*/}"
  fi
  case "$_query" in
    *sslmode=*) _ssl="${_query##*sslmode=}"; PGSSLMODE="${_ssl%%&*}"; export PGSSLMODE ;;
  esac
  unset _query _rest _userinfo _hostpath _hostport _ssl
fi
PGUSER="${PGUSER:-velnox_test}"
PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5432}"
ADMIN_DB="${ADMIN_DB:-velnox_test}"
export PGUSER PGHOST PGPORT

TEST_DB="velnox_mvp_app_test"

cleanup() {
  [ "${VELNOX_KEEP_TEST_DB:-0}" = "1" ] && { echo "[mvp-test] kept database $TEST_DB"; return 0; }
  psql -X -d "$ADMIN_DB" -q -c "DROP DATABASE IF EXISTS $TEST_DB WITH (FORCE)" >/dev/null 2>&1 || true
  return 0
}
trap cleanup EXIT

if ! psql -X -d "$ADMIN_DB" -q -c "SELECT 1" >/dev/null 2>&1; then
  echo "FATAL: cannot connect to ${PGHOST}:${PGPORT}/${ADMIN_DB}. Set TEST_DATABASE_URL." >&2
  exit 1
fi

echo "[mvp-test] rebuilding $TEST_DB from db/schema.sql ..."
if ! psql -X -d "$ADMIN_DB" -q -c "DROP DATABASE IF EXISTS $TEST_DB WITH (FORCE)" >/dev/null 2>&1 \
   || ! psql -X -d "$ADMIN_DB" -q -c "CREATE DATABASE $TEST_DB" >/dev/null 2>&1; then
  echo "FATAL: this role cannot create databases on ${PGHOST}:${PGPORT}." >&2
  exit 1
fi
if ! psql -X -d "$TEST_DB" -v ON_ERROR_STOP=1 -q -f db/schema.sql >/dev/null; then
  echo "FATAL: db/schema.sql failed to apply." >&2
  exit 1
fi

# Build the connection string without echoing credentials. Percent-encoding is
# done in bun so a password containing `@`, `/` or `:` cannot corrupt the URL.
MVP_URL="$(PGUSER="$PGUSER" PGPASSWORD="${PGPASSWORD:-}" PGHOST="$PGHOST" PGPORT="$PGPORT" TEST_DB="$TEST_DB" bun -e '
  const { PGUSER, PGPASSWORD, PGHOST, PGPORT, TEST_DB } = process.env;
  const user = encodeURIComponent(PGUSER);
  const pass = PGPASSWORD ? ":" + encodeURIComponent(PGPASSWORD) : "";
  console.log(`postgresql://${user}${pass}@${PGHOST}:${PGPORT}/${TEST_DB}`);
')" || { echo "FATAL: could not build the test connection string." >&2; exit 1; }

echo "[mvp-test] running backend/mvp/tests ..."
# JWT_SECRET is test-only: it signs fixtures inside this process and is never a
# deployment secret. A real value in the environment wins.
TEST_DATABASE_URL="$MVP_URL" \
JWT_SECRET="${JWT_SECRET:-mvp-test-only-secret-not-for-production}" \
NODE_ENV=test \
  bun test backend/mvp/tests
STATUS=$?

if [ "$STATUS" -eq 0 ]; then
  echo "[mvp-test] PASS"
else
  echo "[mvp-test] FAIL (exit $STATUS)" >&2
fi
exit "$STATUS"
