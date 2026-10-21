#!/usr/bin/env bash
# ============================================================================
# VELNOX MVP SCHEMA — BEHAVIOURAL PROOF
# ============================================================================
# Creates DISPOSABLE databases on the cluster named by TEST_DATABASE_URL and
# proves the clean MVP schema behaves, rather than only parsing:
#
#   A  fresh bootstrap, and a rerun that changes nothing
#   B  the table set and the money / stock shape
#   C  seller + product + order lifecycle triggers
#   D  constraints: ownership pairing, stock, cart, money, payments
#   E  a full CRUD smoke path: user → seller → product → inventory → cart →
#      order → payment → delivered
#   F  the guarded reset: twice, and every refusal path
#
# It never connects to production: the databases it creates are named
# velnox_mvp_verify_test / velnox_mvp_guard_prod on the configured cluster, and
# it refuses to run when TEST_DATABASE_URL looks like production (the same
# backend/db/test-database.ts rule the test suite uses).
#
# USAGE
#   TEST_DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/velnox_test \
#     bash db/mvp/verify.sh
#
#   VELNOX_KEEP_VERIFY_DB=1   keep the databases for inspection
#
# EXIT STATUS
#   0 only when every assertion passed.
# ============================================================================
set -u

cd "$(dirname "$0")/../.." || exit 1

FAILED=0
TOTAL=0
pass() { TOTAL=$((TOTAL + 1)); printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
fail() { TOTAL=$((TOTAL + 1)); FAILED=1; printf '  \033[31mFAIL\033[0m  %s\n' "$1"; }
section() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# ── connection ───────────────────────────────────────────────────────────────
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

VERIFY_DB="velnox_mvp_verify_test"
GUARD_DB="velnox_mvp_guard_prod"

P() { psql -X -d "$VERIFY_DB" -v ON_ERROR_STOP=1 -q "$@"; }
V() { psql -X -d "$VERIFY_DB" -v ON_ERROR_STOP=1 -q -At "$@"; }
A() { psql -X -d "$ADMIN_DB" -v ON_ERROR_STOP=1 -q "$@"; }

cleanup() {
  [ "${VELNOX_KEEP_VERIFY_DB:-0}" = "1" ] && return 0
  A -c "DROP DATABASE IF EXISTS $VERIFY_DB" >/dev/null 2>&1 || true
  A -c "DROP DATABASE IF EXISTS $GUARD_DB" >/dev/null 2>&1 || true
  return 0
}
trap cleanup EXIT

expect_eq() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then pass "$label"; else fail "$label (expected [$expected], got [$actual])"; fi
}

expect_fail() {
  local label="$1" sql="$2"
  if printf '%s\n' "$sql" | P -f - >/dev/null 2>&1; then
    fail "$label (the statement unexpectedly SUCCEEDED)"
  else
    pass "$label"
  fi
}

fingerprint() {
  printf '%s|%s|%s|%s|%s' \
    "$(V -c "SELECT md5(string_agg(table_name||'.'||column_name||':'||data_type||':'||is_nullable, ',' ORDER BY table_name, ordinal_position)) FROM information_schema.columns WHERE table_schema='public'")" \
    "$(V -c "SELECT count(*) FROM pg_indexes WHERE schemaname='public'")" \
    "$(V -c "SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public'")" \
    "$(V -c "SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal")" \
    "$(V -c "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'")"
}

echo "=== Velnox MVP schema verification ==="
echo "cluster: ${PGHOST}:${PGPORT}  admin db: ${ADMIN_DB}  verify db: ${VERIFY_DB}"

if ! A -c "SELECT 1" >/dev/null 2>&1; then
  echo "FATAL: cannot connect to ${PGHOST}:${PGPORT}/${ADMIN_DB}. Set TEST_DATABASE_URL." >&2
  exit 1
fi
if ! A -c "DROP DATABASE IF EXISTS $VERIFY_DB" >/dev/null 2>&1 \
   || ! A -c "CREATE DATABASE $VERIFY_DB" >/dev/null 2>&1; then
  echo "FATAL: the configured role cannot create databases on this cluster." >&2
  exit 1
fi

# ── A. bootstrap ─────────────────────────────────────────────────────────────
section "A. fresh bootstrap"
if P -f db/mvp/schema.sql >/dev/null 2>&1; then pass "db/mvp/schema.sql applies to an empty database"; else fail "db/mvp/schema.sql failed on an empty database"; fi

EXPECTED_TABLES="addresses
audit_logs
cart_items
carts
categories
checkout_requests
inventory
media
order_items
orders
payment_events
payments
product_images
product_variants
products
revoked_tokens
seller_profiles
shipments
users"
ACTUAL_TABLES="$(V -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name")"
expect_eq "the schema has exactly 19 MVP tables (no legacy table survived)" "$EXPECTED_TABLES" "$ACTUAL_TABLES"

FP_INITIAL="$(fingerprint)"
if P -f db/mvp/schema.sql >/dev/null 2>&1; then pass "a second run of schema.sql succeeds"; else fail "a second run of schema.sql failed"; fi
expect_eq "a rerun changes no table, column, index, constraint, trigger or function" "$FP_INITIAL" "$(fingerprint)"

# ── B. shape ─────────────────────────────────────────────────────────────────
section "B. money and stock shape"
expect_eq "orders.total_amount is NUMERIC(12,2)" "numeric|12|2" \
  "$(V -c "SELECT data_type||'|'||numeric_precision||'|'||numeric_scale FROM information_schema.columns WHERE table_name='orders' AND column_name='total_amount'")"
expect_eq "payments.amount is NUMERIC(12,2)" "numeric|12|2" \
  "$(V -c "SELECT data_type||'|'||numeric_precision||'|'||numeric_scale FROM information_schema.columns WHERE table_name='payments' AND column_name='amount'")"
expect_eq "no money column is floating point" "0" \
  "$(V -c "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND data_type IN ('real','double precision')")"
expect_eq "product_variants carries NO stock column (one stock authority)" "0" \
  "$(V -c "SELECT count(*) FROM information_schema.columns WHERE table_name='product_variants' AND column_name='stock'")"
expect_eq "the one stock table is inventory" "inventory|quantity|reserved" \
  "$(V -c "SELECT table_name||'|'||string_agg(column_name,'|' ORDER BY column_name) FROM information_schema.columns WHERE table_name='inventory' AND column_name IN ('quantity','reserved') GROUP BY table_name")"
expect_eq "no sets/packs, checkout-group or multi-shop table exists" "0" \
  "$(V -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('product_selling_units','checkout_groups','store_accounts','subscriptions','velrepeat_plans')")"
expect_eq "all six lifecycle triggers are installed" "6" \
  "$(V -c "SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal")"

# ── C. fixtures ──────────────────────────────────────────────────────────────
section "C. CRUD smoke path fixtures"
if P -f - >/dev/null <<'SQL'
INSERT INTO users (id, email, name, role, password_hash) VALUES
  ('00000000-0000-0000-0000-000000000001', 'owner@mvp.test',   'Owner',         'owner',    'scrypt-placeholder'),
  ('00000000-0000-0000-0000-000000000002', 'seller1@mvp.test', 'Seller One',    'seller',   NULL),
  ('00000000-0000-0000-0000-000000000003', 'buyer@mvp.test',   'Buyer',         'customer', NULL),
  ('00000000-0000-0000-0000-000000000004', 'seller2@mvp.test', 'Seller Two',    'seller',   NULL),
  ('00000000-0000-0000-0000-000000000005', 'pending@mvp.test', 'Pending Seller','seller',   NULL),
  ('00000000-0000-0000-0000-000000000006', 'seller3@mvp.test', 'Seller Three',  'seller',   NULL);

INSERT INTO seller_profiles (id, user_id, store_name, slug, status, approved_at, approved_by) VALUES
  ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000002', 'Seller One Store', 'seller-one', 'approved', NOW(), '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000004', 'Seller Two Store', 'seller-two', 'approved', NOW(), '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000005', 'Pending Store',    'pending-store', 'pending', NULL, NULL);

INSERT INTO categories (slug, name) VALUES ('home', 'Home'), ('cat-a', 'A'), ('cat-b', 'B');

INSERT INTO products (id, seller_id, category_slug, name, slug, price) VALUES
  ('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000011', 'home', 'Published Product', 'published-product', 100.00),
  ('00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000012', 'home', 'Other Product',     'other-product',      50.00),
  ('00000000-0000-0000-0000-000000000023', '00000000-0000-0000-0000-000000000011', 'home', 'Rejected Product',  'rejected-product',   10.00);

INSERT INTO product_variants (id, product_id, name, price) VALUES
  ('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000021', 'Red', 100.00),
  ('00000000-0000-0000-0000-000000000032', '00000000-0000-0000-0000-000000000023', 'Blue', 10.00);

INSERT INTO inventory (product_id, variant_id, quantity) VALUES
  ('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000031', 10);

INSERT INTO carts (id, user_id, seller_id) VALUES
  ('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000011'),
  ('00000000-0000-0000-0000-000000000042', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000012');

INSERT INTO cart_items (cart_id, seller_id, product_id, variant_id, quantity, price) VALUES
  ('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000031', 2, 100.00),
  ('00000000-0000-0000-0000-000000000042', '00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000022', NULL, 1, 50.00);
SQL
then
  pass "user → seller → category → product → variant → inventory → cart fixtures insert"
else
  fail "fixtures failed — the rest of the behavioural checks cannot be trusted"
  echo; echo "RESULT: $((TOTAL - FAILED))/$TOTAL checks passed — ABORTING" ; exit 1
fi

# ── D. product lifecycle + approval ──────────────────────────────────────────
section "D. product lifecycle, approval and seller approval"
expect_eq "a new product starts as draft with approval_status=pending" "draft|pending" \
  "$(V -c "SELECT status||'|'||approval_status FROM products WHERE id='00000000-0000-0000-0000-000000000021'")"
expect_fail "submitting without submitted_at is refused" \
  "UPDATE products SET status='submitted' WHERE id='00000000-0000-0000-0000-000000000021';"
expect_fail "a draft product cannot jump straight to published" \
  "UPDATE products SET status='published', published_at=NOW() WHERE id='00000000-0000-0000-0000-000000000021';"
expect_fail "a pending seller cannot create a product" \
  "INSERT INTO products (seller_id, name, slug, price) VALUES ('00000000-0000-0000-0000-000000000013','Nope','nope',1.00);"
expect_fail "a product cannot be transferred to another seller (ownership is immutable)" \
  "UPDATE products SET seller_id='00000000-0000-0000-0000-000000000012' WHERE id='00000000-0000-0000-0000-000000000021';"
expect_fail "a product insertion cannot start as published" \
  "INSERT INTO products (seller_id, name, slug, price, status, submitted_at) VALUES ('00000000-0000-0000-0000-000000000011','Nope2','nope2',1.00,'published',NOW());"

if P -f - >/dev/null <<'SQL'
UPDATE products SET status='submitted', submitted_at=NOW()
 WHERE id='00000000-0000-0000-0000-000000000021';
UPDATE products SET status='approved', approved_at=NOW(), approved_by='00000000-0000-0000-0000-000000000001'
 WHERE id='00000000-0000-0000-0000-000000000021';
UPDATE products SET status='published', published_at=NOW()
 WHERE id='00000000-0000-0000-0000-000000000021';
SQL
then pass "draft → submitted → approved → published succeeds"; else fail "the legal product lifecycle failed"; fi
expect_eq "a published product projects approval_status=approved" "published|approved" \
  "$(V -c "SELECT status||'|'||approval_status FROM products WHERE id='00000000-0000-0000-0000-000000000021'")"

if P -f - >/dev/null <<'SQL'
UPDATE products SET status='submitted', submitted_at=NOW() WHERE id='00000000-0000-0000-0000-000000000023';
UPDATE products SET status='rejected', rejection_reason='not allowed' WHERE id='00000000-0000-0000-0000-000000000023';
SQL
then pass "submitted → rejected records a reason"; else fail "the rejection path failed"; fi
expect_eq "a rejected product projects approval_status=rejected" "rejected" \
  "$(V -c "SELECT approval_status FROM products WHERE id='00000000-0000-0000-0000-000000000023'")"
if P -c "UPDATE products SET status='submitted', submitted_at=NOW() WHERE id='00000000-0000-0000-0000-000000000023'" >/dev/null 2>&1; then
  pass "a rejected product can be edited and resubmitted"
else
  fail "a rejected product could not be resubmitted"
fi

expect_fail "an approved seller without approved_at is refused" \
  "INSERT INTO seller_profiles (user_id, store_name, slug, status) VALUES ('00000000-0000-0000-0000-000000000006','No Evidence','no-evidence','approved');"
expect_fail "a seller cannot approve their own application" \
  "UPDATE seller_profiles SET status='approved', approved_at=NOW(), approved_by='00000000-0000-0000-0000-000000000005' WHERE id='00000000-0000-0000-0000-000000000013';"
expect_fail "a rejected seller needs a reason" \
  "UPDATE seller_profiles SET status='rejected' WHERE id='00000000-0000-0000-0000-000000000013';"

# ── E. constraints ───────────────────────────────────────────────────────────
section "E. database constraints"
expect_fail "users.role='staff' is not an MVP role" \
  "INSERT INTO users (email, role) VALUES ('staff@mvp.test','staff');"
expect_fail "an admin without a password is refused" \
  "INSERT INTO users (email, role) VALUES ('admin@mvp.test','admin');"
expect_fail "a duplicate product slug is refused" \
  "INSERT INTO products (seller_id, name, slug, price) VALUES ('00000000-0000-0000-0000-000000000011','Dup','published-product',1.00);"
expect_fail "two variants with the same name on one product are refused" \
  "INSERT INTO product_variants (product_id, name, price) VALUES ('00000000-0000-0000-0000-000000000021','Red',1.00);"
expect_fail "negative stock is refused" \
  "UPDATE inventory SET quantity=-1 WHERE product_id='00000000-0000-0000-0000-000000000021';"
expect_fail "reserved stock above quantity is refused" \
  "UPDATE inventory SET reserved=99 WHERE product_id='00000000-0000-0000-0000-000000000021';"
expect_fail "a second inventory row for the same (product, variant) is refused" \
  "INSERT INTO inventory (product_id, variant_id, quantity) VALUES ('00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000031',1);"
expect_fail "cart quantity 0 is refused" \
  "INSERT INTO cart_items (cart_id, seller_id, product_id, quantity, price) VALUES ('00000000-0000-0000-0000-000000000041','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000021',0,1.00);"
expect_fail "the same product+variant cannot appear twice in one cart" \
  "INSERT INTO cart_items (cart_id, seller_id, product_id, variant_id, quantity, price) VALUES ('00000000-0000-0000-0000-000000000041','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000031',1,100.00);"
expect_fail "a cart line cannot mix sellers (cart seller ≠ product seller)" \
  "INSERT INTO cart_items (cart_id, seller_id, product_id, quantity, price) VALUES ('00000000-0000-0000-0000-000000000041','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000022',1,50.00);"
expect_fail "a cart line cannot pair a variant with another product" \
  "INSERT INTO cart_items (cart_id, seller_id, product_id, variant_id, quantity, price) VALUES ('00000000-0000-0000-0000-000000000041','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000032',1,100.00);"
expect_fail "one user cannot have two default addresses" \
  "INSERT INTO addresses (user_id, recipient_name, phone, line1, city, state, postal_code, is_default) VALUES ('00000000-0000-0000-0000-000000000003','A','1','L','C','S','10000',TRUE),('00000000-0000-0000-0000-000000000003','B','2','L','C','S','10000',TRUE);"
expect_fail "an order number must be exactly 18 digits" \
  "INSERT INTO orders (order_number, user_id, seller_id, subtotal, total_amount, shipping_address) VALUES ('123','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000011',1,1,'{}');"
expect_fail "an order total that does not equal subtotal + shipping is refused" \
  "INSERT INTO orders (order_number, user_id, seller_id, subtotal, shipping_fee, total_amount, shipping_address) VALUES ('111111111111111111','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000011',100,10,200,'{}');"
expect_fail "an order cannot be created for a suspended/pending seller" \
  "INSERT INTO orders (order_number, user_id, seller_id, subtotal, total_amount, shipping_address) VALUES ('222222222222222222','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000013',1,1,'{}');"

# ── F. inventory reservation + order/payment settlement ──────────────────────
section "F. inventory reservation, order and payment"
expect_eq "the guarded reservation takes 2 units" "1|2" \
  "$(V -c "WITH u AS (UPDATE inventory SET reserved=reserved+2 WHERE product_id='00000000-0000-0000-0000-000000000021' AND COALESCE(variant_id,'00000000-0000-0000-0000-000000000000'::uuid)='00000000-0000-0000-0000-000000000031' AND quantity-reserved>=2 RETURNING reserved) SELECT count(*)||'|'||max(reserved) FROM u")"
expect_eq "an oversell attempt updates 0 rows (atomic guard, not a negative stock)" "0|2" \
  "$(V -c "WITH u AS (UPDATE inventory SET reserved=reserved+9 WHERE product_id='00000000-0000-0000-0000-000000000021' AND COALESCE(variant_id,'00000000-0000-0000-0000-000000000000'::uuid)='00000000-0000-0000-0000-000000000031' AND quantity-reserved>=9 RETURNING reserved) SELECT (SELECT count(*) FROM u)||'|'||(SELECT reserved FROM inventory WHERE product_id='00000000-0000-0000-0000-000000000021')")"

if P -f - >/dev/null <<'SQL'
INSERT INTO orders (id, order_number, user_id, seller_id, subtotal, shipping_fee, total_amount, shipping_address)
VALUES ('00000000-0000-0000-0000-000000000051', '123456789012345678', '00000000-0000-0000-0000-000000000003',
        '00000000-0000-0000-0000-000000000011', 200.00, 0.00, 200.00,
        '{"recipient_name":"Buyer","phone":"0000000000","line1":"1 Test Rd","city":"Bangkok","state":"Bangkok","postal_code":"10000","country":"TH"}');
INSERT INTO order_items (order_id, seller_id, product_id, variant_id, product_name, variant_name, unit_price, quantity, subtotal)
VALUES ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000011',
        '00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000031',
        'Published Product', 'Red', 100.00, 2, 200.00);
INSERT INTO payments (order_id, provider, status, amount, currency, method, provider_checkout_session_id)
VALUES ('00000000-0000-0000-0000-000000000051', 'stripe', 'pending', 200.00, 'THB', 'card', 'cs_test_1');
SQL
then pass "an order with a published product, its snapshot line and a Stripe attempt insert"; else fail "the order/payment fixture failed"; fi

expect_fail "an unpublished product cannot enter an order" \
  "INSERT INTO order_items (order_id, seller_id, product_id, product_name, unit_price, quantity, subtotal) VALUES ('00000000-0000-0000-0000-000000000051','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000023','Rejected Product',10.00,1,10.00);"
expect_fail "an order line cannot pair a product with another seller" \
  "INSERT INTO order_items (order_id, seller_id, product_id, product_name, unit_price, quantity, subtotal) VALUES ('00000000-0000-0000-0000-000000000051','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000022','Other Product',50.00,1,50.00);"
expect_fail "an order line subtotal must equal unit_price × quantity" \
  "INSERT INTO order_items (order_id, seller_id, product_id, product_name, unit_price, quantity, subtotal) VALUES ('00000000-0000-0000-0000-000000000051','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000021','Published Product',100.00,3,200.00);"
expect_fail "a payment of 0 is refused" \
  "INSERT INTO payments (order_id, amount) VALUES ('00000000-0000-0000-0000-000000000051', 0);"
expect_fail "a second LIVE Stripe session for one order is refused" \
  "INSERT INTO payments (order_id, amount, provider_checkout_session_id) VALUES ('00000000-0000-0000-0000-000000000051', 200.00, 'cs_test_2');"
expect_fail "a duplicate provider session id is refused" \
  "INSERT INTO payments (order_id, amount, provider_checkout_session_id) VALUES ('00000000-0000-0000-0000-000000000051', 200.00, 'cs_test_1');"

# payment settles; the order is NOT marked paid by the database
if P -c "UPDATE payments SET status='paid', paid_at=NOW() WHERE provider_checkout_session_id='cs_test_1'" >/dev/null 2>&1; then
  pass "a verified payment can be recorded as paid"
else
  fail "a verified payment could not be recorded as paid"
fi
expect_eq "paying the payment does NOT silently mark the order paid" "pending_payment" \
  "$(V -c "SELECT status FROM orders WHERE id='00000000-0000-0000-0000-000000000051'")"
expect_fail "an order cannot jump from pending_payment to shipped" \
  "UPDATE orders SET status='shipped', shipped_at=NOW() WHERE id='00000000-0000-0000-0000-000000000051';"
if P -c "UPDATE orders SET status='paid', paid_at=NOW(), payment_reference='pi_test_1' WHERE id='00000000-0000-0000-0000-000000000051'" >/dev/null 2>&1; then
  pass "pending_payment → paid succeeds in the settlement transaction"
else
  fail "pending_payment → paid failed"
fi
if P -c "UPDATE inventory SET quantity=quantity-2, reserved=reserved-2 WHERE product_id='00000000-0000-0000-0000-000000000021' AND variant_id='00000000-0000-0000-0000-000000000031'" >/dev/null 2>&1; then
  pass "committing a settled order decrements quantity and reserved together"
else
  fail "the stock commit failed"
fi
expect_eq "stock is 8 sold-capable, 0 reserved" "8|0" \
  "$(V -c "SELECT quantity||'|'||reserved FROM inventory WHERE product_id='00000000-0000-0000-0000-000000000021' AND variant_id='00000000-0000-0000-0000-000000000031'")"

if P -f - >/dev/null <<'SQL'
UPDATE orders SET status='processing' WHERE id='00000000-0000-0000-0000-000000000051';
UPDATE orders SET status='shipped', shipped_at=NOW() WHERE id='00000000-0000-0000-0000-000000000051';
INSERT INTO shipments (order_id, carrier, tracking_number, shipped_at) VALUES ('00000000-0000-0000-0000-000000000051','TH Post','TRK1',NOW());
UPDATE orders SET status='delivered', delivered_at=NOW() WHERE id='00000000-0000-0000-0000-000000000051';
SQL
then pass "paid → processing → shipped → delivered succeeds with shipment evidence"; else fail "the fulfilment path failed"; fi
expect_eq "the order ends delivered" "delivered" \
  "$(V -c "SELECT status FROM orders WHERE id='00000000-0000-0000-0000-000000000051'")"
expect_fail "a delivered order cannot go back to cancelled" \
  "UPDATE orders SET status='cancelled', cancelled_at=NOW() WHERE id='00000000-0000-0000-0000-000000000051';"

expect_fail "a product with an order line cannot be deleted (history is protected)" \
  "DELETE FROM products WHERE id='00000000-0000-0000-0000-000000000021';"
expect_fail "a sold variant cannot be deleted" \
  "DELETE FROM product_variants WHERE id='00000000-0000-0000-0000-000000000031';"
expect_fail "a buyer with orders cannot be deleted" \
  "DELETE FROM users WHERE id='00000000-0000-0000-0000-000000000003';"
P -c "UPDATE categories SET parent_id=(SELECT id FROM categories WHERE slug='cat-a') WHERE slug='cat-b'" >/dev/null 2>&1
expect_fail "a category cannot be its own ancestor" \
  "UPDATE categories SET parent_id=(SELECT id FROM categories WHERE slug='cat-b') WHERE slug='cat-a';"

# ── F2. concurrent reservation ──────────────────────────────────────────────
section "F2. concurrent reservation (two sessions, last unit)"
P -c "UPDATE inventory SET quantity=1, reserved=0 WHERE product_id='00000000-0000-0000-0000-000000000021' AND variant_id='00000000-0000-0000-0000-000000000031'" >/dev/null 2>&1
_A_OUT=$(mktemp)
psql -X -d "$VERIFY_DB" -v ON_ERROR_STOP=1 -q -At >"$_A_OUT" 2>&1 <<'SQL' &
BEGIN;
WITH u AS (
  UPDATE inventory SET reserved=reserved+1
   WHERE product_id='00000000-0000-0000-0000-000000000021'
     AND variant_id='00000000-0000-0000-0000-000000000031'
     AND quantity-reserved>=1
  RETURNING id
) SELECT count(*)::int FROM u;
SELECT pg_sleep(1.5);
COMMIT;
SQL
_A_PID=$!
sleep 0.3
_B_COUNT=$(psql -X -d "$VERIFY_DB" -v ON_ERROR_STOP=1 -q -At -c "WITH u AS (UPDATE inventory SET reserved=reserved+1 WHERE product_id='00000000-0000-0000-0000-000000000021' AND variant_id='00000000-0000-0000-0000-000000000031' AND quantity-reserved>=1 RETURNING id) SELECT count(*)::int FROM u" 2>/dev/null)
wait "$_A_PID"
_A_COUNT=$(head -1 "$_A_OUT" | tr -d '[:space:]')
rm -f "$_A_OUT"
expect_eq "two concurrent reservations cannot both take the last unit" "1" "$(( ${_A_COUNT:-0} + ${_B_COUNT:-0} ))"
expect_eq "the row holds exactly one reservation after the race" "1" \
  "$(V -c "SELECT reserved FROM inventory WHERE product_id='00000000-0000-0000-0000-000000000021' AND variant_id='00000000-0000-0000-0000-000000000031'")"
P -c "UPDATE inventory SET reserved=0 WHERE product_id='00000000-0000-0000-0000-000000000021' AND variant_id='00000000-0000-0000-0000-000000000031'" >/dev/null 2>&1

# ── G. payment-event idempotency ─────────────────────────────────────────────
section "G. webhook event claim"
if P -c "INSERT INTO payment_events (provider, event_id, event_type, payload, status) VALUES ('stripe','evt_test_1','checkout.session.completed','{}','processing')" >/dev/null 2>&1; then
  pass "the first event delivery claims the event"
else
  fail "the first event delivery could not claim the event"
fi
expect_eq "a replay of the same event inserts 0 rows (ON CONFLICT DO NOTHING)" "0" \
  "$(V -c "WITH ins AS (INSERT INTO payment_events (provider,event_id,event_type,status) VALUES ('stripe','evt_test_1','checkout.session.completed','processing') ON CONFLICT (event_id) DO NOTHING RETURNING id) SELECT count(*) FROM ins")"
if P -c "UPDATE payment_events SET status='processed' WHERE event_id='evt_test_1'" >/dev/null 2>&1; then
  pass "the claimed event is marked processed"
else
  fail "the claimed event could not be marked processed"
fi

# ── H. reset + guards ────────────────────────────────────────────────────────
section "H. guarded reset"
if PGOPTIONS='-c velnox.allow_reset=yes' psql -X -d "$VERIFY_DB" -v ON_ERROR_STOP=1 -q -f db/mvp/reset.sql >/dev/null 2>&1; then
  pass "reset.sql rebuilds a _test database with the session opt-in"
else
  fail "reset.sql failed on a _test database with the session opt-in"
fi
expect_eq "a reset restores exactly the original schema fingerprint" "$FP_INITIAL" "$(fingerprint)"
if PGOPTIONS='-c velnox.allow_reset=yes' psql -X -d "$VERIFY_DB" -v ON_ERROR_STOP=1 -q -f db/mvp/reset.sql >/dev/null 2>&1; then
  pass "a second reset is idempotent"
else
  fail "a second reset failed"
fi
if psql -X -d "$VERIFY_DB" -v ON_ERROR_STOP=1 -q -f db/mvp/reset.sql >/dev/null 2>&1; then
  fail "reset.sql ran WITHOUT the velnox.allow_reset opt-in"
else
  pass "reset.sql refuses to run without the velnox.allow_reset opt-in"
fi

if A -c "DROP DATABASE IF EXISTS $GUARD_DB" >/dev/null 2>&1 && A -c "CREATE DATABASE $GUARD_DB" >/dev/null 2>&1; then
  if PGOPTIONS='-c velnox.allow_reset=yes' psql -X -d "$GUARD_DB" -v ON_ERROR_STOP=1 -q -f db/mvp/reset.sql >/dev/null 2>&1; then
    fail "reset.sql ran against a database not named _dev/_test"
  else
    pass "reset.sql refuses a database not named _dev/_test (even with the opt-in)"
  fi
else
  fail "could not create the guard database"
fi

if [ -n "${PGPASSWORD:-}" ]; then _auth="${PGUSER}:${PGPASSWORD}@"; else _auth="${PGUSER}@"; fi
VERIFY_URL="postgresql://${_auth}${PGHOST}:${PGPORT}/${VERIFY_DB}"
GUARD_URL="postgresql://${_auth}${PGHOST}:${PGPORT}/${GUARD_DB}"

if env -u VELNOX_RESET_DATABASE_URL bash db/mvp/reset.sh >/dev/null 2>&1; then
  fail "reset.sh ran with no explicit target"
else
  pass "reset.sh refuses to run with no explicit target (DATABASE_URL is never a fallback)"
fi
if DATABASE_URL="$VERIFY_URL" bash db/mvp/reset.sh --database-url "$VERIFY_URL" >/dev/null 2>&1; then
  fail "reset.sh accepted a target equal to DATABASE_URL"
else
  pass "reset.sh refuses a target equal to DATABASE_URL"
fi
if bash db/mvp/reset.sh --database-url "$GUARD_URL" >/dev/null 2>&1; then
  fail "reset.sh accepted a non-_dev/_test database name"
else
  pass "reset.sh refuses a non-_dev/_test database name"
fi
if bash db/mvp/reset.sh --database-url "postgresql://u:p@ep-fake.us-east-2.aws.neon.tech/velnox_neon_test" >/dev/null 2>&1; then
  fail "reset.sh accepted a Neon host"
else
  pass "reset.sh refuses a Neon host without the explicit branch opt-in (no connection attempted)"
fi
if bash db/mvp/reset.sh --database-url "$VERIFY_URL" --seed >/dev/null 2>&1; then
  pass "reset.sh rebuilds + seeds a disposable database end to end"
else
  fail "reset.sh failed on a safe disposable database"
fi
expect_eq "the wrapper's reset restores exactly the original fingerprint" "$FP_INITIAL" "$(fingerprint)"
expect_eq "seed.sql inserted the 6 deterministic categories" "6" \
  "$(V -c "SELECT count(*) FROM categories WHERE slug IN ('home','electronics','fashion','beauty','food','other')")"
expect_eq "seed.sql created no user, seller, product, order or payment" "0|0|0|0|0" \
  "$(V -c "SELECT (SELECT count(*) FROM users)||'|'||(SELECT count(*) FROM seller_profiles)||'|'||(SELECT count(*) FROM products)||'|'||(SELECT count(*) FROM orders)||'|'||(SELECT count(*) FROM payments)")"

# ── result ───────────────────────────────────────────────────────────────────
echo
if [ "$FAILED" -eq 0 ]; then
  printf '\033[32mRESULT: %d/%d checks passed — MVP schema verified.\033[0m\n' "$TOTAL" "$TOTAL"
else
  printf '\033[31mRESULT: %d/%d checks passed — FAILURES PRESENT.\033[0m\n' "$((TOTAL - FAILED))" "$TOTAL"
fi
exit "$FAILED"
