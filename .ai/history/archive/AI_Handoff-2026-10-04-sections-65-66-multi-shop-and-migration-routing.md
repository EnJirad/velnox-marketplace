# AI handoff §65–§66 — multi-shop checkout, numeric order numbers, and the wrong-database root cause

Moved **verbatim** from `.ai/AI_HANDOFF.md` on 2026-10-07 for edit-headroom housekeeping
(the current-state file was at 55.0 KB, past the ~55 KB point at which the file-edit tools
stop matching; adding §72 required room). Nothing was discarded.

**Still live from these two sections:** public order numbers are **18 digits, digits only**
(`generateOrderNumber()`, string everywhere — `orders.order_number` stays `TEXT`), one
purchase is **one `checkout_groups` row with N per-shop orders** (`orders.checkout_group_id`),
and the durable §66 finding: **migrations were reaching a different Neon database from the one
Render serves** (`NEON_DATABASE_URL` vs Render's `DATABASE_URL` — `checkout_groups` present on
one, absent on the other), which is why the owner action is to set
`NEON_PRODUCTION_DATABASE_URL` and dispatch `production-db-migrate.yml`; it is **BLOCKED**, not
PASS. Production remains **NOT READY**. Current state: §69–§72 of `.ai/AI_HANDOFF.md`.

---

## §65. Multi-shop checkout, numeric order numbers, VelRepeat V2 customer UI (2026-10-04)

Three headline goals delivered end to end.

### 54.1 Public order numbers are DIGITS ONLY

`generateOrderNumber()` (`backend/lib/order-number.ts`) now returns **18 decimal digits**
(`^[0-9]{18}$`): 14-digit ms timestamp + 4 digits from `crypto.randomInt()`. No prefix, no letters,
no separator. The value is a **string everywhere** (18 digits > `Number.MAX_SAFE_INTEGER`); the
column stays `TEXT`. Legacy `VNX-YYYYMMDD-XXXXXX` rows keep their value — the column is nullable and
`idx_orders_number_unique` is partial — and `isLegacyOrderNumber()` recognises them.
VelRepeat cycle orders now carry a public number too (savepoint retry `cycle_order_number_attempt`).

### 54.2 One purchase, N fulfillment orders

- New `checkout_groups` table; `orders.checkout_group_id`; migration
  `db/migrations/054_checkout_groups_numeric_order_number.sql` (additive, idempotent).
  **Corrected 2026-10-04 (§66): the earlier "not yet applied — Neon quota blocker" note here was
  wrong.** 054 *was* applied (Actions run `37170858966`, 2026-10-04T02:22:59Z) and the table is
  fully present — on the **wrong database**. See §66.
- `payments.checkout_group_id` is a third payment parent.
  `payments_exactly_one_parent_check` → `payments_at_least_one_parent_check` +
  `payments_single_domain_check`; `idx_payments_one_active_stripe_group` enforces one active
  session per purchase. Both canonical SQL files updated identically.
- **`POST /api/stripe/checkout` accepts `checkoutGroupId` OR `orderId`.** The group path reads the
  group through the OWNER scope, re-derives the amount from the member ORDER rows, and requires every
  member to still be payable. **The previous bug** — reconciling against ONE order's `total_amount`,
  so a 3-shop cart charged only shop A — is fixed.
- Settlement: `settleCheckoutGroup()` locks every member row FIRST
  (`lockCheckoutGroupOrderRows`, one statement, `id ASC`), writes the group payment row, then claims
  each order with the same guarded UPDATE + `commitOrderInventory` a single-order payment uses. One
  charge, N orders, one transaction. The webhook routes via `checkoutGroupIdForAttempt()`, OUTSIDE
  any transaction, so the lock-order invariant (`backend/tests/payment-cancellation-race.test.ts`)
  still holds — `settleCheckoutGroup` is now a case in that suite.
- `markPaymentSucceeded` was restored to its original single-order shape; the dispatcher is at the
  webhook call sites. This is why `late-payment-incidents.test.ts` and
  `payment-attempt-identity.test.ts` pass **unmodified**.

### 54.3 VelRepeat V2 customer UI (`/velrepeat/v2`)

New read endpoints (`backend/routes/velrepeat-v2-status.ts`): `GET /api/velrepeat/v2/packages`,
`GET /api/velrepeat/v2/plans`, `GET /api/velrepeat/v2/plans/:planId` (owner-scoped; pricing from the
FROZEN snapshot; cycles from `readPlanCycles`; per-cycle orders with shop, shipping status and
tracking). Stripe success/cancel now return to `/velrepeat/v2?velrepeat_v2_payment=…&plan=<id>`.

`apps/velshop/src/pages/VelRepeatV2Page.tsx`: package → commitment → frequency → review → draft plan →
Stripe TEST Checkout → return → server-decided status → cycles → per-shop orders (each openable, each
with its own tracking). It **never** computes an authoritative price (renders the server's frozen
figures), **never** treats the Stripe redirect as proof of payment (polls the server while it says
`draft`), and sends only `packageId` / `commitmentCycles` / `frequencyType` / `intervalValue`.
Commitment options and frequencies mirror the backend's own vocabulary.

### 54.4 Order history grouped by purchase

`checkoutGroupId` is exposed on the customer, seller and center order lists. VelShop groups the
history by it so one purchase reads as one thing with N per-shop orders underneath. VelCenter can see
the whole purchase tree; seller ownership is unchanged (`WHERE sh.seller_id = $1` still scopes it).
Tracking stays per ORDER / per SHIPMENT — never per group.

### 54.5 Tests

`backend/tests/multi-shop-checkout.test.ts` (17) covers split cases 1–4, group totals, ownership in
both directions, cross-customer refusal, one-charge/no-duplicate settlement via the real signed
webhook, stock committed once, group invisibility, and concurrent number generation.
Suite: **1908 pass / 2 skip / 0 fail** (baseline 1882/2/0).

## §66. Production `checkout_groups` 42P01 — ROOT CAUSE: migrations reach the WRONG database (2026-10-04)

**Symptom.** Real production checkout fails:
`[checkout] error: relation "checkout_groups" does not exist` / `PostgreSQL code: 42P01` /
`backend/routes/cart.ts:919`. (The route is `POST /api/customer/checkout`; the log names the
failing statement, not the path.) Line 919 of `cart.ts` at HEAD is exactly the
`INSERT INTO checkout_groups` — so Render **is** running current code.

**The migration was never missing.** Read-only probes against the Actions `NEON_DATABASE_URL`
(run `37173839460`) prove the whole 054 substrate is present there:

```
checkout_groups            | present
checkout_groups.columns    | created_at:…! currency:text! id:uuid! item_count:integer!
                            shop_count:integer! total_amount:numeric! user_id:uuid!
checkout_groups.pk         | id
checkout_groups.fk_to_users| FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
checkout_groups.indexes    | checkout_groups_pkey, idx_checkout_groups_user
orders.checkout_group_fk   | FOREIGN KEY (checkout_group_id) REFERENCES checkout_groups(id) ON DELETE SET NULL
payments.checkout_group_fk | FOREIGN KEY (checkout_group_id) REFERENCES checkout_groups(id) ON DELETE SET NULL
payments.order_id nullable | YES
payments.parent CHECKs     | payments_at_least_one_parent_check, payments_single_domain_check
schema_migrations.count    | 57   (ends … > 053 > 054_checkout_groups_numeric_order_number)
```

**Root cause — proven by data, not inferred.** That database is **not** the one Render connects
to. Identity probes (run `37174025731`) vs. the live host:

| | Actions `NEON_DATABASE_URL` | production `velnox-api.onrender.com` |
|---|---|---|
| `current_database` | `neondb` | not exposed |
| shops | **1** — `5d56f6f8…/eloop` | **2** — `26d65318…/home-tech`, `91f4b9bf…/velnox-support` |
| users/products/sellers | 3 / 1 / 1 | — |
| orders/payments | 0 / 0 | real purchases |

Disjoint sets. So **`054` was applied successfully to a database that checkout never touches**,
and every prior conclusion drawn from the Actions ledger about "production schema" is suspect.
This finally identifies the §22/§31 anomaly recorded in `payment.md`: it was never a quota
error, it was the wrong target.

**Fix — owner action, cannot be done from the agent workspace.** Create the Actions secret
`NEON_PRODUCTION_DATABASE_URL` holding the Neon connection string for the project/branch Render's
`DATABASE_URL` uses (Settings → Secrets and variables → Actions), then dispatch
`production-db-migrate.yml` once; its `schema_migrations` ledger is per-database, so it will
apply the genuinely-pending migrations (054 and any earlier ones) to production. The repo token
gets `403` on both `secrets` and `workflow_dispatch`, and the production URL exists only in
Render. **Do not** hand-apply `054` through any other route, and do not delete `checkout_groups`
usage to silence the error — the table is correct, its target is not. The in-repo half of this
fix is done: see "Canonical production DB + GitHub Actions alignment" below.

**Not verified: the live smoke test.** `POST /api/customer/checkout` returns `401` without a
`velnox_session` cookie, and no authorized test account is available here, so checkout has NOT
been observed progressing past the `checkout_groups` query in production. Verdict for this item is
**BLOCKED**, not PASS. After re-pointing the secret, verify by logging in and checking out for
real: no 42P01, one `checkout_groups` row, N orders by shop, one Stripe TEST payment, one
settlement, stock committed once per order. The full local proof is
`backend/tests/multi-shop-checkout.test.ts` (17) + `payment-cancellation-race.test.ts` +
`payment-attempt-identity.test.ts` — 1908 pass / 2 skip / 0 fail.
