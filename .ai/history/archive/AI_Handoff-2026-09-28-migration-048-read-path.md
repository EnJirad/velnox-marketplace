# AI Handoff archive — migration 048 & the checkout read path (2026-09-28)

Superseded in the handoff by §40 (the same root cause, restated with the resolution) and by
`.ai/context/payment.md`. Kept verbatim: the diagnosis of the deploy-order read path, the CI red-main
repair and the disposable-PostgreSQL verification of the fix.

---

## 37. CRITICAL — production checkout down: migration 048 never applied (2026-09-28)

**Reported.** Render: `ERROR 42703 column "payment_expires_at" does not exist` and
`[stripe] checkout error: column "payment_expires_at" does not exist` → no Checkout Session could be
created, so no sale could be paid. OAuth unaffected.

**Two independent causes — neither is "the field is in the wrong table".**

1. **Production schema is behind the code.** `Migrate Neon Database` DID fire for migration 048
   (run `36371800184`, commit `df719fe`) and **failed at its first statement**: `psql: … "ep-super-bird-
   az88b4p7-pooler…neon.tech" failed: ERROR: Your account or project has exceeded the quota.`
   (the §22 Neon quota, again). So it is absent from `schema_migrations` and never applied.
2. **The read path had no deploy-order net.** `248db45` hardened the reservation **write** and the
   **sweep**, but the **checkout read** still named the column
   (`SELECT … payment_expires_at FROM orders WHERE id = $1`) → 42703 → 500 `STRIPE_ERROR`, before the
   reservation guard could run. A missing deadline took checkout down instead of not being enforced.

**Placement verified correct, not moved.** `payments` has no expiry column; the stock reservation IS
order-keyed (`inventory_released` + the ONE release path `releaseOrderInventory(orderId)`).
`orders.payment_expires_at` is the single source of truth already agreed across schema, migration,
sweep, index and UI. No new table, column, endpoint or reservation system.

**Fix — `fix(payments): survive a database that predates the reservation columns`.**

| Piece | Change |
|---|---|
| `backend/lib/payment-reservation.ts` | NEW `selectOrderPaymentRow()` reads the deadline as `to_jsonb(o) ->> 'payment_expires_at'`: a JSON key lookup is NULL when the column is absent, so ONE statement is correct against BOTH schemas and **cannot raise** 42703. Chosen over "catch 42703 and retry" because the webhook runs inside `withTransaction` — PostgreSQL aborts a whole transaction on the first failed statement (`25P02`), so a retry would trade a broken checkout for a broken webhook. Also `warnReservationSchemaMissing()` (once per process, names migration 048) |
| `backend/routes/stripe.ts` | Checkout's order read and the webhook's non-payable-order diagnostic both go through it; nothing names the column in a statement any more |
| `backend/tests/payment-reservation-expiry.test.ts` | NEW deploy-order cases, incl. a real-DB one that shadows a column-less `orders` into a throwaway schema **inside a transaction** and proves the error is real (42703), that it poisons the transaction (25P02) and that the read survives anyway; plus the canonical-schema happy path |
| `backend/tests/customer-order-cancel.test.ts` | `reservation_expired` → `reservationExpired` (the alias became a JS variable) |
| `db/` | **No change needed** — `schema.sql` / `run-sqleditor.sql` already carry both columns + the partial index and match on those lines; `run-update.sql` still absent |

**Also repaired — pre-existing red `main`, NOT caused by this bug.** CI run `36372222449` on the
pre-fix tip already failed 6 tests this workspace reproduced exactly. `payment-reservation-expiry`'s
HTTP harness mounted neither `stripeWebhookRawBody` nor `cookieParser`, so its checkout cases answered
**401** and its webhook cases never verified a signature — they had never tested what they claimed;
both are now mounted in `server.ts`'s real order. Two `customer-order-cancel` failures were test-side
too: scenario 9's fixture never set `inventory_released` (its own premise, "markPaymentFailed already
released this stock", was unrepresentable) and scenario 11 filtered on `cancelled` — the ORDER's state,
which scenario 10 pins as `true` for a cancel that moved nothing — instead of `alreadyFinal`. Stock had
in fact been released exactly once in both.

**Verification (executed here).** Disposable PostgreSQL bootstrapped from `db/run-sqleditor.sql`, then
`psql --single-transaction -f db/migrations/048_payment_reservation.sql` + a `schema_migrations` row
(mirroring the workflow): full backend suite **911 pass / 2 skip / 0 fail** (913, 41 files); the two
touched suites **83 pass / 0 fail**; backend `tsc` 0; `typecheck` 4/4; `i18n:check` th=en=my=1338;
`git diff --check` clean. The local DB was still pre-migration when the fix first ran and the new tests
passed against it, i.e. the read genuinely survives the schema production is in today.

**OWNER ACTION — production schema (BLOCKED for an agent).** `gh workflow run migrate-neon.yml` →
**403 `Resource not accessible by integration`** (the GitHub App has no `actions: write`). Either
**Actions → Migrate Neon Database → Run workflow** with `migration_file = 048_payment_reservation.sql`
(clear the quota of `36371800184` first), **or** in the Neon SQL Editor:

```sql
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_expires_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS reservation_policy JSONB;
CREATE INDEX IF NOT EXISTS idx_orders_payment_expires_at
  ON orders (payment_expires_at) WHERE payment_expires_at IS NOT NULL;
INSERT INTO schema_migrations (migration_name)
  VALUES ('048_payment_reservation') ON CONFLICT (migration_name) DO NOTHING;
```

Additive, nullable, no backfill, no rewrite; existing orders keep `NULL` (= "no window", exactly what
the sweep ignores). Until applied the reservation feature is inert — but checkout works.

**Still open.** Production schema unverified from an agent (no credentials; `diag-neon-schema.yml`
cannot be dispatched for the same 403) — **do not report the column as verified until an owner read
confirms it**. Stripe TEST E2E still BLOCKED (§16/§18). The 15/20/30/45/60 min windows come from the
policy service; none is hard-coded in a route.

**Verified here.** NEW `payment-reservation-policy.test.ts` **26 pass/0 fail** (the full risk
table, MIN/MAX clamps over every signal combination, determinism, JSONB round trip, the
42703-only tolerance) · NEW `payment-reservation-expiry.test.ts` **23 pass / 16 skip / 0 fail**
(countdown + i18n + wiring + source contracts; the 16 skips are the `TEST_DATABASE_URL`-gated
expiry/concurrency/webhook/savepoint cases; `payment-reservation` both files = 49 pass/16 skip) ·
full backend suite **788 pass / 118 skip / 0 fail** (906 tests, 41 files; was 732/107/839)
· `checkout-payment-flow.test.ts` 38 pass / 4 skip (shapes updated for the additive `expired`
field) · backend `tsc` 0 · `typecheck` 4/4 · `build:apps` 4/4 · `i18n:check` 1338 · `diff
db/schema.sql db/run-sqleditor.sql` identical · `git diff --check` clean.

**NOT verified here (owner-side).** (1) The 15 DB-gated cases need `TEST_DATABASE_URL` or CI
(`.github/workflows/test.yml` provisions `postgres:16` and bootstraps `db/run-sqleditor.sql`);
apply migration `048` to production (Neon SQL Editor) **before** the backend that writes the
column deploys. (2) A browser pass on the countdown and the expired notice (th/en/my). (3) No real
Stripe delivery was reproduced here, so the "late payment after expiry → manual refund" path is
proven at the state level in tests, not against a live charge.

---
