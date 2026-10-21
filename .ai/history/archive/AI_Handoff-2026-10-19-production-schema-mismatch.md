# Archived handoff section — production schema mismatch (2026-10-19)

Moved verbatim from `.ai/AI_HANDOFF.md` on 2026-10-21 while adding §88 (Phase 3c),
to keep the current-state file under its edit ceiling. Pre-MVP history: the MVP
schema/cutover supersedes the object-level repair described here, and the durable
rules (`42703` cannot prove which database you are on; verification never repairs)
live in [`.ai/context/database.md`](../../context/database.md).

---

## §82. Production schema mismatch — `product_selling_units` + `orders.order_state` (2026-10-19)

**Reported from Render logs:** `42P01 relation "product_selling_units" does not exist` and
`42703 column "order_state" of relation "orders" does not exist` (thrown by
`routes/cart.ts#insertOrderWithUniqueNumber`, whose INSERT names `order_state`).

**ROOT CAUSE — Case A/D (migration exists, production is behind).** Both objects are declared in
both canonical files and by migrations `056` (the order axes, with the 9b backfill) and `058`/`059`
(selling units, `is_wholesale`). Nothing in the code or schema was missing. Production simply never
received them. `production-db-migrate.yml` hard-stops when `NEON_PRODUCTION_DATABASE_URL` is absent,
and this workspace has **no database env at all** (`freebuff-env list` → `{}`), so the ledger could
not be read either. The database identity must be confirmed before applying anything (§66: the two
Neons).

**REPO-SIDE DEFECT FOUND while proving the repair — and fixed.** `db/run-sqleditor.sql` (the
documented production repair path) added `orders.order_state` / `fulfillment_status`, set their
defaults, then guarded `SET NOT NULL` on "no NULL remains" — but the **9b backfill was missing**, even
though the comment above it said "Section 9b backfills". Consequence on a database with history:
the run exits 0, the two columns stay **nullable and NULL for every pre-056 order**, and the
projection reads a shipped order back as `pending`. `db/schema.sql` carried the same omission, so the
snapshot and the reconciler agreed with each other and disagreed with migration 056. Both now carry
`056`'s exact `CASE status …` backfill (statement-identical, `WHERE … IS NULL`, rerunnable).

**Verification workflow was blind to the incident.** `production-db-verify.yml` probed only the
checkout-group objects, so it would have gone green on this exact database. It now has three
read-only probes: `product_selling_units` (11 columns, `is_wholesale` NOT NULL DEFAULT false —
wholesale stays fail-closed), both order axes NOT NULL with the canonical defaults, and the six
`cart_items`/`order_items` snapshot columns. Proved non-vacuous: 3 FAILs on the reported shape,
PASS after repair.

**Proof (disposable PostgreSQL 14, real databases):**

| Check | Result |
|---|---|
| Reported 42P01 + 42703 reproduced on a production-shaped DB | **reproduced**, then gone after one reconciler run |
| `bash db/verify-reconciler.sh` (now scenarios A-J) | **ALL SCENARIOS PASSED** — new **J** seeds 6 legacy orders, strips both objects, asserts the exact errors, then asserts backfill `processing/shipped, completed/delivered, pending/unfulfilled, cancelled/cancelled, processing/delivered, processing/packing`, NOT NULL, CHECK, index, 11 columns, 4 indexes, 4 FKs, 6 snapshot columns, and that no order id/status changed |
| Repaired-DB checkout surface (`selling-units`, `checkout-payment-flow`, `multi-shop-checkout`, `cart-selection`, `order-state-projection`, `customer-order-cancel`, `order-fulfillment-state-machine`, `payment-reservation-expiry`) | **272 pass / 0 fail** |
| `bun test backend/tests` (fresh canonical DB) | **2147 pass / 16 skip / 0 fail** — 2163 tests, 75 files |
| `bun run typecheck` 4/4 + `tsc -p backend` | exit 0 |
| `bun run build:apps` | 4/4 exit 0 |
| `git diff --check` | clean |

**NOT applied to production — BLOCKED.** No production credential exists here, and the hard-stop rule
forbids inventing one. Owner action, **in this order**:

1. Set `NEON_PRODUCTION_DATABASE_URL` to the SAME Neon Render's `DATABASE_URL` uses, and confirm the
   identity (`[db]` boot line vs `current_database()`).
2. Run **`db/run-sqleditor.sql` once** against that Neon (SQL Editor is fine). This is the proven
   path for the reported shape: scenario J starts from "table missing + column missing + real
   orders" and converges additively, but scenarios **C** and **H** already prove the older
   shapes too.
3. Run **Actions → Production DB Verify**; it now fails loudly if either object (or the backfilled
   NOT NULL axes) is still missing.
4. Use **Production DB Migrate** for *future* migrations, not as the first repair. Measured this
   pass: `db/migrations/056_commerce_core_invariants.sql:178` declares
   `purchase_id UUID REFERENCES checkout_groups(id)` and 056 **exits 3** when `checkout_groups` is
   absent (`relation "checkout_groups" does not exist`) — while the workflow skips any migration
   the ledger already records. On a database whose ledger claims 054 but lacks the table (§66), the
   migration path alone would fail exactly there.

No destructive statement, no data deletion, no payment/inventory/checkout change, and
wholesale/VelRepeat stay parked in this work.

**PERF-1 — separate issue, recorded only, deliberately NOT optimised in this fix.** From the same
Render log as the 42703: statement latencies of **~198-215 ms** on `product_images`,
`product_variant_images`, `cart`, `addresses`, `revoked_tokens`, `orders`; intermittent **pool
acquisition ~1203 ms** (checkout waits behind the scheduler); and the payment-reservation worker
re-scanning every ~30 s with
`SELECT id FROM orders WHERE payment_expires_at IS NOT NULL AND payment_expires_at <= NOW() AND status = ANY($2::text[]) AND inventory_released = FALSE`.
P0 stayed "checkout cannot create an order"; changing indexes/queries/pool size in the same pass would
have made the schema repair unverifiable. Needs its own task, measured before/after.

---
