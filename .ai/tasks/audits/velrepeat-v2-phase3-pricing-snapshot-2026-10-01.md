# VelRepeat V2 — Phase 3: Seller Package → draft Repeat Plan → Immutable Pricing Snapshot

**Repository:** `EnJirad/velnox-marketplace` · branch `main`
**Base commit (verified before any edit):** `47badf014f71b3f45dccb157bf2084e94b780c7a` (= `origin/main`,
the attempt-1 stop report `.ai/tasks/audits/velrepeat-v2-phase3-pricing-snapshot-2026-09-30.md`)
**Implementation commit:** `feat(velrepeat): integrate v2 package pricing snapshots` — the commit that
contains this audit; its SHA is `main`'s HEAD after the push reported with the phase result.
**Status:** IMPLEMENTED · locally verified · DB-gated half verified only by CI `postgres:16`.
**NOT production-ready** — see §10 and §11. Nothing in this phase touched production.

**Owner decisions implemented:** Q-A (`draft` → Stripe success → `active`), Q-B (`approved` seller =
eligible), Q-C (plan before payment), and the already-locked **G1** (sequential/multiplicative),
**G1.1** (30% cap, fail closed), **G2** (THB, one final 2-decimal round), **G3 = B** (one package =
exactly one seller), **E / PX** (purchase-time snapshot is frozen truth).

---

## 1. What changed

| File | Δ | Nature |
|---|---|---|
| `backend/routes/velrepeat-v2-plans.ts` | **new**, 699 lines | The whole phase: customer package read, purchase-time validation, canonical pricing, draft plan + immutable snapshot in one transaction. |
| `backend/tests/velrepeat-v2-phase3-pricing-snapshot.test.ts` | **new**, 1636 lines | 69 tests: request validation, availability/eligibility, exact money, pricing (G1/G1.1/G2), the customer view, refusal mapping, schema + scheduler structure, module boundaries, V1 regression, and 13 DB/HTTP integration tests. |
| `backend/routes/velrepeat-packages.ts` | +11 / −2 | **Additive only.** `ValidatedPackageItem` gains `shopId` and the composition query selects `p.shop_id`, because `velrepeat_items.shop_id` is NOT NULL and the ownership resolution already happens in that one query. No existing field, rule or branch changed. |
| `backend/server.ts` | +4 | **Additive only.** Import + `setupVelRepeatV2PlanRoutes(app);` after the existing V2 package mount. |

**Not touched (verified by `git status`):** `db/schema.sql`, `db/run-sqleditor.sql`, `db/migrations/**`,
`backend/lib/inventory.ts`, `backend/lib/order-fulfillment.ts`, `backend/lib/order-lock.ts`,
`backend/lib/payment-config.ts`, `backend/lib/payment-reservation.ts`, `backend/routes/stripe.ts`,
`backend/jobs/**`, `backend/routes/velrepeat-plans.ts`, `backend/routes/velrepeat.ts`,
`backend/lib/velrepeat-pricing.ts`, `backend/lib/money.ts`.

## 2. API surface

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/velrepeat/v2/packages/:packageId` | session | Customer package read: the validated composition only. |
| `POST` | `/api/velrepeat/v2/plans` | session | Create the **draft** plan + immutable snapshot from a package. |

**Why `/v2/` and not the brief's example `GET /api/velrepeat/packages/:packageId`:** that exact path is
**already owned by V1** — `backend/routes/velrepeat.ts:252`, reading the V1 `vrepeat_packages` table —
and it is mounted before the V2 modules. Registering a second handler on it would shadow one of the two
and would be precisely the duplicate endpoint §3 forbids. `POST /api/velrepeat/plans` and
`/api/velrepeat/repeat-now` are V1's as well (§14). The V2 customer surfaces therefore live under a
namespace that cannot collide: **no V1 path, table, mount order or behavior was changed.**

**Request (POST) — references and quantities only.** `packageId` (UUID), `commitmentCycles` (positive
integer), `frequencyType` (`days|weeks|months`), `intervalValue` (positive integer). The schedule is
**required** — a prepaid commitment's schedule is part of the agreement, so no silent default is applied
for the customer (V1's defaulting is V1 behavior and is not inherited). A body carrying `seller_id`,
`unit_price`, `base_price`, `final_price`, `discount` or `pricing_rule` parses to the same four fields:
those keys are never read (§4/§5, pinned by a test).

**Response (POST, 201).** `data.plan` = `{ id, status: "draft", frequencyType, intervalValue,
commitmentCycles, nextRunAt }`; `data.pricing` = `{ currency, basePrice, discountAmount, finalPrice,
effectiveDiscountPercent }`; `data.snapshotId`. The applied rule set is **persisted but not returned** —
internal pricing configuration is not customer-facing (§3).

**Refusals** (canonical envelope `{ success: false, error: { code, message } }`):

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | malformed `packageId`/`commitmentCycles`/`frequencyType`/`intervalValue` |
| 404 | `PACKAGE_NOT_FOUND` | package missing **or** `is_active = false` (indistinguishable, as the seller-side read already is) |
| 409 | `PACKAGE_NOT_PURCHASABLE` | seller not `approved` (Q-B), empty composition, or **any** composition refusal (cross-seller, unpublished product, inactive/foreign variant) |
| 409 | `PRICING_UNAVAILABLE` | rule set malformed, cap exceeded (G1.1), or unusable pricing input |
| 401 | `UNAUTHORIZED` | no session (existing `requireAuth`) |

Refusal messages never carry internal state: the reason (which product, which status, the cap, the rule
keys, the numbers) is logged server-side and asserted in tests instead.

**Customer read shape.** `{ id, name, description, currency, basePrice, items: [{ productId, variantId,
productName, variantName, shopName, quantity, unitPrice, lineTotal, imageUrl }] }`. The item set is driven
by the **validated** lines, never by the projection, so an item that failed the purchase gate cannot
appear; **no** seller id, product/variant status, stock, cost, audit metadata or pricing configuration is
returned. An unpurchasable package cannot be read at all (409/404) — nothing leaks, because nothing is
served.

## 3. The flow, step by step (all server-side)

```
withTransaction(async (client) => {
  1. loadPurchasablePackage(client, packageId)      // package + seller in ONE statement
     • exists and is_active = true                  → else 404 PACKAGE_NOT_FOUND
     • sellers.status = 'approved'                   → else 409 PACKAGE_NOT_PURCHASABLE   (Q-B)
  2. items := velrepeat_package_items for the package  (quantity > 0 is a DB CHECK)
  3. authorizePackageComposition(client, package.seller_id, items)   // THE Phase 2 G3 gate, reused
     • product exists · owner_seller_id = package.seller_id · product published (isPubliclyVisible)
     • variant belongs to that product · variant status = 'active'
     → catalog unit price per line, as an exact NUMERIC string
     any refusal ⇒ 409 PACKAGE_NOT_PURCHASABLE (reason logged, never returned)
  4. rules := loadPricingRuleSet(client)            // platform_settings, the one configuration store
  5. lines := packageLinesFromItems(items)          // parseDecimal(catalog string) — no float exists
  6. INSERT INTO velrepeat_plans (user_id, status='draft', frequency_type, interval_value,
     commitment_cycles, next_run_at)                // Q-A. No payment_method. No started_at.
  7. INSERT INTO velrepeat_items … for each validated line  // existing composition architecture (§40.1)
  8. pricing := computeCommitmentPricingWithLines({ planId, commitmentCycles, lines, rules,
     sellerId, packageId })                         // G1 → G1.1 → G2, the Phase 2 engine
  9. snapshotId := insertPricingSnapshot(client, request, pricing)   // snapshot + snapshot items
 10. INSERT INTO velrepeat_events (plan_id, 'PLAN_CREATED', metadata) // existing audit vocabulary
})
```

Step 6 comes before step 8 because `computeCommitmentPricingWithLines` takes the real `planId` (it is the
request object `insertPricingSnapshot` consumes). Atomicity makes the order irrelevant to safety — and two
tests prove it: a **cap breach** (a pricing failure *after* the plan insert) and a **snapshot INSERT
failure** both leave **zero plans, zero lines and zero snapshots** behind (§6).

## 4. Pricing

The calculation, exactly as the owner locked it — no second engine, no hard-coded price or discount:

* **Base price** = Σ (package item quantity × authoritative catalog price), exact and unrounded.
  `products.price` / `product_variants.price` are `NUMERIC(12,2)`; the driver returns them as decimal
  strings and `parseDecimal` turns each into an exact rational. `parseFloat`/`Number(` appear nowhere in
  the module (asserted).
* **Rules** come from `platform_settings.velrepeat_pricing_rules` (`loadPricingRuleSet`), applied in
  persisted `priority` order (ties broken by key, then version).
* **G1 — sequential/multiplicative.** Fixture package 320.00 with a 7% and a 5% rule: 320 → 297.60 →
  **282.72**, effective **11.65%** (additive 12% would give 281.60). The owner's worked example
  (1,000 → 930 → 883.50) is asserted directly too.
* **G1.1 — 30% cap, FAIL CLOSED.** Exactly 30% is allowed (inclusive); 20% + 20% (= 36%) **throws**
  `PricingCapExceededError` — no clamp, no trim, no scale, no silent reduction. It surfaces as 409
  `PRICING_UNAVAILABLE` with no numbers in the body.
* **G2 — THB, full precision, one final round.** A non-THB currency is refused by the engine; the
  snapshot records `currency = 'THB'`. Rounding happens once, at the final output: base 0.05 with 7% + 5%
  computes `0.0465 → 0.044175` exactly and charges **0.04** — a pipeline that rounded after the first
  rule would have charged 0.05. Asserted, plus the exact unrounded value is kept in the snapshot
  metadata (`final_price_exact`).

## 5. Snapshot structure (purchase-time truth)

`velrepeat_pricing_snapshots` (existing columns only — no new column, no new table):

| Column | Value |
|---|---|
| `plan_id` | the draft plan (FK, `NOT NULL REFERENCES velrepeat_plans(id)`) |
| `commitment_cycles` | the customer's commitment (Q-A flow input) |
| `currency` | `THB` |
| `subtotal_amount` | base price (320.00) |
| `discount_type` | `sequential_percentage` |
| `discount_value` | effective discount percent (11.65) |
| `discount_amount` | base − final (37.28) |
| `total_amount` | the one charge (282.72) |
| `pricing_rule_key` / `pricing_rule_version` | `commitment_4_cycles+package_loyalty` / `2026-09-30+2` |
| `metadata` | `seller_id`, `package_id`, `applied_rules[]` (key, version, discountType, discountValue, priority, factor), `base_price`, `final_price_exact`, `effective_discount`, `max_effective_discount`, `cap_enforced` |

`velrepeat_pricing_snapshot_items`: `product_id`, `variant_id`, `quantity`, `unit_price` (at purchase),
`line_total` — one row per validated line, written by the canonical `insertPricingSnapshot()`.

Package identity and seller identity therefore ride in the existing `metadata` JSONB (the Phase 2
decision): **no `package_id` column was added** to `velrepeat_plans` or anywhere else. `velrepeat_plans`
itself is deliberately left clean — `metadata` stays `{}` (no duplicate provenance), `payment_method`
keeps the schema default, `payment_method_ref` is NULL, `started_at` keeps its DEFAULT.

## 6. Transaction boundary and atomicity proofs

Plan + plan lines + snapshot + snapshot items + creation event are **one** `withTransaction` call
(`backend/db/index.ts`); the module contains no `BEGIN`/`COMMIT`/`ROLLBACK` of its own and never borrows a
client directly (asserted structurally). Two independent failures prove the rollback:

1. **Pricing failure after the plan insert** — 20% + 20% rules → `PricingCapExceededError` → 409; the
   buyer has 0 plans, 0 lines, 0 snapshot items.
2. **Snapshot INSERT failure** — a catalog price of 9,999,999.99 × quantity 2,000 = 19,999,999,980.00
   exceeds the snapshot's `NUMERIC(12,2)` (max 9,999,999,999.99), so the plan row and its lines are
   inserted and the **snapshot statement itself fails** (22003) → rollback → **NO PLAN, NO SNAPSHOT, NO
   LINES**, and no orphan snapshot exists anywhere.

The second case is a real, representable input rather than an injected mock: it is the exact "plan INSERT
succeeds, snapshot INSERT fails" scenario, and it also documents a genuine limit of the current schema
(§11.1).

## 7. Tests

`backend/tests/velrepeat-v2-phase3-pricing-snapshot.test.ts` — 69 tests, **56 pass / 13 skip locally**
(the 13 need `TEST_DATABASE_URL`; CI's disposable `postgres:16` runs them).

* **Pure (run everywhere):** request validation incl. every forbidden client field; package availability
  and Q-B seller eligibility (with non-leak assertions); exact money (`0.10` exact, `0.10 × 3 = 0.30`
  not `0.30000000000000004`); base price; G1 sequence; the 30% boundary; the cap breach (refused, and
  reported without the cap/numbers/rule keys); THB; the no-intermediate-rounding case; the commitment
  input rules; the customer view (only validated items, exact key set, no leaked ids/statuses/stock);
  refusal mapping (an unknown error stays a 500).
* **Structural:** `'draft'` is legal and the default stays V1's `'active'`; the due index and the V1 due
  selection/claim both require `status = 'active'`; `next_run_at NOT NULL`; snapshot FK and CHECKs;
  quantity CHECKs; **every column the write path names exists in the schema**; both SQL files
  byte-identical; no migration 051; `db/run-update.sql` absent; the module cannot write `active`,
  `payment*`, inventory, orders or cycles, and cannot read a seller or a price from the request; the V2
  paths cannot collide with V1's; mounts are additive; V1's create/`repeat-now`/COD guard/float path and
  the scheduler's reprice-order-stock-COD statements are unchanged; the migration set is unchanged.
* **CI (first run for this commit, `36797879884`):** 1718 pass / 2 skip / **1 fail** — and the failure was a
  **test-side** assertion, not a behavior: the snapshot's `metadata.max_effective_discount` is the
  canonical exact decimal of the cap (`"0.3"`), not a 2-decimal rendering (`"0.30"`). The production path
  was correct; the assertion was corrected in the follow-up commit (`fix(velrepeat): correct a phase 3
  cap assertion`). **The other 12 integration tests passed on CI's `postgres:16`** — including the
  immutability proof, both atomicity proofs, the scheduler refusal and the V1 regression.
* **Integration (DB + real HTTP, CI):** read (200, validated composition, subtotal 320.00, nothing
  internal; 401 anonymous; any customer may read); create (201 draft + snapshot + items + plan lines +
  event; `payment_method_ref` NULL; plan `metadata` `{}`); six refusals (missing, inactive, cross-seller,
  unpublished product, archived variant, variant of another product, unapproved seller) each leaving
  **nothing** written; malformed requests refused before any read; the cap breach over HTTP; the snapshot
  failure above; **a due `draft` is not processed by V1** (`processPlan` → `null`, no run row, status
  still `draft`) while **an `active` plan with the same past due date IS processed** (V1 regression);
  and **immutability** — after the product price, the variant price, the package composition and the
  pricing rules all change, the snapshot row and its items are byte-identical, and the plan's own lines
  still carry the purchase-time prices.

## 8. V1 regression

V1 files are untouched (`git status`), and the suite proves the behavior: `POST /api/velrepeat/plans`
still writes `'active'`, `repeat-now` exists, the COD-only guard is intact, `resolvePlanItem`'s float
path is intact, and the scheduler still reprices, orders, reserves stock, mutates `sold_count` and settles
COD. At DB level the same `processPlan` call refuses a `draft` and processes an `active` plan — the Q-A
boundary and the V1 engine are exercised by one code path. Full suite: **1501 pass / 220 skip / 0 fail**
(1721 tests, 57 files) — the previous run was 1445 pass / 207 skip; the deltas are exactly this file's
56 + 13 tests. **No V1→V2 migration, no V1 plan changed, no second plan-status vocabulary.**

## 9. Schema / database status

**No schema change was required and none was made.** `db/schema.sql` and `db/run-sqleditor.sql` remain
byte-identical (`cmp` clean) and unmodified; `db/migrations/` still ends at `050_orders_status_check.sql`;
no `051` was created; `db/run-update.sql` was not recreated. The phase writes existing columns only:
`velrepeat_plans(user_id, status, frequency_type, interval_value, commitment_cycles, next_run_at)`,
`velrepeat_items(plan_id, product_id, variant_id, shop_id, seller_id, quantity, unit_price)`,
`velrepeat_events(plan_id, event_type, metadata)`, plus the snapshot tables through the canonical helper.

## 10. Production status

**Production is untouched and unverified.** No migration was added, so `.github/workflows/migrate-neon.yml`
did not fire for this change; migrations `048`/`049`/`050` remain unapplied (owner action, Neon quota), and
the V2 tables (`velrepeat_packages`, `velrepeat_pricing_snapshots`, …) still **do not exist** in Neon. The
new routes are additive code in `backend/`, and a V2 draft plan is invisible to the running V1 scheduler by
construction (`status = 'active'` is required in the due query, in the row-lock claim and in the partial
index). **No claim of a working production feature is made here.**

## 11. Known limitations and open items

1. **A commitment total beyond `NUMERIC(12,2)` cannot be snapshotted**, and is refused atomically (the
   §6.2 case). Whether such a commitment should be blocked earlier — and by which rule — is not decided;
   Phase 4 must not charge for a plan that cannot be priced.
2. **No plan-creation idempotency.** The repository's only canonical mechanism (`checkout_requests`) is
   checkout/payment-scoped; adding one for plan creation would require inventing business semantics (key
   scope, replay window, TTL), which the brief forbids. Phase 3 creates **no** irreversible effect (no
   charge, no reservation, no order — a duplicate is an extra draft), and **payment idempotency is
   explicitly Phase 4's** (Q-C). Recorded as a Phase 4 dependency, not guessed at.
3. **`payment_method` is not written by this phase.** Phase 1 already assigns "payment_method semantics
   (Q13/Q14)" to Phase 4, and Q-C gives Phase 4 the plan payment linkage, so the column keeps its schema
   default and `payment_method_ref` stays NULL. **Phase 4 must set the real rail/method and must never
   activate a draft whose `payment_method` is still the unset default.**
4. **`started_at` keeps its DEFAULT and `next_run_at` is a creation-time derivation**
   (`calculateNextRunAt(now, frequency, interval)` — the canonical V1 helper, the only non-arbitrary value
   for a NOT NULL column). Phase 4 owns the activation instant and **must re-anchor both** when it flips
   the plan to `active`, otherwise the first cycle counts from the draft instant.
5. **No shipping address is captured** (not part of this phase's scope) — `shipping_address_id` and
   `shipping_address` stay NULL; Phase 4/5 owns collecting and freezing the address at payment.
6. **No quote endpoint**: the read returns catalog line prices and the base subtotal, not a final price
   for a chosen commitment. The final price appears in the create response and in the snapshot.
7. **`products.vrepeat_enabled` (V1's per-product pay-per-run opt-in) is NOT part of the V2 purchase
   gate.** V2 uses Phase 2's canonical composition eligibility (`published` + single-seller ownership +
   active variant). No V2 document mentions the flag; both V1 customer paths and the V1 scheduler do
   consult it. **Phase 5/7 must decide whether V2 fulfillment honors it** — and Phase 4 must not charge a
   plan that could never be fulfilled. Pinned by an explicit test so it cannot drift silently.
8. **Still open from Phase 2/1 (unchanged):** `PRICING_CAP_POLICY` alternatives (clamp/trim) if the owner
   ever wants them, absolute-amount rules, rule scoping, per-cycle price derivation and the rounding
   remainder, refund/skip/pause/out-of-stock money, `sold_count` moment, reservation window, multi-seller
   attribution, plan/cycle status vocabularies (`pending_payment`, `due`, `reserved`, `fulfilled`).
9. **DB-gated tests cannot run in this workspace** (no local PostgreSQL) — the 13 integration tests are
   verified by CI's disposable `postgres:16` only. The CI result for the implementation commit is reported
   with the phase result; nothing here claims they passed locally.

## 12. Next-phase dependencies (Phase 4 — Stripe prepaid payment)

* `payments` stays the canonical payment authority; one plan-level prepaid charge (Q13 = B, Q14);
  `payments.order_id NOT NULL` needs the plan-level linkage the owner approved — **do not fake
  `orders.total_amount`, do not make Cycle 1 hold the money**.
* Set `payment_method` / `payment_method_ref` and the payment row on the plan; make the webhook
  idempotent; a late webhook must not create wrong fulfillment; payment success must **not** mark cycles
  complete.
* `draft → active` only on confirmed payment; re-anchor `started_at` / `next_run_at`; never activate via
  any path that would expose an unpaid plan to the scheduler.
* Own payment idempotency (§11.2) and refuse to charge a plan that cannot be priced/fulfilled (§11.1/§11.7).
* Reserve per cycle (A/Q1 = B) — not at purchase, not here.

## 13. Verification performed (this commit)

```
bun run test                 → 1501 pass / 220 skip / 0 fail   (1721 tests, 57 files)
bun test <phase 3 suite>     → 56 pass / 13 skip / 0 fail       (69 tests)
cd backend && bunx tsc --noEmit → clean
bun run typecheck            → 4/4 apps clean
bun run build:apps           → 4/4 apps built
git diff --check             → clean
cmp db/schema.sql db/run-sqleditor.sql → identical
git status                   → only the 4 files in §1 (no protected file touched)
```

**Explicit non-claims:** not production-ready; no production deployment verified; no Stripe integration;
no inventory, fulfillment, order, cycle or payment behavior; DB-gated tests not executed locally.
