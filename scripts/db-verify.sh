#!/usr/bin/env bash
# ============================================================================
# VELNOX — prove the two canonical SQL files install the SAME schema
# ============================================================================
# db/schema.sql is the canonical DDL; db/run-sqleditor.sql is what an operator
# pastes into the Neon SQL Editor. They must:
#
#   1. both apply cleanly to an EMPTY database (dependency order),
#   2. both apply a SECOND time without an error (every creation is guarded),
#   3. produce identical schemas afterwards,
#   4. db/run-sqleditor.sql REPAIRS a database installed from an OLDER version
#      (missing post-baseline tables + columns + constraints), and repairing
#      leaves it identical to a fresh install.
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
DRIFT_DB="velnox_drift_repair"
OUT_DIR="$(mktemp -d)"

cleanup() {
  psql -X -d "$ADMIN_DB" -q -c "DROP DATABASE IF EXISTS $SCHEMA_DB WITH (FORCE)" >/dev/null 2>&1 || true
  psql -X -d "$ADMIN_DB" -q -c "DROP DATABASE IF EXISTS $RUNNER_DB WITH (FORCE)" >/dev/null 1>&2 || true
  psql -X -d "$ADMIN_DB" -q -c "DROP DATABASE IF EXISTS $DRIFT_DB WITH (FORCE)" >/dev/null 1>&2 || true
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

# ── Repair phase ────────────────────────────────────────────────────────────
# Reproduce a database installed from the PREVIOUS version of the canonical
# schema, then prove the installer brings it forward. The dropped objects are
# exactly the post-baseline additions: three tables and the columns/constraints
# that were added to tables which already existed.
echo "[db-verify] proving db/run-sqleditor.sql repairs an older database ..."
psql -X -d "$ADMIN_DB" -q -c "DROP DATABASE IF EXISTS $DRIFT_DB WITH (FORCE)" >/dev/null 2>&1 || true
psql -X -d "$ADMIN_DB" -q -c "CREATE DATABASE $DRIFT_DB" >/dev/null 2>&1 || {
  echo "[db-verify] FAIL — could not create $DRIFT_DB." >&2
  exit 1
}
if ! psql -X -d "$DRIFT_DB" -v ON_ERROR_STOP=1 -q -f db/schema.sql >/dev/null; then
  echo "[db-verify] FAIL — could not stage the drift database." >&2
  exit 1
fi
if ! psql -X -d "$DRIFT_DB" -v ON_ERROR_STOP=1 -q \
  -c "DROP TABLE IF EXISTS product_reviews, product_favorites, user_identities CASCADE" \
  -c "ALTER TABLE users DROP COLUMN IF EXISTS cover_url" \
  -c "ALTER TABLE addresses DROP CONSTRAINT IF EXISTS addresses_latitude_range, DROP CONSTRAINT IF EXISTS addresses_longitude_range, DROP CONSTRAINT IF EXISTS addresses_coordinates_paired, DROP COLUMN IF EXISTS latitude, DROP COLUMN IF EXISTS longitude" >/dev/null; then
  echo "[db-verify] FAIL — could not simulate the older database." >&2
  exit 1
fi
for _pass in 1 2; do
  if ! psql -X -d "$DRIFT_DB" -v ON_ERROR_STOP=1 -q -f db/run-sqleditor.sql >/dev/null; then
    echo "[db-verify] FAIL — the installer could not repair the older database (pass $_pass)." >&2
    exit 1
  fi
done

# Order-insensitive catalog fingerprint: column ORDER differs after an
# ADD COLUMN (PostgreSQL appends it), which is semantically irrelevant.
catalog_fingerprint() {
  psql -X -d "$1" -tA -c "
    SELECT 'col|'||table_name||'|'||column_name||'|'||data_type||'|'||coalesce(character_maximum_length::text,'')||'|'||coalesce(numeric_precision::text,'')||'|'||coalesce(numeric_scale::text,'')||'|'||is_nullable||'|'||coalesce(column_default,'')
      FROM information_schema.columns WHERE table_schema='public'
    UNION ALL
    SELECT 'idx|'||indexname||'|'||indexdef FROM pg_indexes WHERE schemaname='public'
    UNION ALL
    SELECT 'con|'||conrelid::regclass::text||'|'||conname||'|'||pg_get_constraintdef(oid)
      FROM pg_constraint WHERE connamespace='public'::regnamespace
    UNION ALL
    SELECT 'trg|'||c.relname||'|'||t.tgname||'|'||pg_get_triggerdef(t.oid)
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND NOT t.tgisinternal
    ORDER BY 1"
}

if ! catalog_fingerprint "$SCHEMA_DB" > "$OUT_DIR/fresh.objects"; then
  echo "[db-verify] FAIL — could not fingerprint $SCHEMA_DB." >&2
  exit 1
fi
if ! catalog_fingerprint "$DRIFT_DB" > "$OUT_DIR/repaired.objects"; then
  echo "[db-verify] FAIL — could not fingerprint $DRIFT_DB." >&2
  exit 1
fi
if ! diff -u "$OUT_DIR/fresh.objects" "$OUT_DIR/repaired.objects"; then
  echo "[db-verify] FAIL — a repaired database differs from a fresh install (diff above)." >&2
  exit 1
fi

_tables=$(psql -X -d "$SCHEMA_DB" -tAc "SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m')")
_indexes=$(psql -X -d "$SCHEMA_DB" -tAc "SELECT count(*) FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indexrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'")
_constraints=$(psql -X -d "$SCHEMA_DB" -tAc "SELECT count(*) FROM pg_catalog.pg_constraint con JOIN pg_catalog.pg_namespace n ON n.oid=con.connamespace WHERE n.nspname='public'")

echo "[db-verify] PASS — both files install, re-install, agree, and repair older databases."
echo "[db-verify]   tables/views: $_tables   indexes: $_indexes   constraints: $_constraints"
exit 0
