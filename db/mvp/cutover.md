# MVP database cutover — designed in Phase 2, executed in Phase 3+

**Status: DESIGNED, NOT EXECUTED.** Phase 2 created the clean schema and its
proofs. Nothing in this document has been run against production, and Phase 2
must not run it. Production is a separate Neon database reached only by
`NEON_PRODUCTION_DATABASE_URL`; this workspace holds no production credential.

## 1. What exists today

| Object | Where it lives | Cutover action |
|---|---|---|
| Clean MVP schema | `db/mvp/schema.sql` (20 tables) | becomes `db/schema.sql` |
| Guarded reset | `db/mvp/reset.sql` + `db/mvp/reset.sh` | stays; production is never reset |
| Deterministic dev seed | `db/mvp/seed.sql` (categories only) | stays, dev/test only |
| Behavioural proof | `db/mvp/verify.sh` | stays; CI runs it |
| Pre-MVP snapshot | `db/schema.sql` | archive then delete |
| Pre-MVP reconciler | `db/run-sqleditor.sql` | archive then delete |
| 62 migrations | `db/migrations/*.sql` | archive then delete (never rewritten) |
| Pre-MVP reconciler proof | `db/verify-reconciler.sh` | delete with the pair |
| `schema_migrations` ledger | production + canonical pair | retired with the migration chain |

## 2. Consumers that must be checked before the switch

Every item below was inspected in Phase 2. None may be changed blindly.

| Consumer | What it does today | Cutover consequence |
|---|---|---|
| `backend/server.ts` `ensureVariantTables()` | reads `db/migrations/028_*` and runs `ALTER TABLE` at boot | must be deleted only after the MVP schema is the deployed DB (Phase 3) |
| `ensureVelRepeatV2Tables()` | reads `db/migrations/034_*`; gated by `VELREPEAT_ENABLED` | deleted with the VelRepeat code |
| `ensureCheckoutIdempotencyTable()` | reads `db/migrations/035_*` | replaced by `checkout_requests` in the MVP schema; delete with the rewrite |
| `ensureChatTables()` | reads `db/migrations/036_*` | deleted with chat |
| `backend/server.ts` `_diag/schema` | lists the pre-MVP table set | rewrite against the MVP table set |
| `.github/workflows/test.yml` | bootstraps `db/run-sqleditor.sql` | switch to `db/mvp/schema.sql` when the Phase 3 backend lands |
| `.github/workflows/production-db-migrate.yml` | applies `db/migrations/*.sql` on push to `main` | retire at cutover; it must never apply MVP DDL to the old database |
| `.github/workflows/production-db-verify.yml` | asserts the `schema_migrations` ledger + pre-MVP objects | replace with MVP object checks after cutover |
| `diag-neon-schema.yml`, `diag-stripe-payment-trace.yml` | read-only, pre-MVP columns | update/retire with the same change |
| `backend/tests/*` (15+ files) | read `db/schema.sql` and `db/run-sqleditor.sql` | Phase 3 deletes the pre-MVP tests; do not repoint them at the MVP files |
| `db/verify-reconciler.sh` | proves the pre-MVP reconciler | delete with the pair |
| `docs/`, `INSTALLATION.md`, `.ai/context/database.md` | describe the pre-MVP pair | update in the cutover commit |
| Render service | `DATABASE_URL` in the dashboard (no `render.yaml` in the repo) | switch only after the new DB is seeded/booted |

## 3. Cutover sequence (do not reorder)

**Phase 3 must first rewrite the backend against the MVP model** (routes,
repositories, checkout, webhook). The schema cannot lead the code: the deployed
backend issues queries for `shops`, `product_selling_units`, `checkout_groups`,
reviews and chats, which the MVP schema intentionally does not have.

1. **Create a NEW empty database** (Neon branch or database). Never the live one.
   Record its identity: `current_database()`, host, `server_version`.
2. **Bootstrap it once** with `db/mvp/schema.sql`; run `db/mvp/verify.sh` against a
   disposable copy of that database. Expect 100% pass.
3. **Deploy the Phase 3 backend to staging** with `DATABASE_URL` pointing at the
   new database. Prove, in order: signup/login → seller apply → owner approve →
   product draft → submit → approve → publish → add to cart → checkout → Stripe
   TEST session → signed webhook → order paid → stock committed once → refund-out
   of scope → cancel/expiry releases stock.
4. **Prove idempotency again on that database:** replay the same webhook (no
   second settlement), repeat the checkout request key (same order), retry the
   session (no second live payment), kill the webhook mid-transaction (500 so
   Stripe retries).
5. **Switch CI**: bootstrap `db/mvp/schema.sql` into the disposable container;
   delete the pre-MVP tests and `db/verify-reconciler.sh` in the same commit;
   keep `db/mvp/verify.sh` and `mvp-schema-contract.test.ts`.
6. **Switch Render** `DATABASE_URL` to the new database during a maintenance
   window. Keep the old database **read-only** and reachable for rollback.
7. **Retire the pre-MVP production workflows**: `production-db-migrate.yml`
   (never let it apply 62 migrations to the MVP database) and the
   `schema_migrations` assertions. Replace verify with MVP object checks.
8. **Delete the boot-time DDL** (`ensure*` functions) and the pre-MVP pair in one
   atomic commit. Update `AGENTS.md` rule 4, `.ai/AI_RULES.md` §6,
   `.ai/context/database.md`, `INSTALLATION.md`, `docs/DATABASE.md`, `db/README.md`.
9. **Rename the MVP files** to their final names:
   `db/mvp/schema.sql` → `db/schema.sql`, `db/mvp/reset.sql` → `db/reset.sql`,
   `db/mvp/seed.sql` → `db/seed.sql`; keep `db/mvp/verify.sh` (or move it to
   `db/verify-mvp-schema.sh`).

## 4. Data migration — explicitly out of scope (D1)

D1 chooses a **clean database**, not a data migration. There is no backfill
script in Phase 2 and none may be invented silently. If the owner later decides
that real users, products or orders must be carried over, that is a separate,
reviewed project with a frozen source snapshot and a row-by-row mapping:

- pre-MVP `shops` + `sellers` → `seller_profiles` (one shop per seller is an app
  invariant, not a DB one — check for multi-shop sellers first);
- pre-MVP `products.shop_id` → `seller_profiles.id` via `shops.seller_id`;
- `inventory` + `product_variants.stock` → ONE `inventory` row per
  `(product, variant)`; a product with both would need a documented merge rule;
- 12-value `orders.status` + `order_state` + `fulfillment_status` → the six-value
  MVP axis; every legacy value needs an explicit mapping, and `refunded` /
  `payment_failed` / `expired` have no MVP order state;
- selling-unit lines (`selling_unit_pieces` / `selling_unit_name`) → the MVP
  `product_selling_units` shape (`label`, `base_quantity`, own `price`) and the
  `order_items` snapshot (`selling_unit_label`, `selling_unit_base_quantity`,
  generated `base_quantity_total`); prices and snapshots must be recomputed from
  the stored snapshots, never from current product prices;
- VelRepeat, chat, reviews, wishlist, memory, wholesale, employees: **not
  migrated** (non-MVP domains).

No mapping is executed in Phase 2.

## 5. Rollback

Before step 6, rollback is "keep using the old database" — it was never changed.
After step 6, rollback is the reverse of step 6: point Render's `DATABASE_URL`
back at the untouched old database and redeploy the previous build. The old
database stays read-only (no writes from the new backend) until the owner signs
off. Never delete it in the same change that cuts over.

## 6. What Phase 3 must change in code (contract, not implementation)

| Domain | MVP contract |
|---|---|
| Seller | `seller_profiles`, `status='approved'` gate at every product write; `pending`, `rejected`, `suspended` cannot create/submit/publish |
| Product | `products.seller_id` (no shop join); lifecycle `status`; `approval_status` is read-only; variants have no stock |
| Inventory | one `inventory` row per `(product_id, variant_id)`; reserve with the guarded `UPDATE ... WHERE quantity - reserved >= n`; commit `quantity/ reserved` together; release once on cancel/expiry |
| Cart | one cart per `(user, seller)`; never merge sellers; `cart_items.seller_id` is FK-locked |
| Checkout | one order per cart; `checkout_requests(user_id, request_key)`; server re-reads price, seller status and stock inside the transaction |
| Order | one `status`; timestamps required by the table CHECKs; `shipping_address` JSONB snapshot; `order_items` snapshot names/prices |
| Payment | Stripe only; raw body + signature; `payment_events.event_id` claim; one settlement transaction; the DB never marks an order paid by itself |
| Auth | email/password core; `revoked_tokens`; Google OAuth is parked (no `auth_identities` in the MVP schema) |

## 7. Stop conditions for the cutover

Stop and report — do not improvise — if any of these is true:

- the production database identity cannot be proven;
- a production dependency on a removed table is found (a route, job, report or
  external service still reads it);
- data must be carried over (see §4);
- the new schema would change payment or auth semantics;
- any step requires `DROP`/`TRUNCATE` on production;
- a real Stripe TEST round trip has not been observed on the new database.
