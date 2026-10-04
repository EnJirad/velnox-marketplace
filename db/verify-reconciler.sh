#!/usr/bin/env bash
# ============================================================================
# db/run-sqleditor.sql — reconciliation proof
# ============================================================================
# WHY THIS EXISTS
# ---------------
# The unit suite (backend/tests/db-run-sqleditor-reconciler.test.ts) proves the
# FILE is correct by reading it. This proves the file BEHAVES, by running it
# against real databases built to the shapes production is actually in.
#
# The incident this exists for: production had `checkout_groups` but was missing
# `orders.checkout_group_id`, so checkout failed with
#   column "checkout_group_id" of relation "orders" does not exist
# That is the "REPORTED SHAPE" scenario below, and it is the one that matters.
#
# USAGE
# -----
#   bash db/verify-reconciler.sh
#
# Needs psql and a PostgreSQL you may create databases on. Override the
# connection with PGHOST/PGPORT/PGUSER/PGPASSWORD, or by exporting
# VELNOX_VERIFY_ADMIN_DB (defaults to velnox_test).
#
# EXIT STATUS
# -----------
# 0 only when every scenario passed. It never reports success it did not observe.
# ============================================================================
set -u

ADMIN_DB="${VELNOX_VERIFY_ADMIN_DB:-velnox_test}"
PGUSER="${PGUSER:-velnox_test}"
export PGPASSWORD="${PGPASSWORD:-velnox_test}"
PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5432}"
FILE="db/run-sqleditor.sql"

FAILED=0
pass() { printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; FAILED=1; }
section() { printf '\n\033[1m%s\033[0m\n' "$1"; }

adminsql() { psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$ADMIN_DB" -v ON_ERROR_STOP=1 "$@"; }
fresh_db() {  # $1 = name; drops and recreates
  adminsql -q -c "DROP DATABASE IF EXISTS $1" -c "CREATE DATABASE $1" >/dev/null 2>&1
}
q() { psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$1" -v ON_ERROR_STOP=1 "${@:2}"; }
t() { q "$1" -tAc "$2"; }
eq() { if [ "$2" = "$3" ]; then pass "$1 ($2)"; else fail "$1: expected [$3] got [$2]"; fi; }

[ -f "$FILE" ] || { echo "cannot find $FILE — run this from the repository root"; exit 2; }
command -v psql >/dev/null || { echo "psql is required"; exit 2; }

echo "Reconciler proof against $(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$ADMIN_DB" -tAc 'select version()' 2>/dev/null | cut -c1-40)"

# The canonical object counts a fresh, fully reconciled database must have.
CANON="66|243|255|652"
counts() { t "$1" "select (select count(*) from information_schema.tables where table_schema='public')||'|'||(select count(*) from pg_indexes where schemaname='public')||'|'||(select count(*) from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public')||'|'||(select count(*) from information_schema.columns where table_schema='public')"; }

# ── A. Fresh schema ────────────────────────────────────────────────────────
section "A. Fresh database, run three times"
DB=velnox_verify_fresh
fresh_db "$DB"
PREV=""
for n in 1 2 3; do
  if q "$DB" -q -f "$FILE" >/tmp/velnox_verify_$n.log 2>&1; then pass "run #$n exit=0"; else
    fail "run #$n exit=$?"; grep -n ERROR /tmp/velnox_verify_$n.log | head -3; break
  fi
  C=$(counts "$DB")
  [ -n "$PREV" ] && eq "counts unchanged between runs" "$C" "$PREV"
  PREV=$C
done
eq "object counts match the canonical schema" "$PREV" "$CANON"
eq "trigger exists exactly once (never duplicated)" "$(t "$DB" "select count(*) from pg_trigger where tgname='trg_prevent_circular_category_parent' and not tgisinternal")" "1"

# ── B. Reported production shape: checkout_groups present, column MISSING ───
section "B. REPORTED SHAPE — checkout_groups exists, orders.checkout_group_id missing"
DB=velnox_verify_reported
fresh_db "$DB"
q "$DB" -q -f "$FILE" >/dev/null 2>&1
q "$DB" -q >/dev/null 2>&1 <<'SQL'
DROP INDEX IF EXISTS idx_payments_checkout_group;
DROP INDEX IF EXISTS idx_payments_one_active_stripe_group;
DROP INDEX IF EXISTS idx_orders_checkout_group;
ALTER TABLE public.payments DROP COLUMN IF EXISTS checkout_group_id;
ALTER TABLE public.orders   DROP COLUMN IF EXISTS checkout_group_id;
SQL
eq "fixture really lacks orders.checkout_group_id"   "$(t "$DB" "select count(*) from information_schema.columns where table_schema='public' and table_name='orders' and column_name='checkout_group_id'")" "0"
eq "fixture really lacks payments.checkout_group_id" "$(t "$DB" "select count(*) from information_schema.columns where table_schema='public' and table_name='payments' and column_name='checkout_group_id'")" "0"
eq "fixture really has checkout_groups"              "$(t "$DB" "select count(*) from information_schema.tables where table_schema='public' and table_name='checkout_groups'")" "1"
q "$DB" -q -f "$FILE" >/tmp/velnox_verify_reported.log 2>&1 && pass "whole file executed, exit=0" || { fail "exit=$?"; grep -n ERROR /tmp/velnox_verify_reported.log | head -3; }
eq "orders.checkout_group_id reconciled to uuid"   "$(t "$DB" "select data_type from information_schema.columns where table_schema='public' and table_name='orders' and column_name='checkout_group_id'")" "uuid"
eq "payments.checkout_group_id reconciled to uuid" "$(t "$DB" "select data_type from information_schema.columns where table_schema='public' and table_name='payments' and column_name='checkout_group_id'")" "uuid"
for ix in idx_checkout_groups_user idx_orders_checkout_group idx_payments_checkout_group idx_payments_one_active_stripe_group; do
  eq "index $ix present" "$(t "$DB" "select count(*) from pg_indexes where schemaname='public' and indexname='$ix'")" "1"
done
for fk in orders_checkout_group_id_fkey payments_checkout_group_id_fkey; do
  eq "foreign key $fk present" "$(t "$DB" "select count(*) from pg_constraint where conname='$fk'")" "1"
done

# ── C. Legacy database: no checkout_groups at all ──────────────────────────
section "C. Legacy database — no checkout_groups, no group columns"
DB=velnox_verify_legacy
fresh_db "$DB"
q "$DB" -q -f "$FILE" >/dev/null 2>&1
q "$DB" -q >/dev/null 2>&1 <<'SQL'
DROP INDEX IF EXISTS idx_payments_checkout_group;
DROP INDEX IF EXISTS idx_payments_one_active_stripe_group;
DROP INDEX IF EXISTS idx_orders_checkout_group;
DROP INDEX IF EXISTS idx_checkout_groups_user;
ALTER TABLE public.payments DROP COLUMN IF EXISTS checkout_group_id;
ALTER TABLE public.orders   DROP COLUMN IF EXISTS checkout_group_id;
DROP TABLE IF EXISTS public.checkout_groups;
SQL
q "$DB" -q -f "$FILE" >/tmp/velnox_verify_legacy.log 2>&1 && pass "whole file executed, exit=0" || { fail "exit=$?"; grep -n ERROR /tmp/velnox_verify_legacy.log | head -3; }
eq "checkout_groups CREATED"    "$(t "$DB" "select count(*) from information_schema.tables where table_schema='public' and table_name='checkout_groups'")" "1"
eq "orders.checkout_group_id ADDED"   "$(t "$DB" "select count(*) from information_schema.columns where table_schema='public' and table_name='orders' and column_name='checkout_group_id'")" "1"
eq "payments.checkout_group_id ADDED" "$(t "$DB" "select count(*) from information_schema.columns where table_schema='public' and table_name='payments' and column_name='checkout_group_id'")" "1"
eq "converged on the canonical object counts" "$(counts "$DB")" "$CANON"

# ── D. Already current, run twice ─────────────────────────────────────────
section "D. Already-current database, run twice more"
DB=velnox_verify_fresh
for n in 1 2; do
  q "$DB" -q -f "$FILE" >/tmp/velnox_verify_d$n.log 2>&1 && pass "rerun #$n exit=0" || { fail "rerun #$n exit=$?"; grep -n ERROR /tmp/velnox_verify_d$n.log | head -3; }
done
eq "no duplicates: counts unchanged" "$(counts "$DB")" "$CANON"

# ── E. Data preservation ──────────────────────────────────────────────────
section "E. Existing rows survive reconciliation"
DB=velnox_verify_reported
q "$DB" -q >/dev/null 2>&1 <<'SQL'
INSERT INTO users (id, email, name, role) VALUES ('11111111-1111-4111-8111-111111111111','keep@example.com','Keep Me','customer') ON CONFLICT (id) DO NOTHING;
INSERT INTO sellers (id, user_id, status, verification_status) VALUES ('22222222-2222-4222-8222-222222222222',(SELECT id FROM users WHERE email='keep@example.com'),'approved','verified') ON CONFLICT (id) DO NOTHING;
INSERT INTO shops (id, seller_id, name, slug) VALUES ('33333333-3333-4333-8333-333333333333',(SELECT id FROM sellers WHERE id='22222222-2222-4222-8222-222222222222'),'Keep Shop','keep-shop') ON CONFLICT (id) DO NOTHING;
INSERT INTO orders (id, user_id, shop_id, order_number, status, subtotal, total_amount, notes) VALUES ('44444444-4444-4444-8444-444444444444',(SELECT id FROM users WHERE email='keep@example.com'),(SELECT id FROM shops WHERE slug='keep-shop'),'VNX-20200101-000042','completed',99.00,99.00,'must survive') ON CONFLICT (id) DO NOTHING;
SQL
BEFORE=$(t "$DB" "select md5(string_agg(t::text,'|' order by id)) from (select id, user_id, shop_id, order_number, status, subtotal, total_amount, notes from orders) t")
COUNT_BEFORE=$(t "$DB" "select count(*) from orders")
q "$DB" -q -f "$FILE" >/dev/null 2>&1 && pass "file executed over populated tables, exit=0" || fail "exit=$?"
eq "order count unchanged"   "$(t "$DB" "select count(*) from orders")" "$COUNT_BEFORE"
eq "order rows byte-identical" "$(t "$DB" "select md5(string_agg(t::text,'|' order by id)) from (select id, user_id, shop_id, order_number, status, subtotal, total_amount, notes from orders) t")" "$BEFORE"
eq "historic order number preserved verbatim" "$(t "$DB" "select order_number from orders where id='44444444-4444-4444-8444-444444444444'")" "VNX-20200101-000042"

# ── F. A group purchase is actually accepted afterwards ────────────────────
section "F. A single payment can cover several per-shop orders"
q "$DB" -q >/dev/null 2>&1 <<'SQL'
INSERT INTO checkout_groups (user_id, total_amount, currency, item_count, shop_count) SELECT id, 99.00, 'THB', 2, 2 FROM users WHERE email='keep@example.com';
UPDATE orders SET checkout_group_id = (SELECT id FROM checkout_groups LIMIT 1) WHERE notes = 'must survive';
INSERT INTO payments (order_id, checkout_group_id, amount, currency, method, status, provider) VALUES (NULL, (SELECT id FROM checkout_groups LIMIT 1), 99.00, 'THB', 'stripe', 'pending', 'stripe');
SQL
[ $? -eq 0 ] && pass "one payment with order_id NULL and a checkout_group_id is accepted" || fail "the group payment was rejected — the reconciliation is incomplete"

# ── G. A hostile search_path cannot redirect the run ───────────────────────
section "G. A decoy schema earlier in search_path is not written to"
DB=velnox_verify_path
fresh_db "$DB"
q "$DB" -q >/dev/null 2>&1 -c "CREATE SCHEMA decoy; CREATE TABLE decoy.orders (id int, note text); INSERT INTO decoy.orders VALUES (1,'must not be touched');"
q "$DB" -q -c "SET search_path = decoy, public;" -f "$FILE" >/tmp/velnox_verify_path.log 2>&1 && pass "file executed with search_path=decoy,public, exit=0" || { fail "exit=$?"; grep -n ERROR /tmp/velnox_verify_path.log | head -3; }
eq "tables landed in public" "$(t "$DB" "select count(*) from information_schema.tables where table_schema='public'")" "66"
eq "the decoy orders table was not altered" "$(t "$DB" "select count(*) from information_schema.columns where table_schema='decoy' and table_name='orders' and column_name='checkout_group_id'")" "0"
eq "the decoy row is intact" "$(t "$DB" "select note from decoy.orders")" "must not be touched"

# ── cleanup ───────────────────────────────────────────────────────────────
for d in velnox_verify_fresh velnox_verify_reported velnox_verify_legacy velnox_verify_path; do
  adminsql -q -c "DROP DATABASE IF EXISTS $d" >/dev/null 2>&1
done

printf '\n'
if [ "$FAILED" -eq 0 ]; then
  printf '\033[32mRECONCILER PROOF: ALL SCENARIOS PASSED\033[0m\n'; exit 0
else
  printf '\033[31mRECONCILER PROOF: FAILURES PRESENT\033[0m\n'; exit 1
fi