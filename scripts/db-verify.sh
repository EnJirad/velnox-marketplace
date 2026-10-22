#!/usr/bin/env bash
# ============================================================================
# VELNOX — prove the two canonical SQL files install the SAME schema
# ============================================================================
# db/schema.sql is the canonical DDL; db/run-sqleditor.sql is what an operator
# pastes into the Neon SQL Editor. They must:
#
#   1. both apply cleanly to an EMPTY database (dependency order),
#   2. both apply a SECOND time without an error (every creation is guarded),
#   3. produce byte-identical schemas afterwards.
#
# It never reads DATABASE_URL: the cluster comes from TEST_DATABASE_URL (or the
# PG* variables), and both databases it creates end in `_rerun`, are dropped on
# exit, and hold no data.
#
# USAGE
#   TEST_DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/velnox_test \
#     bash scripts/db-verify.sh            # or: bun run db:check
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
    if [ "${_userinfo#*:}" != "$_userinfo" ]; then PGPASSWORD="${_userinfo#*:}"; export PGPASSWORD; fi
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

SCHEMA_DB="velnox_schema_rerun"
RUNNER_DB="velnox_sqleditor_rerun"
OUT_DIR="$(mktemp -d)"

cleanup() {
  psql -X -d "$ADMIN_DB" -q -c "DROP DATABASE IF EXISTS $SCHEMA_DB WITH (FORCE)" >/dev/null 2>&1 || true
  psql -X -d "$ADMIN_DB" -q -c "DROP DATABASE IF EXISTS $RUNNER_DB WITH (FORCE)" >/dev/null 1>&2 || true
  rm -rf "$OUT_DIR"
  return 0
}
trap cleanup EXIT

if ! psql -X -d "$ADMIN_DB" -q -c "SELECT 1" >/dev/null 2>&1; then
  echo "FATAL: cannot connect to ${PGHOST}:${PGPORT}/${ADMIN_DB}. Set TEST_DATABASE_URL." >&2
  exit 1
fi

install_twice() {
  _db="$1"
  _file="$2"
  psql -X -d "$ADMIN_DB" -q -c "DROP DATABASE IF EXISTS $_db WITH (FORCE)" >/dev/null 2>&1 || return 1
  psql -X -d "$ADMIN_DB" -q -c "CREATE DATABASE $_db" >/dev/null 2>&1 || return 1
  echo "  applying $_file (1st pass) ..."
  psql -X -d "$_db" -v ON_ERROR_STOP=1 -q -f "$_file" || return 1
  echo "  applying $_file (2nd pass) ..."
  psql -X -d "$_db" -v ON_ERROR_STOP=1 -q -f "$_file" || return 1
  return 0
}

echo "[db-verify] installing db/schema.sql twice ..."
if ! install_twice "$SCHEMA_DB" "db/schema.sql"; then
  echo "[db-verify] FAIL — db/schema.sql did not install twice." >&2
  exit 1
fi

echo "[db-verify] installing db/run-sqleditor.sql twice ..."
if ! install_twice "$RUNNER_DB" "db/run-sqleditor.sql"; then
  echo "[db-verify] FAIL — db/run-sqleditor.sql did not install twice." >&2
  exit 1
fi

# Strip the server-version banner, ownership comments and blank lines so the
# comparison is about DECLARED objects, not about when the dump was taken.
dump_schema() {
  pg_dump --schema-only --no-owner --no-privileges -f "$2" "$1" >/dev/null 2>&1 \
    || pg_dump --schema-only --no-owner --no-privileges "$1" > "$2" || return 1
  # `\restrict`/`\unrestrict` carry a token pg_dump randomises per invocation.
  grep -v '^--' "$2" \
    | grep -v '^[[:space:]]*$' \
    | grep -v '^\\restrict ' \
    | grep -v '^\\unrestrict ' > "$2.clean" || true
  mv "$2.clean" "$2"
  return 0
}

echo "[db-verify] comparing the two installed schemas ..."
if ! dump_schema "$SCHEMA_DB" "$OUT_DIR/schema.sql.dump"; then
  echo "[db-verify] FAIL — could not dump $SCHEMA_DB." >&2
  exit 1
fi
if ! dump_schema "$RUNNER_DB" "$OUT_DIR/runner.sql.dump"; then
  echo "[db-verify] FAIL — could not dump $RUNNER_DB." >&2
  exit 1
fi

if ! diff -u "$OUT_DIR/schema.sql.dump" "$OUT_DIR/runner.sql.dump"; then
  echo "[db-verify] FAIL — the two files install DIFFERENT schemas (diff above)." >&2
  exit 1
fi

_tables=$(psql -X -d "$SCHEMA_DB" -tAc "SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m')")
_indexes=$(psql -X -d "$SCHEMA_DB" -tAc "SELECT count(*) FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indexrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'")
_constraints=$(psql -X -d "$SCHEMA_DB" -tAc "SELECT count(*) FROM pg_catalog.pg_constraint con JOIN pg_catalog.pg_namespace n ON n.oid=con.connamespace WHERE n.nspname='public'")

echo "[db-verify] PASS — both files install, re-install, and agree."
echo "[db-verify]   tables/views: $_tables   indexes: $_indexes   constraints: $_constraints"
exit 0
