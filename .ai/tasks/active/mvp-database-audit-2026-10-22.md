# CLEAN MVP DATABASE — AUDIT, ROOT CAUSE AND VERIFICATION (2026-10-22)

**Request:** rebuild the Velnox database so the MVP contains only BUY + SELL + CONTROL,
with VelRepeat and every other non-MVP concept removed, and repair the
`orders.order_state` / cart schema errors at the root instead of adding columns.

**Verdict:** the canonical MVP schema (`db/mvp/schema.sql`) **already is** the requested
clean rebuild — 20 tables, one order axis, one stock authority, no VelRepeat, no
`order_state`, `NUMERIC(12,2)` money — and it was re-proven this pass on a real
PostgreSQL 14 (93/93 schema checks, 113/113 MVP API tests). What is **not** done, and
cannot be done from this workspace, is the **cutover**: the deployed service still reads
the frozen 77-table pre-MVP schema, and no production credential exists here. The
`order_state` error is a **database-behind-code** incident in that frozen tree, not a
missing column in the MVP model. No production database, migration or Stripe object was
touched.

**Pass baseline:** `563cf85c1f5543766e0548a83dcb5acd3929418e` = local `HEAD` =
`origin/main` = `git ls-remote` (`in sync` per `.ai/AI_RULES.md` §0). Working tree clean
at the start. Language of record for this document: English, because it is an engineering
record appended to the AI workspace; the operator-facing summary is in Thai.

---

## 1. Environment and identity — what can and cannot be proven here

| Fact | Evidence |
|---|---|
| Repository | `EnJirad/velnox-marketplace`, `main` |
| Local SHA | `563cf85c1f5543766e0548a83dcb5acd3929418e` |
| Remote SHA | identical (`git ls-remote origin refs/heads/main`) |
| Database credentials in this workspace | **none** — the environment holds no keys at all, so no `DATABASE_URL`, `TEST_DATABASE_URL`, `NEON_PRODUCTION_DATABASE_URL` or Stripe key exists here |
| Production reachability | **not reachable**, therefore nothing in this pass could read or write it |
| Verification database | disposable PostgreSQL 14.24 on `127.0.0.1`, created for this audit only |
| Production identity proven? | **No.** `.ai/AI_RULES.md` §0 and `db/mvp/cutover.md` §7 make that a hard stop for any cutover — honoured |

Consequence: every destructive step (new database, cutover, migration apply) is
**BLOCKED on owner infrastructure**, and no claim in this document rests on a production
read. The Render error text is used as a *symptom*, never as proof of a schema.

---

## 2. Two database states — which one is canonical

| State | Files | Status | Read by |
|---|---|---|---|
| **MVP — canonical** | `db/mvp/schema.sql` (bootstrap), `db/mvp/reset.sql` (guarded), `db/mvp/seed.sql` (categories only) | **The MVP data model.** No migration chain; one file builds it. | `backend/mvp/*` (`/api/mvp`), `db/mvp/verify.sh`, CI |
| **Pre-MVP — frozen** | `db/schema.sql` (1963 lines, 77 tables), `db/run-sqleditor.sql` (5442 lines, additive reconciler), `db/migrations/*.sql` (62 files) | **Frozen history.** Not the MVP model, not extended. | the currently deployed pre-MVP backend |

The two never share a table; `backend/mvp/tests/isolation.test.ts` fails the MVP suite if
an MVP module names a pre-MVP table. `db/run-update.sql` does not exist.

**Migration history (pre-MVP only)**

| Question | Answer |
|---|---|
| Where does the schema come from? | `db/schema.sql` snapshot; `db/run-sqleditor.sql` reconciles an existing DB additively; `db/migrations/001…059` is the historical chain |
| Which migration is canonical? | **none of them for the MVP** — a fresh MVP database is built by `db/mvp/schema.sql` in one pass |
| Conflicting migrations? | No contradictory DDL, but the chain has **duplicate numbers** (`029`, `030`, `034`, `035`), so a number-prefixed runner can silently skip one file |
| Legacy migrations that must not be reused? | all 62 — `db/migrations/` is pre-MVP history; `production-db-migrate.yml` applies it to the old database |
| Migration ledger | `schema_migrations` (pre-MVP only). The MVP has **no ledger**, because it has no chain |
| Where does the failure come from? | the deployed database is **behind** the deployed code: migrations `056`, `058`, `059` never reached it (`.ai/AI_HANDOFF.md` §82, `.ai/tasks/active/production-schema-drift-repair-2026-10-21.md`) |

---

## 3. Table audit — 77 pre-MVP tables → 20 MVP tables

**24 pre-MVP tables survive into the MVP (in 20 MVP tables); 53 are removed.**
`Used By` names the module that reads the object **today** in the frozen tree.
`Dependencies` are the foreign keys that decide deletion order (children first).

### 3.1 KEEP (mapped into the canonical MVP schema)

| Table | Keep → MVP | Reason | Used By | Dependencies |
|---|---|---|---|---|
| `users` | `users` | identity + `role`/`status`; email+password (scrypt) | auth, every module | `revoked_tokens`, `addresses`, `carts`, `orders`, `audit_logs` … |
| `revoked_tokens` | `revoked_tokens` | JWT `jti` revocation, `expires_at` > `revoked_at` | `middleware/auth.ts` | → `users` |
| `sellers` | `seller_profiles` | seller identity; status vocabulary kept (`pending/approved/rejected/suspended`) | `routes/seller.ts` | ← `shops` |
| `shops` | `seller_profiles` | one shop per seller is an app invariant; MVP has no second shop table | `routes/products.ts` | ← `products`, `orders` |
| `seller_verifications` | `seller_profiles` (status + evidence columns) | seller verification is CORE; the separate evidence table is not | `routes/verification.ts` | → `sellers` |
| `seller_review_history` | `seller_profiles` (`approved_by`, `rejection_reason`, `suspended_at`) | decision evidence without a second history table | `routes/verification.ts` | → `sellers` |
| `seller_settings` | `seller_profiles` (store fields) | no seller preference system in MVP | `routes/seller.ts` | → `sellers` |
| `categories` | `categories` | platform taxonomy, slug-keyed, hierarchical | `lib/categories.ts` | ← `products` |
| `products` | `products` (`seller_id`, no `shop_id`) | listing + lifecycle `draft→submitted→approved→published`; approval is a GENERATED projection | `routes/products.ts` | ← `order_items`, `cart_items`, `inventory`, `product_selling_units` |
| `product_images` | `product_images` | gallery | `routes/products.ts` | → `products` |
| `product_variants` | `product_variants` (**no stock column**) | flat variants with their own price; stock lives in `inventory` | `lib/variant-options.ts` | → `products` |
| `product_selling_units` | `product_selling_units` (**rewritten**) | set/pack = `label` + `base_quantity` + own `price`; **no stock of its own** | `lib/selling-units.ts` | → `products`, `product_variants` |
| `inventory` | `inventory` | **the only stock authority**, one row per `(product, variant)` | `lib/inventory.ts` | → `products`, `product_variants` |
| `media` | `media` (`key` → `object_key`) | R2 object registry | `routes/upload.ts` | → `users` |
| `addresses` | `addresses` | owner-scoped, at most one default | `routes/index.ts` | → `users` |
| `carts` | `carts` | one cart per `(user, seller)` | `routes/cart.ts` | ← `cart_items` |
| `cart_items` | `cart_items` | line seller FK-locked to cart **and** product; unit is part of line identity | `routes/cart.ts` | → `carts`, `products`, `product_selling_units` |
| `orders` | `orders` (**rewritten state model**) | one seller per order, immutable address + money snapshot | many | ← `order_items`, `payments`, `shipments` |
| `order_items` | `order_items` | immutable sale snapshot incl. unit label/base quantity | checkout/webhook | → `orders`, `products` |
| `shipments` | `shipments` | carrier + tracking, one per order | `routes/seller-orders.ts` | → `orders` |
| `checkout_requests` | `checkout_requests` | `(user, request_key)` idempotency | `routes/cart.ts` | → `orders` |
| `payments` | `payments` | Stripe only; one live session per order | `routes/stripe.ts` | → `orders` |
| `payment_events` | `payment_events` | `event_id UNIQUE` = the webhook claim | `routes/stripe.ts` | — |
| `audit_logs` | `audit_logs` | admin/control trail | `lib/audit-log.ts` | → `users` |

### 3.2 DELETE (53 tables — removed from the canonical MVP schema)

| Table | Reason | Still referenced by (frozen tree) |
|---|---|---|
| `velrepeat_cycles`, `velrepeat_events`, `velrepeat_items`, `velrepeat_package_items`, `velrepeat_packages`, `velrepeat_plans`, `velrepeat_pricing_snapshot_items`, `velrepeat_pricing_snapshots`, `velrepeat_runs`, `vrepeat_deliveries`, `vrepeat_packages` | **VelRepeat — out of MVP** | `routes/velrepeat*.ts`, `jobs/velrepeat*.ts` (all behind `VELREPEAT_ENABLED=false`) |
| `subscriptions` | VelRepeat V2 recurring contract | `routes/velrepeat-v2-*.ts` |
| `store_accounts` | wholesale / B2B — parked out of MVP | `lib/store-accounts.ts` (`WHOLESALE_ENABLED=false`) |
| `auth_identities` | Google OAuth parked; MVP is email+password | `routes/auth.ts` |
| `behavioral_events`, `customer_events`, `tracking_events`, `customer_profiles` | Customer Memory / behaviour tracking / personalization | `packages/shared/src/lib/track.ts`, customer-memory endpoints (flag off) |
| `customer_wishlist` | not in MVP navigation | `routes/products.ts` |
| `notifications` | no MVP notification surface | several routes |
| `product_reviews` | reviews out of MVP | `routes/products.ts` |
| `conversations`, `chat_messages` | chat out of MVP | `routes/chat.ts` |
| `product_option_groups`, `product_option_values`, `product_variant_values`, `product_variant_images`, `option_value_images`, `product_attributes` | option/attribute engine not needed; variants carry name + price | `lib/variant-options.ts`, `routes/product-options.ts` |
| `product_verifications` | legacy, unwritten; approval is `products.status` | legacy moderation |
| `moderation_records` | approval is the product lifecycle + `audit_logs` | `routes/products.ts` |
| `checkout_groups` | one seller per cart/order (no multi-shop group) | `routes/cart.ts`, `routes/stripe.ts` |
| `refunds`, `payment_incidents`, `payment_attempts`, `settlements`, `ledger_entries`, `commissions` | refunds/settlement/ledger/commission are post-MVP; payment authority is `payments` | `routes/stripe.ts`, `routes/center.ts` |
| `reconciliation_runs`, `reconciliation_findings`, `outbox_events` | ops/intelligence tooling, **0 code references** | — |
| `inventory_movements` | history table with **0 code references**; `inventory` is the authority | — |
| `order_returns`, `shipment_items`, `fulfillment_orders` | return/split-fulfilment models out of MVP; **0 references** | — |
| `employees`, `departments` | staff permissions system not in MVP; admin = `users.role` | `routes/center.ts` |
| `platform_settings`, `system_settings`, `company_settings` | settings systems out of MVP; **0 references** for two of three | `lib/platform-settings.ts` |
| `seller_goals`, `seller_analytics`, `seller_settings` | seller intelligence/goals out of MVP | `routes/seller.ts` |
| `schema_migrations` | retired with the pre-MVP migration chain | `production-db-*.yml` |

`commissions`, `company_settings`, `customer_events`, `departments`, `fulfillment_orders`,
`inventory_movements`, `ledger_entries`, `option_value_images`, `order_returns`,
`outbox_events`, `payment_attempts`, `reconciliation_findings`, `reconciliation_runs`,
`seller_analytics`, `shipment_items`, `system_settings` = **16 tables with zero backend
references** even in the frozen tree.

### 3.3 The 20 canonical MVP tables

| # | Table | Purpose |
|---|---|---|
| 1 | `users` | identity, `role` ∈ customer/seller/admin/owner, `status` ∈ active/suspended/deleted |
| 2 | `revoked_tokens` | session revocation |
| 3 | `seller_profiles` | store + verification lifecycle, no self-approval |
| 4 | `categories` | taxonomy, circular-parent trigger |
| 5 | `products` | listing lifecycle + GENERATED `approval_status` |
| 6 | `product_images` | gallery |
| 7 | `product_variants` | flat variants, **no stock** |
| 8 | `inventory` | **only** stock authority (`quantity`, `reserved`) |
| 9 | `product_selling_units` | sets/packs: `base_quantity`, own `price`, `is_active` |
| 10 | `media` | R2 registry (`object_key`) |
| 11 | `addresses` | buyer addresses, one default |
| 12 | `carts` | one cart per `(user, seller)` |
| 13 | `cart_items` | line identity includes selling unit |
| 14 | `orders` | **one** status axis, snapshots |
| 15 | `order_items` | sale snapshot + GENERATED `base_quantity_total` |
| 16 | `shipments` | carrier/tracking |
| 17 | `checkout_requests` | checkout idempotency |
| 18 | `payments` | Stripe TEST, one live session per order |
| 19 | `payment_events` | webhook claim (`event_id UNIQUE`) |
| 20 | `audit_logs` | control trail |

---

## 4. Column audit (all state / VelRepeat / wholesale / intelligence columns)

| Column | Table | Decision | Reason |
|---|---|---|---|
| `order_state` | `orders` (pre-MVP) | **DELETE** | duplicate order axis; MVP has exactly one `orders.status` |
| `fulfillment_status` | `orders` (pre-MVP) | **DELETE** | duplicate fulfilment axis; `processing/shipped/delivered` live on `orders.status` |
| `status` (12 values incl. `pending_payment`, `refunded`, `expired`) | `orders` (pre-MVP) | **REWRITE** → 6 values `pending_payment/paid/processing/shipped/delivered/cancelled` | one canonical order axis, trigger-enforced |
| `payment_state` | — | **never introduced** | payment authority is the `payments` row |
| `inventory_released` | `orders` (pre-MVP) | **DELETE** | release is proven by `inventory.reserved`; a flag can disagree |
| `payment_expires_at` | `orders` | **KEEP** | the only cancellation window; sweep releases once |
| `reservation_policy` | `orders` (pre-MVP) | **DELETE** | audited risk-policy JSON, no MVP reader |
| `checkout_group_id` | `orders`, `payments` (pre-MVP) | **DELETE** | no multi-shop checkout in MVP |
| `correlation_id` | `orders`, `payments`, `refunds`, `payment_events` (pre-MVP) | **DELETE** | tracing column, no MVP reader |
| `order_number` | `orders` | **KEEP** | public id, 18 digits, unique |
| `shop_id` | `products` (pre-MVP) | **RENAME concept** → `seller_id` | one seller authority, no shop hop |
| `approval_status` | `products` (pre-MVP, writable) | **REWRITE** → `GENERATED` from `status` | a second writable axis could drift |
| `stock` | `product_variants` (pre-MVP) | **DELETE** | `inventory` is the only stock authority |
| `reserved/committed/fulfilled/returned` | `product_variants` (pre-MVP) | **DELETE** | variant-level counters duplicate `inventory` |
| `pieces`, `status`, `is_wholesale`, `name` | `product_selling_units` (pre-MVP) | **RENAME** → `base_quantity`, `is_active`, (dropped), `label` | wholesale is parked out; `label` is what a buyer sees |
| `selling_unit_pieces`, `selling_unit_name` | `cart_items`, `order_items` (pre-MVP) | **RENAME** → `selling_unit_base_quantity`, `selling_unit_label` | consistent snapshot naming |
| `base_quantity_total` | `order_items` | **ADD (GENERATED)** | `quantity × base_quantity` cannot be mis-released |
| `is_wholesale` | `product_selling_units` | **DELETE** | wholesale out of MVP |
| `verification_status`, `verified_at` | `products` | **DELETE** | seller-level verification only |
| `wishlist`, `rating`, `review_count`, `sold_count` | `products` | **DELETE** | out of MVP |
| `key` | `media` | **RENAME** → `object_key` | one name for one concept |
| `auth_provider`, `provider_id` | `users`/`auth_identities` | **DELETE** | OAuth parked |
| `permissions`, `department_id` | `employees` | **DELETE** | staff catalogue out of MVP |
| `next_run_at`, `cycle_id`, all VelRepeat columns | `velrepeat_*` | **DELETE** | VelRepeat removed |
| `price`, `subtotal`, `total_amount`, `shipping_fee`, `unit_price`, `amount` | money columns | **KEEP as `NUMERIC(12,2)`** | 10 money columns, verified: 0 float, 0 text |

No column was added to the canonical MVP schema in this pass, and **no
`ALTER TABLE orders ADD COLUMN order_state` exists anywhere in `db/mvp/` or
`backend/mvp/`.**

---

## 5. Enum audit — there are no PostgreSQL enum types

Neither schema declares `CREATE TYPE … AS ENUM` (verified: `pg_type.typtype='e'` count = 0).
Every state vocabulary is `TEXT` + `CHECK`, which is the existing convention; renaming a
value is a constraint change, not a type migration.

| Vocabulary | Owner | Decision |
|---|---|---|
| customer/seller/admin/owner | `users.role` | KEEP |
| active/suspended/deleted | `users.status` | KEEP |
| pending/approved/rejected/suspended | `seller_profiles.status` | KEEP (was `sellers.status`) |
| draft/submitted/approved/published/rejected | `products.status` | KEEP (single lifecycle) |
| pending/approved/rejected | `products.approval_status` | KEEP as **GENERATED** projection only |
| active/inactive | `product_variants.status` | KEEP |
| pending_payment/paid/processing/shipped/delivered/cancelled | `orders.status` | **REWRITE** from 12 values; the ONE order axis |
| pending/confirmed/processing/completed/cancelled | `orders.order_state` (pre-MVP) | **DELETE** |
| unfulfilled/processing/fulfilled/cancelled | `orders.fulfillment_status` (pre-MVP) | **DELETE** |
| pending/requires_action/processing/paid/failed/cancelled | `payments.status` | KEEP (payment fact, not order state) |
| card/promptpay | `payments.method` | KEEP |
| stripe | `payments.provider`, `payment_events.provider` | KEEP (single provider) |
| processing/processed/failed | `payment_events.status` | KEEP |
| all VelRepeat plan/cycle/package statuses | pre-MVP | **DELETE** |

---

## 6. API / service audit

Pre-MVP: **22 route modules / 206 handlers**. MVP: **7 modules / 46 handlers** under
`/api/mvp`. The MVP surface is the canonical one; the pre-MVP modules are deleted at
cutover, not before (the deployed service mounts them today).

| API / service | Decision | Reason |
|---|---|---|
| `backend/mvp/*` (auth, seller, seller-products, catalog, cart/checkout, orders, payments, admin) | **KEEP** | the MVP contract |
| `routes/velrepeat.ts`, `velrepeat-plans.ts`, `velrepeat-packages.ts`, `velrepeat-v2-plans.ts`, `velrepeat-v2-payments.ts`, `velrepeat-v2-status.ts` (44 handlers) | **DELETE** | VelRepeat; currently behind `VELREPEAT_ENABLED=false` |
| `routes/store-accounts.ts` (4) | **DELETE** | wholesale parked out of MVP |
| `routes/chat.ts` (13) | **DELETE** | chat out of MVP |
| `routes/seller-intelligence.ts` (7) | **DELETE** | seller intelligence out of MVP |
| `routes/product-options.ts` (22) | **DELETE** | option engine replaced by variant name+price |
| `routes/cart.ts` (15), `routes/stripe.ts` (7), `routes/seller-orders.ts` (6), `routes/center.ts` (20), `routes/admin.ts` (4), `routes/verification.ts` (10), `routes/seller.ts` (8), `routes/auth.ts` (6), `routes/upload.ts` (5), `routes/products.ts` (40), `routes/product-selling-units.ts` (4), `routes/index.ts` (7) | **REPLACE** | superseded by the `/api/mvp` equivalents |
| `jobs/velrepeat-scheduler.ts`, `jobs/velrepeat-v2-cycle-scheduler.ts` | **DELETE** | VelRepeat workers |
| `jobs/payment-reservation-scheduler.ts` | **REPLACE** | MVP expiry sweep (`jobs/mvp-order-expiry-scheduler.ts`) |
| `realtime/index.ts` (WebSocket) | **DELETE from MVP** | no MVP realtime state; fronts refetch |
| `server.ts` `ensure*` boot DDL (028/034/035/036) | **DELETE** | the MVP schema is complete; startup must never run DDL |
| `.github/workflows/production-db-migrate.yml` | **RETIRE** | must never apply pre-MVP migrations to the MVP database |
| `.github/workflows/production-db-verify.yml` | **REPLACE** | pre-MVP object/ledger assertions |
| `db/verify-reconciler.sh`, `db/schema.sql`, `db/run-sqleditor.sql`, `db/migrations/*` | **ARCHIVE then DELETE** | cutover step 8 |
| `backend/tests/*` (76 files, 2183 tests) | **DELETE at cutover** | pre-MVP schema fixture; MVP keeps `backend/mvp/tests` + `mvp-schema-contract.test.ts` |

**No duplicate endpoint pair exists**: each MVP route has exactly one handler and one
shared client function (`packages/shared/src/mvp/routes.ts` ↔ `backend/mvp/*`).

---

## 7. Root cause — `column "order_state" … does not exist`

Traced CODE → migration → canonical schema → database:

| Step | Finding |
|---|---|
| Where is it referenced? | **pre-MVP tree only**: `lib/order-state.ts` (the projection authority), `routes/cart.ts`, `routes/center.ts`, `routes/seller-orders.ts`, `routes/stripe.ts`, `jobs/payment-reservation-scheduler.ts`, plus 12 tests |
| Where is it declared? | `db/migrations/056_commerce_core_invariants.sql` (`ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_state TEXT`), mirrored in `db/schema.sql` and `db/run-sqleditor.sql` |
| Is it in the canonical MVP schema? | **No** — and it must not be. `orders.status` is the single axis; there is no second or third state column |
| Why does the deployed service fail? | the Render database **never received 056** (nor 058/059), so the deployed code queries a column its database does not have. The repository is correct; the database is behind |
| Correct fix | **(B) it is a legacy concept for the MVP** → delete the column from the MVP model (already absent) **and** apply the missing migrations *or* cut over to a fresh MVP database. **Not** `ADD COLUMN` by guess |

The same trace explains the cart/checkout failures: `cart_items.selling_unit_*`,
`order_items.selling_unit_*` and the `product_selling_units` table are added by
`058_selling_units.sql`, so the deployed backend's cart queries raise `42703` against the
same behind-schema database. A 42703 does not identify whether the query or the database
is wrong (`.ai/context/database.md`) — here it is the database, proven by the code +
migration pair above, not by the error text.

**Adding `order_state` to production would have been the wrong repair twice over:** it
would have preserved a duplicate state system the MVP deletes, and it would have left the
other 058/059 objects missing.

---

## 8. VelRepeat and non-MVP removal — current state

| Surface | Canonical MVP | Frozen pre-MVP tree |
|---|---|---|
| Schema tables | **0** VelRepeat / behaviour / wholesale / review / chat / wishlist tables | 11 VelRepeat tables + 4 intelligence tables, still declared (frozen) |
| Schema columns | **0** (`order_state`, `fulfillment_status`, `is_wholesale`, `pieces` absent) | present |
| Backend routes | **0** | 6 VelRepeat modules, mounted unless `VELREPEAT_ENABLED=true` is explicitly set (default **off**) |
| Jobs | **0** | 2 VelRepeat schedulers, not started while the flag is off |
| Clients | **0** references (`grep -ri velrepeat\|wishlist\|wholesale\|recommend apps/*/src/mvp packages/shared/src/mvp` → empty) | legacy pages/panels, flag-hidden |
| Database with these objects reachable by the MVP API | **none** | the old database only |

Deleting the frozen copies is the cutover commit (one atomic change), not this pass:
doing it now would delete code the currently deployed Render build still serves, with no
new database to point it at.

---

## 9. Verification performed on this tree (real PostgreSQL 14.24)

| Check | Command | Result |
|---|---|---|
| Fresh-DB bootstrap | `psql -f db/mvp/schema.sql` on an empty DB | **PASS** — 20 tables, 206 columns, 75 indexes, 32 FKs, 78 CHECKs, 7 triggers, 0 enum types |
| Schema behaviour | `TEST_DATABASE_URL=… bash db/mvp/verify.sh` | **93/93 PASS** — includes concurrent last-unit reservation, double-release protection, pack snapshot after rename/deactivate, guarded reset ×2, every refusal path |
| Schema contract | `bun test backend/tests/mvp-schema-contract.test.ts` | **20 pass / 0 fail** |
| MVP API suite | `bun run test:mvp` (disposable MVP database) | **113 pass / 0 fail**, 13 files |
| Pre-MVP suite (no regression) | `bun test backend/tests` on a `db/run-sqleditor.sql` database | **2167 pass / 16 skip / 0 fail** (16 skips = 14 parked-wholesale + 2 R2) |
| Typecheck | `bun run typecheck` | 4/4 apps exit 0 |
| Builds | `bun run build:apps` | 4/4 exit 0 |
| i18n parity | `bun run i18n:check` | `th=1535 en=1535 my=1535` |
| Integrity — forbidden objects | catalog query on the fresh DB | `forbidden_tables=0`, `forbidden_columns=0` |
| Integrity — money | catalog query | 10 money columns, all `NUMERIC(12,2)`; `float=0`, `text=0` |
| Integrity — constraints/indexes | catalog query | `unvalidated_constraints=0`, `invalid_indexes=0`, `orphan_fk=0`, `enabled_triggers=7` |
| Stripe round trip | — | **NOT VERIFIED** — no `STRIPE_SECRET_KEY` in this workspace (contract-only: live keys refused, 503 when unconfigured, signature + duplicate-event + amount checks) |
| Production database | — | **NOT VERIFIED / NOT TOUCHED** — no credential, identity unprovable |

---

## 10. Blockers (real, not stylistic)

1. **No production database credential.** `NEON_PRODUCTION_DATABASE_URL` (and Render's
   `DATABASE_URL`) do not exist in this workspace; the environment holds no keys at all.
   The 056/058/059 drift cannot be repaired and identity cannot be proven from here.
2. **No new-database target.** The clean rebuild requires an empty Neon database/branch
   (`db/mvp/schema.sql` bootstrap). Creating it is an owner action.
3. **No provider access** (Render / Vercel / Neon / Stripe dashboard), so staging
   deployment and the Stripe TEST round trip cannot be executed or observed here.
4. **Cutover is a one-way maintenance-window operation** and must not be merged ahead of
   the new database: the deployed build reads the 77-table schema. Per
   `db/mvp/cutover.md` §7 this pass stops before it.

**No production DROP, TRUNCATE, DELETE, reset, force-push or Stripe Live change was
performed or attempted.**

---

## 11. Owner actions to finish the rebuild (in order)

```bash
# 1. Create a NEW empty Neon database (or branch). Never the live one.
# 2. Bootstrap it once:
psql "$NEW_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/mvp/schema.sql
psql "$NEW_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/mvp/seed.sql        # 6 platform categories
# 3. Prove it (disposable copy):
TEST_DATABASE_URL=postgresql://… bash db/mvp/verify.sh                # expect 93/93
# 4. Create the first owner (fail-closed, needs the secret):
#    POST /api/mvp/auth/bootstrap-owner  with BOOTSTRAP_OWNER_SECRET
```

Then: Render staging service with `DATABASE_URL=$NEW_DATABASE_URL`,
`MVP_API_ENABLED=true`, `JWT_SECRET`, `CORS_ORIGINS`, Stripe TEST keys; three Vercel
projects with `VITE_API_MODE=mvp`, `VITE_DEPLOY_ENV=staging`, `VITE_API_URL`; run the
browser pass and one Stripe TEST payment; only then execute `db/mvp/cutover.md` §3
(archive + delete the frozen pair/migrations/legacy tree, retire the pre-MVP workflows)
and point production at the new database. Rollback = point `DATABASE_URL` back; the old
database stays read-only until sign-off.

Interactive alternative for the immediate production error (no rebuild): run
`db/run-sqleditor.sql` once against the **same** Neon that Render serves — it adds
`order_state`, `fulfillment_status`, `product_selling_units` and the 058/059 line columns
additively. That repairs today's outage but keeps the pre-MVP schema; it is **not** the
clean rebuild and was not performed here.

---

## 12. What this pass changed

**No code, schema, migration, endpoint, payment, auth or deployment change.** This pass is
audit + proof + documentation. The canonical MVP schema was already the clean model
requested; the remaining work is the cutover, which is blocked on database identity and
provider access.
