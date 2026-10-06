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
# Needs psql and a PostgreSQL you may create databases on. The connection is
# derived from TEST_DATABASE_URL when that is set — so a CI job that provisions
# its own disposable cluster verifies against the SAME cluster it tests against,
# rather than against a hard-coded pair of credentials that happen to work on one
# machine and fail on another. Explicit PGHOST/PGPORT/PGUSER/PGPASSWORD or
# VELNOX_VERIFY_ADMIN_DB still win over both.
#
# EXIT STATUS
# -----------
# 0 only when every scenario passed. It never reports success it did not observe.
# ============================================================================
set -u

# Explicit settings, captured before the defaults are applied, so "the operator
# asked for this" and "this is a fallback" stay distinguishable.
_ADMIN_DB_SET="${VELNOX_VERIFY_ADMIN_DB:-}"
_PGUSER_SET="${PGUSER:-}"
_PGPASSWORD_SET="${PGPASSWORD:-}"
_PGHOST_SET="${PGHOST:-}"
_PGPORT_SET="${PGPORT:-}"

ADMIN_DB="${_ADMIN_DB_SET:-velnox_test}"
PGUSER="${_PGUSER_SET:-velnox_test}"
export PGPASSWORD="${_PGPASSWORD_SET:-velnox_test}"
PGHOST="${_PGHOST_SET:-127.0.0.1}"
PGPORT="${_PGPORT_SET:-5432}"

# Derive from TEST_DATABASE_URL only when nothing was set explicitly. The URL is
# parsed into the individual PG* variables here and is never echoed, printed or
# written anywhere: a connection string embeds the password.
if [ -n "${TEST_DATABASE_URL:-}" ] \
   && [ -z "$_ADMIN_DB_SET" ] && [ -z "$_PGUSER_SET" ] \
   && [ -z "$_PGPASSWORD_SET" ] && [ -z "$_PGHOST_SET" ] && [ -z "$_PGPORT_SET" ]; then
  _v_url="${TEST_DATABASE_URL%%\?*}"                 # drop ?sslmode=… and friends
  _v_creds="${_v_url#*://}"
  if [ "$_v_creds" != "$_v_url" ] && [ "${_v_creds#*@}" != "$_v_creds" ]; then
    _v_userinfo="${_v_creds%@*}"                    # user:password
    _v_hostpath="${_v_creds##*@}"                   # host[:port]/database
    _v_hostport="${_v_hostpath%%/*}"
    PGUSER="${_v_userinfo%%:*}"
    export PGPASSWORD="${_v_userinfo#*:}"
    PGHOST="${_v_hostport%%:*}"
    if [ "${_v_hostport##*:}" != "$_v_hostport" ]; then
      PGPORT="${_v_hostport##*:}"
    fi
    _v_db="${_v_hostpath#*/}"
    if [ -n "$_v_db" ]; then
      ADMIN_DB="${_v_db%%/*}"
    fi
  fi
  unset _v_url _v_creds _v_userinfo _v_hostpath _v_hostport _v_db
fi

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
# tables|indexes|constraints|columns. Migration 055 (a grouped purchase's refund
# has a parent) grew the canonical schema by exactly: 1 column
# (`refunds.checkout_group_id`), 1 index (`idx_refunds_checkout_group`), and 3
# constraints (`refunds_checkout_group_id_fkey`, `refunds_parent_check`,
# `payments_status_check`). Re-measured on a fresh run of db/run-sqleditor.sql.
CANON="66|244|258|653"
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

# ── H. The REPORTED incident, end to end, on a database with real payments ─
section "H. REPORTED INCIDENT — payments rows exist, payments.checkout_group_id missing"
# This is the 2026-10-04 production failure reproduced exactly:
#   SELECT checkout_group_id FROM payments
#    WHERE checkout_group_id IS NOT NULL
#      AND (provider_checkout_session_id = \$1 OR provider_payment_id = \$2)
#    LIMIT 1
# → ERROR 42703  column "checkout_group_id" does not exist
#
# The 42703 comes from checkoutGroupIdForAttempt() (backend/routes/stripe.ts),
# the statement that routes a webhook event to the group settlement path. Note
# that `payments` IS in its FROM list — PostgreSQL still emits the same message
# when the table itself lacks the column, which is what made this misdiagnosed
# twice as "the deployed build is stale". So the proof here is behavioural: the
# statement must fail BEFORE and succeed AFTER, with the rows preserved.
DB=velnox_verify_prod
fresh_db "$DB"
q "$DB" -q -f "$FILE" >/dev/null 2>&1

# A realistic production state: orders, a checkout group, real Stripe payment
# rows carrying provider ids — then the column removed out from under them.
q "$DB" -q >/dev/null 2>&1 <<'SQL'
INSERT INTO users (id, email, name) VALUES ('dddddddd-0000-4000-8000-000000000001','prod@example.test','Prod');
INSERT INTO checkout_groups (id, user_id, total_amount, item_count, shop_count)
  VALUES ('dddddddd-0000-4000-8000-0000000000a1','dddddddd-0000-4000-8000-000000000001',500.00,3,2);
INSERT INTO orders (id, user_id, order_number, status, total_amount)
  VALUES ('dddddddd-0000-4000-8000-0000000000b1','dddddddd-0000-4000-8000-000000000001','180000000000000001','pending',250.00);
INSERT INTO payments (order_id, amount, currency, method, status, provider, provider_checkout_session_id, provider_payment_id)
  VALUES ('dddddddd-0000-4000-8000-0000000000b1',500.00,'THB','stripe','paid','stripe','cs_prod_live_1','pi_prod_live_1');
DROP INDEX IF EXISTS idx_payments_checkout_group;
DROP INDEX IF EXISTS idx_payments_one_active_stripe_group;
ALTER TABLE public.payments DROP COLUMN IF EXISTS checkout_group_id;
SQL
eq "fixture really holds the production payment row" "$(t "$DB" "select count(*) from payments where provider_checkout_session_id='cs_prod_live_1'")" "1"
eq "fixture really lacks payments.checkout_group_id" "$(t "$DB" "select count(*) from information_schema.columns where table_schema='public' and table_name='payments' and column_name='checkout_group_id'")" "0"

# The production statement, verbatim apart from the bound values.
PROD_LOOKUP="SELECT checkout_group_id FROM payments WHERE checkout_group_id IS NOT NULL AND (provider_checkout_session_id = 'cs_prod_live_1' OR provider_payment_id = 'pi_prod_live_1') LIMIT 1"

BEFORE=$(q "$DB" -tAc "$PROD_LOOKUP" 2>&1 | tr -d ' ')
case "$BEFORE" in
  *42703*|*'"checkout_group_id"'*) pass "before: the reported 42703 reproduces ($BEFORE)" ;;
  *) fail "before: expected 42703, got [$BEFORE]" ;;
esac

PAY_BEFORE=$(t "$DB" "select count(*) from payments")
q "$DB" -q -f "$FILE" >/tmp/velnox_verify_prod.log 2>&1 && pass "whole file executed over the populated database, exit=0" || { fail "exit=$?"; grep -n ERROR /tmp/velnox_verify_prod.log | head -3; }

AFTER=$(q "$DB" -tAc "$PROD_LOOKUP" 2>&1 | tr -d ' ')
case "$AFTER" in
  *42703*|*'"checkout_group_id"'*) fail "after: the production statement still raises 42703 [$AFTER]" ;;
  *) pass "after: the production statement runs clean (single-order payment, no group, 0 rows)" ;;
esac
eq "the real payment row survived (not recreated, not reset)" "$(t "$DB" "select count(*) from payments")" "$PAY_BEFORE"
eq "its provider ids are untouched" "$(t "$DB" "select provider_checkout_session_id from payments limit 1")" "cs_prod_live_1"
eq "it is still paid (settlement state preserved)" "$(t "$DB" "select status from payments limit 1")" "paid"
eq "the single-order payment was not re-pointed at the group" "$(t "$DB" "select count(*) from payments where checkout_group_id is null")" "1"

# The real webhook case, once the schema is reconciled: a GROUP payment row,
# which is exactly what checkoutGroupIdForAttempt() exists to find and route.
q "$DB" -q >/dev/null 2>&1 -c "INSERT INTO payments (order_id, checkout_group_id, amount, currency, method, status, provider, provider_checkout_session_id, provider_payment_id) VALUES (NULL, (SELECT id FROM checkout_groups LIMIT 1), 500.00, 'THB', 'stripe', 'pending', 'stripe', 'cs_prod_group_1', 'pi_prod_group_1');"
eq "after: the statement resolves the group payment it exists to route" \
   "$(t "$DB" "SELECT checkout_group_id FROM payments WHERE checkout_group_id IS NOT NULL AND (provider_checkout_session_id = 'cs_prod_group_1' OR provider_payment_id = 'pi_prod_group_1') LIMIT 1")" \
   "dddddddd-0000-4000-8000-0000000000a1"

# ── I. The PART 8 assertion is not vacuous ────────────────────────────────
section "I. The assertion really fails when the shape is wrong"
# A green PART 8 must MEAN reconciled. Two ways it could pass a name-only check
# while the payment path still breaks:
#   • the column exists under the WRONG TYPE — and `ADD COLUMN IF NOT EXISTS`
#     is a no-op in exactly that case, so the run cannot fix it either;
#   • the foreign key has the right NAME but the wrong ON DELETE rule.
# Extract ONLY the PART 8 assertion block. Anchoring on `^DO $$` would grab the
# file from the FIRST anonymous block — the extension and DDL section — so the
# "assertion" under test would be the whole reconciler and every result below
# would be meaningless. Walk back from the assertion's own RAISE line to the
# nearest preceding `DO $$` instead.
P8_LINE=$(grep -n "run-sqleditor.sql finished but these objects" "$FILE" | head -1 | cut -d: -f1)
P8_START=$(head -n "$P8_LINE" "$FILE" | grep -n '^DO \$\$$' | tail -1 | cut -d: -f1)
[ -n "$P8_START" ] || { echo "cannot locate the PART 8 assertion block in $FILE"; exit 2; }
tail -n +"$P8_START" "$FILE" >/tmp/velnox_part8.sql
q "$DB" -q -f /tmp/velnox_part8.sql >/tmp/velnox_part8_ok.log 2>&1 && pass "PART 8 passes on a reconciled database (exit=0)" || { fail "PART 8 failed on a reconciled database"; head -3 /tmp/velnox_part8_ok.log; }

q "$DB" -q >/dev/null 2>&1 <<'SQL'
-- The FK depends on the column, so it must go first. Both indexes are removed
-- and rebuilt by the reconciler, so the ONLY defect left is the TYPE.
DROP INDEX IF EXISTS idx_payments_checkout_group;
DROP INDEX IF EXISTS idx_payments_one_active_stripe_group;
ALTER TABLE public.payments DROP CONSTRAINT payments_checkout_group_id_fkey;
ALTER TABLE public.payments DROP COLUMN checkout_group_id;
ALTER TABLE public.payments ADD COLUMN checkout_group_id TEXT;
SQL
q "$DB" -q -f /tmp/velnox_part8.sql >/tmp/velnox_part8_type.log 2>&1 && fail "PART 8 passed a WRONG-TYPED column" || {
  grep -q 'payments.checkout_group_id (uuid)' /tmp/velnox_part8_type.log && pass "PART 8 rejects a wrong-typed column and names it" || fail "PART 8 failed, but not on the type: $(grep -m1 ERROR /tmp/velnox_part8_type.log)"
}
# The run must not have been able to fix it either — which is the whole point:
# `ADD COLUMN IF NOT EXISTS <name> <type>` is a no-op for a same-named column.
q "$DB" -q -f "$FILE" >/dev/null 2>&1
eq "a second full run does NOT silently bless the wrong type" "$(t "$DB" "select data_type from information_schema.columns where table_schema='public' and table_name='payments' and column_name='checkout_group_id'")" "text"
q "$DB" -q >/dev/null 2>&1 <<'SQL'
-- Back to a good state, from which the delete rule is the only defect.
ALTER TABLE public.payments DROP COLUMN checkout_group_id;
ALTER TABLE public.payments ADD COLUMN checkout_group_id UUID;
SQL
q "$DB" -q -f "$FILE" >/dev/null 2>&1
q "$DB" -q >/dev/null 2>&1 <<'SQL'
ALTER TABLE public.payments DROP CONSTRAINT payments_checkout_group_id_fkey;
ALTER TABLE public.payments ADD CONSTRAINT payments_checkout_group_id_fkey
  FOREIGN KEY (checkout_group_id) REFERENCES checkout_groups(id) ON DELETE CASCADE;
SQL
eq "fixture really has the wrong ON DELETE rule" "$(t "$DB" "select confdeltype from pg_constraint where conname='payments_checkout_group_id_fkey'")" "c"
q "$DB" -q -f /tmp/velnox_part8.sql >/tmp/velnox_part8_fk.log 2>&1 && fail "PART 8 passed a CASCADE foreign key" || {
  grep -q 'payments_checkout_group_id_fkey (-> checkout_groups ON DELETE SET NULL)' /tmp/velnox_part8_fk.log && pass "PART 8 rejects the wrong ON DELETE rule and names it" || fail "PART 8 failed, but not on the delete rule: $(grep -m1 ERROR /tmp/velnox_part8_fk.log)"
}
q "$DB" -q -f "$FILE" >/dev/null 2>&1

# ── cleanup ───────────────────────────────────────────────────────────────
for d in velnox_verify_fresh velnox_verify_reported velnox_verify_legacy velnox_verify_path velnox_verify_prod; do
  adminsql -q -c "DROP DATABASE IF EXISTS $d" >/dev/null 2>&1
done

printf '\n'
if [ "$FAILED" -eq 0 ]; then
  printf '\033[32mRECONCILER PROOF: ALL SCENARIOS PASSED\033[0m\n'; exit 0
else
  printf '\033[31mRECONCILER PROOF: FAILURES PRESENT\033[0m\n'; exit 1
fi