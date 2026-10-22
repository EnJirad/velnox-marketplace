# Production database cutover — pre-MVP Neon → canonical MVP schema

**Status: DESIGNED, NOT EXECUTED.** Nothing in this document has been run
against production. This workspace holds no production credential; production is
reached only by `NEON_PRODUCTION_DATABASE_URL` on Render and in GitHub Actions.
The repository and the production database are separate things: this cleanup
changed the repository, not one row of production data.

This is the external home of the cutover plan. It lives here, not in `db/`,
because `db/` holds exactly two files: `db/schema.sql` and
`db/run-sqleditor.sql`.

## 1. Where each side stands

| | Repository (done) | Production database (untouched) |
|---|---|---|
| Schema | `db/schema.sql` — 20 tables, 206 columns, 75 indexes, 147 constraints, 7 triggers — and `db/run-sqleditor.sql`, proven byte-identical by `bash scripts/db-verify.sh` | pre-MVP schema: ~77 tables, `shops`, `checkout_groups`, a `schema_migrations` ledger |
| Backend | `backend/mvp/` only — no `backend/routes/`, no boot-time `ensure*` DDL, no migration runner | serves the previous API surface |
| Frontends | `apps/*/src/mvp/` only — they call `/api/mvp/*` unconditionally | served the previous pages |
| Migrations | `db/migrations/` removed (62 files) | `schema_migrations` ledger still present and still authoritative |

The repository can no longer talk to the production database, and the
`production-db-migrate.yml` workflow must never be pointed at the new one.

## 2. Prerequisites (all must be true before step 1)

- A **new, empty** Neon database or branch exists — never the live one.
- `db/schema.sql` applies to it and applies twice (`scripts/db-verify.sh` on a
  disposable copy of it).
- Stripe is in **TEST mode**; no COD; no live key anywhere in the deployment.
- The owner has agreed whether pre-MVP rows are carried over (§5).

## 3. Cutover sequence (do not reorder)

1. **Create the new empty database.** Record its identity before anything else:
   `SELECT current_database(), version();` plus host and branch. A cutover cannot
   be verified against an unidentified target.
2. **Bootstrap it once** with `db/schema.sql`, then verify:
   `psql "$URL" -v ON_ERROR_STOP=1 -f db/schema.sql`, then
   `psql "$URL" -c "SELECT count(*) FROM pg_class …"` expecting 20 tables.
3. **Deploy the MVP backend and frontends to staging** with `DATABASE_URL` (and
   `VITE_API_URL`) pointing at the new database. Prove in order: signup/login →
   seller apply → owner approve → product draft → submit → approve → publish →
   add to cart → checkout → Stripe TEST session → signed webhook → order paid →
   stock committed exactly once → cancel/expiry releases stock.
4. **Re-prove idempotency on that database:** replay the same webhook (no second
   settlement), repeat the same checkout `request_key` (same order), retry the
   session (no second payment), kill the webhook mid-transaction (500 so Stripe
   retries).
5. **Switch CI to the new model:** `test.yml` bootstraps `db/run-sqleditor.sql`
   and runs `bun test backend/tests packages/shared/tests` plus
   `bun run test:mvp`; `scripts/db-verify.sh` proves the two files agree.
   `production-db-migrate.yml` is retired with the migration chain.
6. **Switch Render** `DATABASE_URL` to the new database inside a maintenance
   window. Keep the old database **read-only and reachable** for rollback.
7. **Retire the pre-MVP production workflows' assumptions:**
   `production-db-verify.yml` still asserts the `schema_migrations` ledger and
   pre-MVP objects, and `diag-neon-schema.yml` still compares pre-MVP columns.
   Replace their assertions with MVP object checks in the same change.
8. **Update the documents in one commit:** `AGENTS.md` rule 4, `.ai/AI_RULES.md`,
   `.ai/context/database.md`, `INSTALLATION.md`, `docs/DATABASE.md`.

## 4. Downtime and rollback

- **Downtime:** one maintenance window for step 6 (Render env change + restart).
  Expect the API unavailable for the restart only; no schema is altered on the
  live database during the window.
- **Before step 6**, rollback is "keep using the old database" — it was never
  changed.
- **After step 6**, rollback is the reverse of step 6: point `DATABASE_URL` back
  at the untouched old database and redeploy the previous build.
- **Never delete the old database** in the change that cuts over. Retain it
  read-only until the owner signs off.

## 5. Data migration — explicitly out of scope

The design is a **clean database**, not a data migration. There is no backfill
script and none may be invented silently. Carrying rows over is a separate,
reviewed project with a frozen source snapshot and a row-by-row mapping:

- pre-MVP `shops` + `sellers` → `seller_profiles` (one shop per seller is an app
  invariant, not a DB one — check for multi-shop sellers first);
- `products.shop_id` → `seller_profiles.id` via `shops.seller_id`;
- `inventory` + `product_variants.stock` → ONE `inventory` row per
  `(product, variant)`; a product with both needs a documented merge rule;
- 12-value `orders.status` + `order_state` + `fulfillment_status` → the single
  six-value MVP axis; every legacy value needs an explicit mapping, and
  `refunded` / `payment_failed` / `expired` have no MVP order state;
- selling-unit lines → `product_selling_units` (`label`, `base_quantity`, own
  `price`) plus the `order_items` snapshot columns; prices must be recomputed
  from stored snapshots, never from current product prices;
- VelRepeat, chat, reviews, wishlist, customer memory, wholesale, employees:
  **not migrated** (non-MVP domains).

## 6. Compatibility contract the new database must satisfy

| Domain | Contract |
|---|---|
| Seller | `seller_profiles`, `status='approved'` gates every product write; `pending`/`rejected`/`suspended` cannot create, submit or publish |
| Product | `products.seller_id` (no shop join); one `status` lifecycle; variants carry no stock |
| Inventory | one `inventory` row per `(product_id, variant_id)`; reserve with the guarded `UPDATE … WHERE quantity - reserved >= n`; commit `quantity`/`reserved` together; release once on cancel/expiry |
| Cart | one cart per `(user, seller)`; `cart_items.seller_id` is FK-locked |
| Checkout | one order per cart; `checkout_requests(user_id, request_key)`; price, seller status and stock are re-read inside the transaction |
| Order | one `status` axis; timestamps required by table CHECKs; `shipping_address` JSONB snapshot; `order_items` snapshots names and prices |
| Payment | Stripe TEST only; raw body + signature; `payment_events.event_id` claim; one settlement transaction; the database never marks an order paid by itself |
| Auth | email/password core; `revoked_tokens`; Google OAuth parked |

## 7. Stop conditions

Stop and report — do not improvise — if any of these is true:

- the production database identity cannot be proven;
- a production dependency on a removed table is found (a route, job, report or
  external service still reads it);
- data must be carried over (§5);
- the switch would change payment or auth semantics;
- any step requires `DROP`, `TRUNCATE` or `DELETE` against production;
- a real Stripe TEST round trip has not been observed on the new database.
