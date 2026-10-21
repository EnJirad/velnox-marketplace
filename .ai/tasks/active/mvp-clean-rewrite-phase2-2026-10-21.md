# PHASE 2 — CLEAN MVP DATABASE FOUNDATION

**Date:** 2026-10-21
**Repository:** `EnJirad/velnox-marketplace`, branch `main`
**Baseline SHA (verified against GitHub this pass):** `dd8c567f922116ab848a69e728f29a7fc027737d`
**Scope:** database foundation only. No frontend, route, payment-behaviour, auth-behaviour or app deletion. No destructive production action.

> **Production was not touched.** No `DATABASE_URL`, `NEON_PRODUCTION_DATABASE_URL` or production credential exists in this workspace. No DDL was executed against production. The 62 migrations and both pre-MVP canonical files are byte-for-byte unchanged.

---

## 0. Git baseline (STEP 1)

| Check | Result |
|---|---|
| `git fetch origin` | ok |
| `git rev-parse HEAD` | `dd8c567f922116ab848a69e728f29a7fc027737d` |
| `git rev-parse origin/main` | `dd8c567f922116ab848a69e728f29a7fc027737d` |
| `git ls-remote origin refs/heads/main` | `dd8c567f922116ab848a69e728f29a7fc027737d` |
| Comparison | **in sync** — the requested baseline is still HEAD; no newer commit |
| Working tree at start | clean |

The baseline was established before reading or editing anything. The local checkout was never treated as the source of truth.

---

## 1. Executive summary

Phase 2 delivers **one clean MVP data model, one reset path and the proof that both behave**, without switching the live database.

| Deliverable | Result |
|---|---|
| Clean MVP schema | **`db/mvp/schema.sql`** — 19 tables, one order axis, one stock authority, one seller per cart/order, Stripe-only payments, 6 lifecycle triggers |
| Reset | **`db/mvp/reset.sql`** + **`db/mvp/reset.sh`** — destructive, fail-closed on name + explicit session opt-in + the shared production-detection guard |
| Seed | **`db/mvp/seed.sql`** — 6 platform categories only; creates no user/seller/product/order/payment |
| Behavioural proof | **`db/mvp/verify.sh`** — **81/81 checks pass** against real PostgreSQL (bootstrap, constraints, CRUD, concurrency, payments, reset) |
| Static contract | **`backend/tests/mvp-schema-contract.test.ts`** — **19/19 pass**; fails if the table set, money type, status axes or non-MVP domains drift |
| Pre-MVP database | **FROZEN** — `db/schema.sql`, `db/run-sqleditor.sql`, `db/migrations/*` unchanged |
| Cutover | **designed, not executed** — `db/mvp/cutover.md` |
| Existing suite | unchanged and green: **2147 pass / 16 skip / 0 fail** before, **2166 pass / 16 skip / 0 fail** after (the +19 are the new contract tests) |

**The central design decision:** the MVP schema is canonical *for the MVP database*, but it cannot replace `db/schema.sql` in place while the deployed backend still queries the 77-table model. Replacing it would break the deployment, CI's fresh-bootstrap contract and 15+ existing tests that assert pre-MVP shape. Phase 2 therefore creates the clean canonical source, freezes the pre-MVP pair, and specifies the cutover — which is exactly the safe migration strategy D10 asks for.

---

## 2. A. Database map — before → after

### 2.1 Before (pre-MVP, frozen)

`db/schema.sql` — **77 tables**, 1,963 lines. `db/run-sqleditor.sql` — 5,442-line additive reconciler. 62 migrations (001–059, four duplicated numbers, no 026). Boot-time DDL in `backend/server.ts` reads migrations 028/034/035/036. Live shape: NUMERIC(12,2) money, TIMESTAMPTZ, UUID defaults. Those foundations were kept.

### 2.2 After (MVP, canonical)

`db/mvp/schema.sql` — **19 tables**, zero extensions, 72 indexes, 137 constraints, 6 triggers.

| Table | Purpose | Used by (new model) | MVP | Action |
|---|---|---|---|---|
| `users` | email/password identity, roles, status | auth, ownership, admin | YES | KEEP (rewritten: `avatar_url`, no OAuth columns) |
| `revoked_tokens` | JWT `jti` revocation | auth middleware | YES | KEEP |
| `seller_profiles` | seller identity + approval lifecycle | seller apply/admin, every product write | YES | **REWRITE** (`sellers` + `shops` merged) |
| `categories` | platform taxonomy, slug-keyed tree | catalog, product form | YES | KEEP (i18n `names` retained) |
| `products` | catalog + moderation lifecycle | seller, catalog, admin | YES | **REWRITE** (`seller_id`, one status axis) |
| `product_images` | gallery | product page/editor | YES | KEEP (minimal) |
| `product_variants` | flat variants with own price | product page/editor | YES | **REWRITE** (no stock, no option tables) |
| `inventory` | the only stock authority | cart/checkout/webhook | YES | **REWRITE** (one row per product+variant) |
| `media` | R2 object registry | uploads | YES | KEEP (`key` → `object_key`) |
| `addresses` | buyer shipping addresses | profile/checkout | YES | KEEP (+ one-default invariant) |
| `carts` | one cart per buyer per seller | cart page | YES | **REWRITE** |
| `cart_items` | cart lines, FK-locked to one seller | cart page | YES | **REWRITE** (no selling-unit columns) |
| `checkout_requests` | checkout idempotency | checkout | YES | KEEP (scope removed) |
| `orders` | one seller, one status, snapshots | buyer/seller/admin | YES | **REWRITE** (one axis) |
| `order_items` | immutable sale snapshot | order pages | YES | **REWRITE** (no sets/packs) |
| `shipments` | carrier/tracking + delivery evidence | seller order flow | YES | KEEP (minimal) |
| `payments` | Stripe attempt/result | checkout/webhook | YES | **REWRITE** (Stripe-only, no COD/plan parents) |
| `payment_events` | webhook idempotency claim | webhook | YES | KEEP |
| `audit_logs` | admin control trail | VelCenter | YES | KEEP |

**19 = 7 kept as-is (or nearly) + 8 rewritten + 4 new/merged into the target shape** (the table itself may be new; the domain is not).

---

## 3. B. Canonical schema — the single source of truth

| File | Role | Status |
|---|---|---|
| **`db/mvp/schema.sql`** | **THE canonical MVP schema** | authoritative for the MVP data model |
| `db/mvp/reset.sql` | destructive rebuild of a dev/test DB | derived from the canonical file (`\ir schema.sql`) |
| `db/mvp/seed.sql` | deterministic dev data (categories only) | derived, guarded |
| `db/mvp/verify.sh` | behavioural proof | reads the canonical file |
| `db/schema.sql` | pre-MVP snapshot | **FROZEN**, not a competing MVP truth |
| `db/run-sqleditor.sql` | pre-MVP reconciler | **FROZEN** |
| `db/migrations/*.sql` | pre-MVP history | **FROZEN** |

There is exactly **one** canonical MVP file. The pre-MVP pair describes the database the current backend runs on and is scheduled for deletion at cutover, not maintained in parallel.

`db/README.md` is the map. `AGENTS.md` rule 4 and `.ai/AI_RULES.md` §6 now point at the MVP file and forbid edits to the frozen pair.

---

## 4. C. Reset strategy

| Environment | Command | Guard |
|---|---|---|
| Development | `bash db/mvp/reset.sh --database-url … --seed` | target must be named explicitly; database must end `_dev`/`_test`; `velnox.allow_reset=yes` required; `DATABASE_URL` is never read |
| Test / CI | `bash db/mvp/verify.sh` (creates/drops its own DBs) | same SQL guard + `backend/db/test-database.ts` refuses Neon/production markers |
| Production | **never reset** | no script references production; the cutover is the only path |

Two independent keys are required even for a direct `psql -f db/mvp/reset.sql`:

1. `current_database()` matches `_(dev|test)$`;
2. the session carries `velnox.allow_reset=yes`.

The wrapper reuses the existing production-detection module rather than reimplementing it, and refuses a target equal to `DATABASE_URL`, a Neon host without the explicit branch opt-in, and a process carrying `RENDER=true` or a production env marker.

---

## 5. D. Removed tables (58) — with reasons

All 58 are **absent from the MVP schema**. They remain in the frozen pre-MVP schema so the deployed backend keeps working; none was dropped.

| Group | Tables | Why removed |
|---|---|---|
| Google OAuth link | `auth_identities` | D6: email/password is the core; Google OAuth is parked, and a clean DB has no Google identities |
| Seller onboarding evidence | `seller_verifications`, `seller_review_history`, `seller_settings` | D12: approval collapses into `seller_profiles` + `audit_logs`; the evidence queue is not MVP |
| Storefront split | `shops` | merged into `seller_profiles`; one shop per seller was already an app invariant |
| Sets / packs | `product_selling_units` | D3: Product → Variant → Price → Stock → Quantity only |
| Option model | `product_option_groups`, `product_option_values`, `product_variant_values`, `option_value_images` | flat named variants cover the MVP; the option grid is 3 tables + 33 backend refs of complexity |
| Extra catalog media/attrs | `product_variant_images`, `product_attributes` | not required by the MVP product page |
| Product verification | `product_verifications` | dead since 2026-09-13; the V badge is seller-only |
| Multi-shop checkout | `checkout_groups` | D4: one checkout = one seller |
| Order tracking table | `tracking_events` | folded into `shipments` (carrier/tracking/`shipped_at`/`delivered_at`) |
| Refunds / incidents | `refunds`, `payment_incidents` | outside D5's MVP payment scope; cancellations before shipment only |
| Dead finance/foundation tables | `commissions`, `settlements`, `ledger_entries`, `outbox_events`, `inventory_movements`, `fulfillment_orders`, `shipment_items`, `order_returns`, `payment_attempts`, `reconciliation_runs`, `reconciliation_findings` | 0 non-test writers/readers; copying them forward would preserve exactly the "dead structure indistinguishable from live" defect |
| Platform settings | `platform_settings`, `company_settings`, `system_settings` | no MVP admin-settings surface; 2 of them had zero references |
| Staff RBAC | `employees`, `departments` | D7: owner/admin only |
| Non-MVP shopper surfaces | `product_reviews`, `customer_wishlist`, `conversations`, `chat_messages`, `notifications` | D8 + notifications deferred |
| Customer memory | `behavioral_events`, `customer_events`, `customer_profiles` | memory is parked; profile fields live on `users` |
| Seller intelligence | `seller_goals`, `seller_analytics` | out of MVP |
| Wholesale | `store_accounts` | parked; `product_selling_units.is_wholesale` is gone with the table |
| Moderation record | `moderation_records` | `audit_logs` is the single control trail |
| Migration ledger | `schema_migrations` | retired with the migration chain at cutover |
| VelRepeat | `subscriptions`, `vrepeat_packages`, `vrepeat_deliveries`, `velrepeat_plans`, `velrepeat_items`, `velrepeat_runs`, `velrepeat_events`, `velrepeat_packages`, `velrepeat_package_items`, `velrepeat_cycles`, `velrepeat_pricing_snapshots`, `velrepeat_pricing_snapshot_items` | VelRepeat is parked; the MVP has no recurring commerce |

### Also removed from the MVP model (columns/concepts)

- `products.vrepeat_*` (9 columns), `featured`, `rating`, `review_count`, `sold_count`, `verification_status`, `verified_at`, `short_description`, `compare_at_price`, `unit`, `supplier`, `shop_id` → `seller_id`.
- `orders` axes `order_state`, `fulfillment_status`, `inventory_released`, `discount`, `reservation_policy`, `velrepeat_run_id`, `velrepeat_cycle_id`, `checkout_group_id`, `shop_id`.
- `payments` `plan_id`, `checkout_group_id`, `refunded_amount`, `refund_status`, COD defaults, multi-parent CHECKs.
- `cart_items` / `order_items` `selling_unit_id`, `selling_unit_pieces`, `selling_unit_name`.
- `inventory` `reorder_level`, `low_stock_threshold`; `product_variants.stock` (the dual authority).
- Legacy money-in-JS and string math: every monetary column is `NUMERIC(12,2)`.

---

## 6. E. Parked (kept in the frozen pre-MVP database, not dropped)

| Item | Dependency that blocks deletion | Parked state |
|---|---|---|
| 62 migrations | `production-db-migrate.yml` applies them; `production-db-verify.yml` asserts the ledger; `server.ts` reads 028/034/035/036 at boot; CI pins numbering | frozen; no new migration |
| `db/schema.sql` + `db/run-sqleditor.sql` | deployed backend, CI bootstrap, 15+ tests, docs | byte-for-byte unchanged |
| `db/verify-reconciler.sh` | proves the pre-MVP reconciler | unchanged |
| Boot-time DDL (`ensure*`) | reads migrations at boot; deleting now would break a fresh pre-MVP boot | parked with the cutover plan (below) |
| VelRepeat routes/jobs/libraries | flag off, but `seller-orders.ts` and `stripe.ts` still import the code | unreachable; removed with the Phase 3 backend rewrite |
| Wholesale routes | flag off; store-account routes 404 | unreachable |
| Customer Memory handlers | flag off; storefront still calls and receives an error | unreachable |
| Chat/reviews/wishlist/goals UI + routes | still mounted in the current app | out of MVP; deleted in Phase 3+ |
| `apps/velnox` | external Vercel project + OAuth redirect URLs | builds and typechecks; untouched (D9) |
| Pre-MVP test suite | tests the system being removed | still green; deleted/replaced per phase |

### Boot-time DDL audit

| Function | Location | Reads | Why it cannot be deleted in Phase 2 |
|---|---|---|---|
| `ensureVariantTables()` | `server.ts:138` | `028_create_variant_tables_if_missing.sql` + inline ALTERs | fresh pre-MVP boot still needs those tables |
| `ensureVelRepeatV2Tables()` | `server.ts:212` | `034_velrepeat_v2.sql` | already gated by `VELREPEAT_ENABLED`; delete with VelRepeat |
| `ensureCheckoutIdempotencyTable()` | `server.ts:240` | `035_checkout_idempotency.sql` | pre-MVP checkout needs `checkout_requests` on a fresh DB |
| `ensureChatTables()` | `server.ts:264` | `036_comments_chat.sql` | pre-MVP chat needs it; delete with chat |

**Target:** application boot performs no DDL. The cutover plan removes all four **after** the MVP database is live and the code is rewritten, in one atomic commit with the pre-MVP pair deletion.

---

## 7. F. Kept tables and their guarantees

| Guarantee | Where enforced |
|---|---|
| Approved seller only can create/submit/publish a product | `trg_products_approved_seller` + `trg_products_status_transition` |
| Product ownership is immutable (no seller-to-seller transfer) | `require_approved_seller_for_product()` rejects any `seller_id` change |
| Suspended/pending seller cannot take an order | `trg_orders_approved_seller` |
| Unpublished/unapproved product cannot enter an order | `trg_order_items_published_product` |
| Product lifecycle DRAFT→SUBMITTED→APPROVED→PUBLISHED, REJECTED/resubmit | `trg_products_status_transition` + `products.approval_status` (GENERATED) |
| One order status, legal transitions only | `orders.status` CHECK + `trg_orders_status_transition` |
| One seller per cart | `carts UNIQUE(user_id, seller_id)` + two composite FKs on `cart_items` |
| One seller per order | `orders.seller_id` + `UNIQUE(id, seller_id)` + composite FK on `order_items` |
| No negative/over-reserved stock | `inventory` CHECKs + guarded atomic `UPDATE` |
| One inventory row per product+variant | unique expression index on `(product_id, COALESCE(variant_id, 0-uuid))` |
| Money is exact | `NUMERIC(12,2)` + totals/subtotals CHECKs |
| Order snapshot is immutable | `shipping_address JSONB NOT NULL`, `order_items` name/price/subtotal snapshot |
| Webhook replay is idempotent | `payment_events.event_id UNIQUE` + `ON CONFLICT DO NOTHING` |
| One live Stripe session per order | `idx_payments_one_active_stripe` |
| Seller cannot self-approve | `seller_profiles_no_self_approval` |
| One default address | `idx_addresses_one_default` |
| Category cycles impossible | `trg_prevent_circular_category_parent` |

---

## 8. G. Order model

```
pending_payment ──paid──▶ paid ──▶ processing ──▶ shipped ──▶ delivered
       │                   │            │
       └──▶ cancelled      └──▶ cancelled └──▶ cancelled
```

- **One** canonical `orders.status`; six values. No second axis.
- Illegal transitions fail at the database (`23514`).
- `paid_at`, `shipped_at`, `delivered_at`, `cancelled_at` are required by CHECKs for the states that need them.
- `orders.payment_reference` is an informational settlement snapshot; `payments` remains the payment authority.
- A failed payment leaves the order `pending_payment`; a refund is not an order state (refunds are outside MVP).

---

## 9. H. Inventory model

```
inventory(product_id, variant_id)     variant_id NULL = base product
  quantity  on-hand
  reserved  held by a pending checkout
  CHECK 0 <= reserved <= quantity
  UNIQUE (product_id, COALESCE(variant_id, 0-uuid))
```

- **One** stock authority. `product_variants` has no `stock`.
- Reserve with the single guarded statement (`quantity - reserved >= n`); an oversell updates 0 rows, never a negative row.
- Commit `quantity` and `reserved` together after a verified payment; release once on cancellation/expiry.
- Replayed webhooks cannot decrement twice: the event claim is `event_id UNIQUE`, and the order transition is one-way.
- Concurrent proof: two sessions race for the last unit; exactly one reservation wins (verify §F2).

---

## 10. I. Payment model (Stripe TEST only)

```
checkout_requests (user_id, request_key)  → one order, one seller
orders (pending_payment, server total)
  → payments (pending, amount = order total, one live session per order)
  → Stripe Checkout session (card / PromptPay)
  → signed webhook, raw body
  → payment_events claim (event_id UNIQUE, ON CONFLICT DO NOTHING)
  → ONE transaction: payments=paid + orders=paid + inventory commit
  → GET /api/orders/:id is the read model; the redirect is never success
```

- No COD, no mock payment, no client-declared success.
- `payment_events` status: `processing → processed | failed`; a failed delivery can be re-armed on Stripe retry.
- Refund tables/columns are not in the MVP model; a paid order cannot be silently cancelled without an operator refund path (Phase 3 decision).
- Amount is re-read from `orders.total_amount` by the backend; the DB CHECK ties `total_amount = subtotal + shipping_fee`.

---

## 11. J. Verification (all run after the edits)

| Check | Command | Result |
|---|---|---|
| Frontend typecheck | `bun run typecheck` | **4/4 exit 0** |
| Backend typecheck | `bun --filter @velnox/backend typecheck` | **exit 0** |
| Static MVP contract | `bun test backend/tests/mvp-schema-contract.test.ts` | **19 pass / 0 fail** |
| Behavioural MVP proof | `TEST_DATABASE_URL=… bash db/mvp/verify.sh` | **81/81 checks pass** on PostgreSQL 14 |
| Full existing suite (before) | `bun test backend/tests` | **2147 pass / 16 skip / 0 fail** |
| Full existing suite (after) | `bun test backend/tests` | **2166 pass / 16 skip / 0 fail** |
| i18n parity | `bun run i18n:check` | th=1535 en=1535 my=1535 |
| Whitespace | `git diff --check` | clean |

The behavioural proof covers: fresh bootstrap twice (identical fingerprint), 19-table set, money types, no float, no dual stock, seller/product/order lifecycle, seller self-approval, unpublished-product ordering, cross-seller cart/order lines, negative/over-reserved stock, duplicate cart lines, one default address, 18-digit order numbers, total/subtotal CHECKs, order/payment sync, one active Stripe session, webhook replay, two-session concurrency for the last unit, history-protecting FKs, and every reset refusal path.

**Not verified / limitations:** no browser E2E; no real Stripe TEST round trip (no keys in this workspace); no production database read or write; PostgreSQL 14 locally vs PostgreSQL 16 in CI/Neon. No claim is made about a real customer payment.

---

## 12. K. Git

| | |
|---|---|
| Previous SHA | `dd8c567f922116ab848a69e728f29a7fc027737d` |
| `origin/main` at start | `dd8c567f922116ab848a69e728f29a7fc027737d` |
| GitHub `ls-remote` at start | `dd8c567f922116ab848a69e728f29a7fc027737d` |
| New SHA | the HEAD containing this file; reported after `git push` and verified with `git rev-parse HEAD` == `git rev-parse origin/main` == `git ls-remote origin refs/heads/main` |
| Commit | `refactor(db): define clean marketplace MVP schema` |

(K cannot contain its own commit hash; the push verification is reported in the completion message and is reproducible with the three commands above.)

---

## 13. Owner decisions — how each was applied

| Decision | Applied |
|---|---|
| **D1** clean DB, no production wipe | new canonical schema + guarded reset; no data migration; production untouched |
| **D2** product approval required | lifecycle `draft→submitted→approved→published` + `rejected`; DB trigger + published-order gate; public sale only at `published` |
| **D3** no sets/packs | `product_selling_units` and all six snapshot columns absent; Product→Variant→Price→Stock→Quantity |
| **D4** no multi-shop checkout | one cart per (buyer, seller); one order per seller; `checkout_groups` absent; composite FKs make mixing impossible |
| **D5** Stripe TEST only | `provider='stripe'`; one live session; event claim; no COD/mock/refund tables |
| **D6** email/password core | `users.password_hash`, `revoked_tokens`; `auth_identities` absent (Google parked) |
| **D7** owner/admin only | role CHECK excludes `staff`; no `employees`/`departments`/permission tables |
| **D8** no reviews/wishlist/chat/goals | all corresponding tables and columns absent |
| **D9** corporate app | `apps/velnox` untouched and still building/typechecking |
| **D10** clean schema + reset, safe cutover | one MVP canonical file; 62 migrations and pre-MVP pair frozen; cutover plan written |
| **D11** languages | no language or i18n change; see the flag below |
| **D12** seller lifecycle | `pending|approved|rejected|suspended`; DB triggers gate product creation/submission/publishing and order creation |

### Deliberate extensions (review these)

1. **`rejected` seller state.** The brief draws PENDING→APPROVED→SUSPENDED. Without a rejected state, an admin rejecting an application leaves it pending forever. `rejected` is a terminal state; re-apply is a Phase 3 policy decision.
2. **`approval_status` is GENERATED.** The brief asks for both `status` and `approval status`. Making approval a second writable column would recreate the multi-axis defect; the generated projection satisfies the field requirement while `status` remains the only authority.
3. **Transition triggers.** The brief asks for a lifecycle and one order status. The triggers are the single executable definition; they also make "a legal status reached by an illegal jump" impossible.
4. **Composite foreign keys lock the seller.** `cart_items.seller_id` and `order_items.seller_id` are denormalised but FK-locked to both the parent and the product, so they cannot drift and a cross-seller line cannot exist.
5. **Order items require a published product.** The money path cannot insert a line for a draft/submitted/rejected product, even if a route is bypassed.
6. **Product ownership is immutable.** A product can never be moved to another seller by a column update; a transfer, if ever needed, is a separate audited operation.
7. **No extensions.** `gen_random_uuid()` is built into PostgreSQL 13+; the MVP schema needs no `uuid-ossp`/`pgcrypto`, simplifying fresh bootstrap.

### Flags / open items for the owner

- **D11 language mismatch:** the repository's third locale is `my` = **Burmese** (`packages/shared/src/lib/i18n/locales/my.ts`), while D11 says **Malay**. Phase 2 changed no language. Confirm whether "Malay" means the existing `my` locale or a new `ms` locale before Phase 3.
- **Editing a published product:** the schema enforces the status machine but does not force a re-approval when a seller edits the name/description/price of a `published` product (that is a Phase 3 policy decision). The DB does prevent publishing an unapproved product.
- **Refunds:** not in the MVP model. If a paid order must be cancellable, a refund flow is needed before `paid → cancelled` is exposed to admins.
- **Data carry-over:** D1 chooses a clean database. If any real data must survive, it is a separate backfill project (mapping sketch in `db/mvp/cutover.md` §4).
- **Production identity:** the cutover cannot start until the owner proves which Neon database Render serves (`db/mvp/cutover.md` §2/§7).

---

## 14. What Phase 3 must do next (do not start here)

1. Rewrite the backend against `db/mvp/schema.sql` (seller/product/inventory/cart/order/payment/auth modules).
2. Point CI's disposable bootstrap at `db/mvp/schema.sql`; delete the pre-MVP tests' schema assertions.
3. Prove the full flow on a NEW empty database, including a real Stripe TEST webhook round trip.
4. Execute the cutover in `db/mvp/cutover.md`; only then delete the 62 migrations, the pre-MVP pair and the boot-time DDL.

---

## Appendix A — full 77-table inventory (pre-MVP → MVP)

`MVP` = present in `db/mvp/schema.sql`. `Action` = what happens to the concept in the MVP model; every `REMOVE` row stays in the frozen pre-MVP schema until cutover (PARK), so no live dependency is broken in Phase 2.

| # | Table | Purpose | Main consumer (pre-MVP) | MVP | Action |
|---|---|---|---|---|---|
| 1 | `users` | identity, role, status | auth, every ownership query | YES | KEEP (rewritten) |
| 2 | `revoked_tokens` | server-side JWT revocation | auth middleware | YES | KEEP |
| 3 | `auth_identities` | Google `sub` ↔ user | OAuth callback | no | REMOVE — D6 Google parked |
| 4 | `customer_profiles` | extended customer data | profile route (1 ref) | no | REMOVE — fields live on `users` |
| 5 | `store_accounts` | wholesale application | unmounted store-account routes | no | REMOVE — wholesale parked |
| 6 | `addresses` | shipping addresses | customer addresses, checkout | YES | KEEP (+ one-default invariant) |
| 7 | `carts` | one cart per user | cart routes | YES | REWRITE — one per (buyer, seller) |
| 8 | `media` | R2 object registry | upload routes | YES | KEEP (`object_key`) |
| 9 | `categories` | taxonomy tree | catalog, admin | YES | KEEP |
| 10 | `sellers` | seller account/status | seller, admin, verification | YES | REWRITE → `seller_profiles` |
| 11 | `seller_verifications` | evidence + review | verification routes/UI | no | REMOVE — D12 |
| 12 | `seller_review_history` | review audit | verification UI | no | REMOVE — `audit_logs` |
| 13 | `shops` | storefront identity | products/orders/seller queries | no | REMOVE — merged into `seller_profiles` |
| 14 | `products` | catalog + moderation | product routes, catalog | YES | REWRITE — `seller_id`, one lifecycle |
| 15 | `product_variants` | variant price/stock | product editor/page | YES | REWRITE — no stock, flat |
| 16 | `product_selling_units` | sets/packs | selling-unit routes | no | REMOVE — D3 |
| 17 | `cart_items` | cart lines | cart routes | YES | REWRITE — no selling-unit cols |
| 18 | `product_images` | gallery | product editor/page | YES | KEEP |
| 19 | `product_variant_images` | variant gallery | product editor | no | REMOVE — not MVP |
| 20 | `product_verifications` | product V badge | dead (0 writers) | no | REMOVE — dead |
| 21 | `inventory` | non-variant stock | checkout/webhook/seller stock | YES | REWRITE — only stock authority |
| 22 | `seller_settings` | shop preferences | seller settings (1 route) | no | REMOVE — not MVP |
| 23 | `seller_analytics` | seller metrics | none (0 refs) | no | REMOVE — dead |
| 24 | `seller_goals` | seller goals | velseller goals | no | REMOVE — D8 |
| 25 | `orders` | order header | order routes, seller/center | YES | REWRITE — one status axis |
| 26 | `checkout_groups` | one charge, N shops | cart/checkout/stripe | no | REMOVE — D4 |
| 27 | `checkout_requests` | checkout idempotency | checkout | YES | KEEP (scope removed) |
| 28 | `order_items` | line snapshots | order routes | YES | REWRITE — no sets/packs |
| 29 | `shipments` | carrier/tracking | seller orders | YES | KEEP (minimal) |
| 30 | `tracking_events` | shipment scan log | order tracking read | no | REMOVE — folded into `shipments` |
| 31 | `payments` | payment attempt/result | stripe routes/webhook | YES | REWRITE — Stripe only |
| 32 | `payment_events` | webhook claim | stripe webhook | YES | KEEP |
| 33 | `payment_incidents` | late-payment ledger | stripe webhook | no | REMOVE — not MVP |
| 34 | `refunds` | refund records | admin refund route | no | REMOVE — not MVP |
| 35 | `commissions` | platform fee | none (0 refs) | no | REMOVE — dead |
| 36 | `settlements` | seller payout | comment only | no | REMOVE — dead |
| 37 | `subscriptions` | seller subscription | VelRepeat code | no | REMOVE — VelRepeat parked |
| 38 | `departments` | staff departments | none (0 refs) | no | REMOVE — D7 |
| 39 | `employees` | staff RBAC | center staff routes | no | REMOVE — D7 |
| 40 | `company_settings` | KV settings | none (0 refs) | no | REMOVE — dead |
| 41 | `system_settings` | KV settings | none (0 refs) | no | REMOVE — dead |
| 42 | `audit_logs` | admin control trail | audit route | YES | KEEP |
| 43 | `moderation_records` | product moderation | moderation route | no | REMOVE — `audit_logs` |
| 44 | `notifications` | user notifications | notification routes/UI | no | REMOVE — deferred |
| 45 | `customer_wishlist` | wishlist | wishlist UI | no | REMOVE — D8 |
| 46 | `behavioral_events` | customer memory | memory endpoints | no | REMOVE — memory parked |
| 47 | `customer_events` | memory events | none (0 refs) | no | REMOVE — dead |
| 48 | `platform_settings` | platform config | settings route/UI | no | REMOVE — no MVP settings |
| 49 | `schema_migrations` | migration ledger | migrate/verify workflows | no | REMOVE — chain retired at cutover |
| 50 | `vrepeat_packages` | VelRepeat package | VelRepeat routes | no | REMOVE — parked |
| 51 | `vrepeat_deliveries` | VelRepeat delivery | VelRepeat jobs | no | REMOVE — parked |
| 52 | `product_reviews` | reviews/ratings | review routes/UI | no | REMOVE — D8 |
| 53 | `product_option_groups` | option model | product editor | no | REMOVE — flat variants |
| 54 | `product_option_values` | option values | product editor | no | REMOVE — flat variants |
| 55 | `option_value_images` | option swatches | product editor | no | REMOVE — not MVP |
| 56 | `product_variant_values` | option → variant map | product editor | no | REMOVE — flat variants |
| 57 | `product_attributes` | extra specs | product editor | no | REMOVE — not MVP |
| 58 | `conversations` | chat threads | chat routes/WS | no | REMOVE — D8 |
| 59 | `chat_messages` | chat messages | chat routes/WS | no | REMOVE — D8 |
| 60 | `velrepeat_plans` | VelRepeat V2 plans | VelRepeat routes/jobs | no | REMOVE — parked |
| 61 | `velrepeat_items` | plan items | VelRepeat routes | no | REMOVE — parked |
| 62 | `velrepeat_runs` | plan runs | VelRepeat scheduler | no | REMOVE — parked |
| 63 | `velrepeat_events` | run events | VelRepeat scheduler | no | REMOVE — parked |
| 64 | `velrepeat_packages` | V2 packages | VelRepeat routes | no | REMOVE — parked |
| 65 | `velrepeat_package_items` | V2 package items | VelRepeat routes | no | REMOVE — parked |
| 66 | `velrepeat_pricing_snapshots` | price history | VelRepeat pricing | no | REMOVE — parked |
| 67 | `velrepeat_pricing_snapshot_items` | price history lines | VelRepeat pricing | no | REMOVE — parked |
| 68 | `velrepeat_cycles` | prepaid cycles | VelRepeat routes/jobs | no | REMOVE — parked |
| 69 | `payment_attempts` | 056 attempt table | none (0 refs) | no | REMOVE — dead |
| 70 | `fulfillment_orders` | 056 fulfilment | none (0 refs) | no | REMOVE — dead |
| 71 | `shipment_items` | 056 shipment lines | none (0 refs) | no | REMOVE — dead |
| 72 | `inventory_movements` | 056 stock ledger | none (0 refs) | no | REMOVE — dead |
| 73 | `ledger_entries` | 056 ledger | none (0 refs) | no | REMOVE — dead |
| 74 | `order_returns` | 056 returns | none (0 refs) | no | REMOVE — dead |
| 75 | `outbox_events` | 056 outbox | none (0 refs) | no | REMOVE — dead |
| 76 | `reconciliation_runs` | 056 reconciliation | none (0 refs) | no | REMOVE — dead |
| 77 | `reconciliation_findings` | 056 findings | none (0 refs) | no | REMOVE — dead |

**Totals:** 77 tables = **19 MVP** + **58 removed from the MVP model**. 0 tables unclassified.
