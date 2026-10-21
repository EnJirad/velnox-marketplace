#!/usr/bin/env bash
# ============================================================================
# VELNOX MVP — real-browser E2E runner (disposable database)
# ============================================================================
# Builds the three MVP frontends (VelShop / VelSeller / VelCenter) with
# VITE_API_MODE=mvp, serves them over local HTTPS against a real MVP API, and
# drives Chromium through:
#
#   seller signup → apply → admin approve → product + variant → submit →
#   admin approve → publish → buyer signup → catalogue → cart → checkout →
#   order confirmation → cancel (stock returns) → admin expiry sweep (stock
#   returns again)
#
# WHAT IT NEVER TOUCHES
#   * `DATABASE_URL` is not read: the target comes from TEST_DATABASE_URL only.
#   * The database it creates is `velnox_mvp_browser_test` on that cluster and is
#     dropped on exit (VELNOX_KEEP_TEST_DB=1 keeps it for inspection).
#   * `scripts/mvp-browser-e2e.ts` re-checks the identity (name ends in `_test`,
#     MVP `products.seller_id` present, no pre-MVP `shops`, zero users) and
#     refuses otherwise.
#
# PREREQUISITES
#   bun add -d playwright
#   bunx playwright install chromium
#   sudo bunx playwright install-deps chromium     # Linux system libraries
#
# USAGE
#   TEST_DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/velnox_test \
#     bun run test:mvp:browser
# ============================================================================
set -u

cd "$(dirname "$0")/../.." || exit 1

for marker in RENDER VERCEL_ENV APP_ENV ENVIRONMENT; do
  eval "value=\${$marker:-}"
  if [ "${value}" = "production" ] || { [ "$marker" = "RENDER" ] && [ -n "$value" ]; }; then
    echo "FATAL: refusing to run browser E2E in a production-marked environment ($marker=$value)." >&2
    exit 1
  fi
done
if [ "${NODE_ENV:-}" = "production" ]; then
  echo "FATAL: refusing to run browser E2E with NODE_ENV=production." >&2
  exit 1
fi

_url="${TEST_DATABASE_URL:-}"
if [ -z "$_url" ]; then
  echo "FATAL: TEST_DATABASE_URL is required (DATABASE_URL is deliberately ignored)." >&2
  exit 1
fi

# Split the URL without ever echoing credentials.
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
PGUSER="${PGUSER:-velnox_test}"
PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5432}"
ADMIN_DB="${ADMIN_DB:-velnox_test}"
export PGUSER PGHOST PGPORT

for bin in psql bun openssl; do
  command -v "$bin" >/dev/null 2>&1 || { echo "FATAL: $bin is required." >&2; exit 1; }
done

if [ ! -d node_modules/playwright ]; then
  echo "FATAL: the playwright package is not installed. Run: bun add -d playwright" >&2
  exit 1
fi

TEST_DB="velnox_mvp_browser_test"
CERT_DIR="$(mktemp -d)"
export MVP_E2E_CERT_DIR="$CERT_DIR"

cleanup() {
  rm -rf "$CERT_DIR"
  if [ "${VELNOX_KEEP_TEST_DB:-0}" = "1" ]; then
    echo "[mvp-browser] kept database $TEST_DB"
    return 0
  fi
  psql -X -d "$ADMIN_DB" -q -c "DROP DATABASE IF EXISTS $TEST_DB WITH (FORCE)" >/dev/null 2>&1 || true
  return 0
}
trap cleanup EXIT

if ! psql -X -d "$ADMIN_DB" -q -c "SELECT 1" >/dev/null 2>&1; then
  echo "FATAL: cannot connect to ${PGHOST}:${PGPORT}/${ADMIN_DB}. Set TEST_DATABASE_URL." >&2
  exit 1
fi

echo "[mvp-browser] rebuilding $TEST_DB from db/mvp/schema.sql ..."
if ! psql -X -d "$ADMIN_DB" -q -c "DROP DATABASE IF EXISTS $TEST_DB WITH (FORCE)" >/dev/null 2>&1 \
   || ! psql -X -d "$ADMIN_DB" -q -c "CREATE DATABASE $TEST_DB" >/dev/null 2>&1; then
  echo "FATAL: this role cannot create databases on ${PGHOST}:${PGPORT}." >&2
  exit 1
fi
if ! psql -X -d "$TEST_DB" -v ON_ERROR_STOP=1 -q -f db/mvp/schema.sql >/dev/null; then
  echo "FATAL: db/mvp/schema.sql failed to apply." >&2
  exit 1
fi

if ! openssl req -x509 -newkey rsa:2048 -nodes \
      -keyout "$CERT_DIR/key.pem" -out "$CERT_DIR/cert.pem" -days 2 \
      -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" >/dev/null 2>&1; then
  echo "FATAL: could not create the throwaway TLS certificate." >&2
  exit 1
fi

# Build the connection string in bun so a password containing @ / : cannot
# corrupt the URL, and never print it.
BROWSER_URL="$(PGUSER="$PGUSER" PGPASSWORD="${PGPASSWORD:-}" PGHOST="$PGHOST" PGPORT="$PGPORT" TEST_DB="$TEST_DB" bun -e '
  const { PGUSER, PGPASSWORD, PGHOST, PGPORT, TEST_DB } = process.env;
  const user = encodeURIComponent(PGUSER);
  const pass = PGPASSWORD ? ":" + encodeURIComponent(PGPASSWORD) : "";
  console.log(`postgresql://${user}${pass}@${PGHOST}:${PGPORT}/${TEST_DB}`);
')" || { echo "FATAL: could not build the test connection string." >&2; exit 1; }

echo "[mvp-browser] building apps and driving Chromium ..."
# MVP_COOKIE_SECURE=true gives the session cookie its production `Secure` flag so
# Chromium accepts SameSite=None over the harness's HTTPS origin.
# NODE_ENV=test is what makes `backend/db/test-database.ts` treat
# TEST_DATABASE_URL as authoritative (and refuse a production target). Without
# it the pool would fall back to DATABASE_URL, which is deliberately unset here.
NODE_ENV=test \
MVP_E2E_ALLOW=1 \
MVP_COOKIE_SECURE=true \
TEST_DATABASE_URL="$BROWSER_URL" \
JWT_SECRET="${JWT_SECRET:-mvp-browser-e2e-only-secret-not-for-production}" \
  bun scripts/mvp-browser-e2e.ts
STATUS=$?

if [ "$STATUS" -eq 0 ]; then
  echo "[mvp-browser] PASS"
else
  echo "[mvp-browser] FAIL (exit $STATUS)" >&2
fi
exit "$STATUS"
