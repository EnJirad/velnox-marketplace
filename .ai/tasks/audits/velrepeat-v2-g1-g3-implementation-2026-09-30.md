# VelRepeat V2 — G1 / G1.1 / G2 / G3 Implementation Audit

```
STATUS: IMPLEMENTED — Phase 2 pricing engine + G3 seller-owned packages
BLOCKS: Phase 4/5/6/7/8/9 remain blocked on decisions listed in §9
```

**Repository:** `EnJirad/velnox-marketplace` · branch `main` · base commit `65a53db666a8e43dda3e0dba15d537631f62e257`
**Date:** 2026-09-30
**Predecessors:** `.ai/tasks/audits/velrepeat-v2-owner-decisions-pending-2026-09-30.md`,
`.ai/tasks/audits/velrepeat-v2-owner-decision-closure-2026-09-30.md`

---

## Tag legend

| Tag | Meaning |
|---|---|
| `[OWNER DECISION]` | Locked by the owner for this pass; implemented exactly as stated |
| `[IMPLEMENTED]` | Exists in code/schema in this commit |
| `[PROVEN]` | Verified against source at the cited `file:line` in this pass |
| `[BLOCKED]` | Needs a further owner decision; deliberately not implemented |
| `[STOPPED]` | A stop condition in the task brief was reached and handled explicitly |

---

## 1. Owner decisions implemented

| ID | Decision | Implemented as |
|---|---|---|
| **G1** | **B — Sequential / multiplicative.** Each rule discounts the price the previous rule produced. 1,000 → 7 % → 930 → 5 % → **883.50**, never 880.00. | `computeCommitmentPricing()` in `backend/lib/velrepeat-pricing.ts` folds the rule list left-to-right with exact rational multiplication. |
| **G1.1** | Maximum total **effective** discount **30 %**, i.e. the final price is never below 70 % of the base. Must hold for a single rule, for combined rules, and against floating-point drift. | `MAX_EFFECTIVE_DISCOUNT` (exact `0.3`) + a hard refusal, `PricingCapExceededError`. See §5. |
| **G2** | THB; full precision through the pipeline; **one** 2-decimal rounding at the final price; no intermediate rounding; no FLOAT/DOUBLE as a monetary source of truth. | `backend/lib/money.ts` (exact `bigint` rationals) + `toMoneyString()` called exactly once, in the engine's return path. |
| **G3** | **B — Seller-owned package.** A seller authors its own package; the package has one clear owner; only that seller's products/variants may be composed; platform still controls pricing; no multi-seller package in V2; fail closed. | `velrepeat_packages.seller_id NOT NULL REFERENCES sellers(id)` + `backend/routes/velrepeat-packages.ts`. See §4. |
| **E / PX** | The purchased plan's price is frozen at purchase; later price / package / rule changes must not move it. | `computeCommitmentPricingWithLines()` + `insertPricingSnapshot()` write the base, the ordered applied rules, the effective discount, the exact unrounded price and the composition into the **existing Phase 1** snapshot tables. |

---

## 2. Files changed

### New

| File | Purpose |
|---|---|
| `backend/lib/money.ts` | Canonical decimal-safe money: exact `bigint` rational arithmetic, half-up rounding at a chosen scale, exact terminating expansion. |
| `backend/lib/velrepeat-pricing.ts` | The pricing engine: ordered sequential rules, the 30 % cap, the platform rule-set loader, and the purchase-time snapshot writer. |
| `backend/routes/velrepeat-packages.ts` | Seller package CRUD, per-item authorization, the single-seller invariant. |
| `backend/tests/velrepeat-money.test.ts` | 21 tests — G2 arithmetic and rounding. |
| `backend/tests/velrepeat-pricing.test.ts` | 437 tests — G1/G1.1/G2/E plus 400 seeded invariant samples. |
| `backend/tests/velrepeat-packages-ownership.test.ts` | 29 tests — G3 ownership, structural + DB-gated. |

### Modified

| File | Change |
|---|---|
| `db/schema.sql` | `velrepeat_packages.seller_id` + `idx_velrepeat_packages_seller`. |
| `db/run-sqleditor.sql` | Identical change; the two files remain byte-identical. |
| `backend/server.ts` | Import + `setupVelRepeatPackageRoutes(app)` beside the other VelRepeat mounts. |
| `backend/tests/velrepeat-v2-domain-schema.test.ts` | Phase 1 fixture now supplies `seller_id`; new structural assertion for the G3 column. |

### Explicitly NOT touched

`backend/routes/stripe.ts`, `backend/lib/inventory.ts`, `backend/lib/order-fulfillment.ts`,
`backend/lib/order-lock.ts`, `backend/lib/payment-config.ts`,
`backend/lib/payment-reservation.ts`, `backend/jobs/**`, `backend/routes/velrepeat.ts` (V1),
`backend/routes/velrepeat-plans.ts`, `db/migrations/**`, `apps/**`, `packages/**`,
and `db/run-update.sql` (still absent).

---

## 3. Schema changes

Both canonical files, byte-identical after the edit:

```sql
CREATE TABLE IF NOT EXISTS velrepeat_packages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  seller_id UUID NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  ...
);
CREATE INDEX IF NOT EXISTS idx_velrepeat_packages_active ON velrepeat_packages (is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_velrepeat_packages_seller ON velrepeat_packages (seller_id);
```

| Decision | Rationale |
|---|---|
| Reused the existing `sellers` identity | No new account/tenant table was invented. `sellers` is the identity every seller surface already authorizes against. |
| `NOT NULL` | The business invariant is "a package is seller-owned". A nullable owner would make an ownerless package representable — and an ownerless package has no one to enforce the invariant for. |
| `ON DELETE CASCADE` | Matches `products.shop_id`, `velrepeat_items.seller_id` and the rest of the schema: a seller's rows go with the seller. |
| `idx_velrepeat_packages_seller` | The real access pattern is "this seller's packages", which every endpoint in the new route file uses. |
| `velrepeat_package_items` deliberately unchanged | Item ownership is **derived** through `products → shops → sellers`. Adding a denormalized `seller_id` would create a second column that can disagree with the package owner — exactly the "duplicate authority" the task forbids. |

**No migration file was created.** `db/migrations/` still ends at `050_orders_status_check.sql`.
`velrepeat_packages` does not exist in production at all (Phase 1 is unreleased), so the canonical
files are the only place these objects live — see §10.

---

## 4. Package ownership invariant

```
velrepeat_packages.seller_id  ==  seller_id of every referenced resource
```

**Enforced structurally, not by a repair pass.** `authorizePackageComposition()` resolves every
line through the canonical ownership chain in one query:

```sql
FROM products p
JOIN shops sh ON p.shop_id = sh.id
LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.id = $2
WHERE p.id = $1
```

and refuses the line unless **all** hold:

| # | Check | Refusal code |
|---|---|---|
| 1 | the product exists | `PRODUCT_NOT_FOUND` |
| 2 | `sh.seller_id == package seller_id` | `PRODUCT_NOT_OWNED` |
| 3 | `isPubliclyVisible(p.status)` — i.e. `published`, the canonical rule from `backend/lib/product-lifecycle.ts` | `PRODUCT_NOT_ELIGIBLE` |
| 4a | the variant belongs to *that* product | `VARIANT_NOT_FOUND` |
| 4b | the variant's own status is `active` (`CHECK (status IN ('active','inactive','archived'))`) | `VARIANT_NOT_ELIGIBLE` |
| 5 | `quantity` is a positive integer (pre-checked in `parsePackageItems`) | `VALIDATION_ERROR` |

Because **every accepted line is proven to belong to the package's seller**, "all lines share one
seller" is a consequence of check #2 rather than a separate check that could be forgotten.
`assertSingleSeller()` restates it at the end of the loop.

**The whole request is one transaction.** `withTransaction()` wraps every handler, so a rejection on
line 3 rolls back the package row too — there is no partial package, no orphaned line, and no
"skip the bad item and keep the rest".

**Authorization identity is never client-supplied.** The seller is resolved only via
`sellers.user_id = req.user.userId`; writes are claimed with `WHERE id = $1 AND seller_id = $2`, so
another seller's package is indistinguishable from a missing one. The tests pin this by asserting
the file contains no `req.body.seller_id` / `req.body.sellerId` read.

**Multi-seller readiness without multi-seller capability.** The only thing a future cross-seller
package would change is check #2's comparison — and then the payment/attribution model, which is an
open decision (§9). In V2 the validator **fails closed**: it rejects, and never splits a package,
creates a second order or payment, rewrites the seller, or substitutes a product. Those verbs are
absent from the code, and a test asserts it against comment-stripped source.

---

## 5. Pricing algorithm

```
base price  (exact: Σ unitPrice × quantity over the snapshotted lines)
  → rule[0]  price = price × (1 − discount[0])
  → rule[1]  price = price × (1 − discount[1])
  → … exactly one round-half-up to 2 decimals → the charge
```

**Rule ordering is canonical and total.** `orderPricingRules()` sorts by the persisted `priority`
ascending, then `key` ascending. The tie-break is what makes the order total — without it, two rules
sharing a priority would be ordered by however the array happened to be built. Object iteration order
and database row order are never consulted. A test asserts that reversing the input array produces a
byte-identical price.

**Rule storage reuses the existing platform configuration table.** `platform_settings` already holds
platform-owned settings (`product_approval_mode`); H/Q11 made pricing "platform-controlled, data-driven
configuration", so rules live there under `velrepeat_pricing_rules` as a JSON array of
`{ key, version, discount_type, discount_value, priority }`. **No new configuration table was
created.** Every field is validated and the whole set fails closed — a malformed rule is never
partially applied, because silently skipping one would change what the customer pays.

**Only percentage rules are supported.** Absolute/fixed-amount rules are rejected with a
`PricingConfigurationError`. Mixing an absolute rule into a multiplicative chain makes the result
depend on chain order, and the 30 % cap is defined relative to the base price — so accepting them
would require inventing interaction semantics. This is recorded as an open decision (§9).

---

## 6. 30 % cap behaviour — `[BLOCKED: resolution policy]`

> **The cap is enforced. The way a breach is RESOLVED is deliberately not implemented.**

When the sequential chain would take the effective discount above 30 %, `computeCommitmentPricing()`
**throws `PricingCapExceededError`**. It does **not**:

- trim the last rule,
- scale the rules down proportionally,
- keep only the highest-priority rule,
- or silently clamp the result to the 70 % floor.

**Why.** Those four are business policies, not implementation details: they differ both in what the
customer is charged *and* in what the snapshot records as applied. The task brief forbids choosing
them ("ห้ามเลือก policy เอง … trim last rule / scale all rules / highest-priority-only") and directs
that a breach produce a validation that fails closed. The invariant the owner stated — *the final
price must never fall below 70 % of the base* — therefore holds unconditionally: either a compliant
price is returned, or nothing is.

The refusal is typed and carries diagnostics (`basePrice`, `wouldBePrice`, `effectiveDiscount`) but
deliberately no `fix()` method, so no caller can quietly clamp.

**Boundary behaviour `[PROVEN]`:** the comparison is `effectiveDiscount > 0.30 → refuse`, so exactly
30.00 % is allowed and 30.01 % is refused. The effective discount is computed as
`1 − finalPrice / basePrice` on exact rationals, so no rounding can let a chain slip past the cap.

---

## 7. Rounding behaviour

| Property | How it is guaranteed |
|---|---|
| No float ever holds money | `Rational = { num: bigint; den: bigint }`. No IEEE-754 value is created anywhere in the pipeline. |
| No intermediate rounding | Nothing is rounded until `toMoneyString()`. `toExactDecimalString()` exposes the full terminating expansion so the audit trail proves it — e.g. `1000.01 × 0.8766 × 0.95` stays `832.7783277` and only then becomes `832.78`. |
| Exactly one rounding | `toMoneyString()` is called only in the engine's return path (and when writing snapshot rows, where the value is already final). |
| 2 decimals, always | `MONEY_DECIMALS = 2`; a test asserts the output matches `^-?\d+\.\d{2}$`. |
| Half-up | Matches the repository's existing behaviour: `backend/routes/stripe.ts` → `Math.round(n * 100)`, and PostgreSQL's `round(numeric, int)`. |
| Boundary input rejected | `parseDecimal` refuses exponent notation, `NaN`, `Infinity`, hex and empty strings — every shape a leaked float takes. A JSON `number` is converted **once** at the boundary and is exact thereafter. |

`backend/routes/stripe.ts`'s own `toMinor()` is **pre-existing and untouched**. It is Stripe
boundary code; replacing it would be a payment-architecture change, which this task forbids. It is
flagged in §9 as a known float-based helper that a future payment-architecture decision should
address.

---

## 8. Tests

| File | Tests | Runs locally | Runs in CI |
|---|---|---|---|
| `velrepeat-money.test.ts` | 21 | ✅ | ✅ |
| `velrepeat-pricing.test.ts` | 437 | ✅ | ✅ |
| `velrepeat-packages-ownership.test.ts` | 29 (18 structural + 11 DB-gated) | ✅ / skipped | ✅ / executed |
| `velrepeat-v2-domain-schema.test.ts` | updated +1 | ✅ / skipped | ✅ / executed |

**Coverage against the brief's list.**

*Package ownership* — seller creates own package ✅ · own product ✅ · own variant ✅ · another
seller's product **REJECT** ✅ · another seller's variant **REJECT** ✅ · mixed-seller **REJECT** ✅ ·
unauthorized update **REJECT** ✅ (the ownership-scoped `UPDATE … WHERE seller_id = $2` matches zero
rows).

*Pricing* — one discount ✅ · multiple sequential ✅ · deterministic order ✅ · effective ≤ 30 % ✅ ·
a case where sequential discounts mathematically exceed 30 % ✅ · no intermediate rounding ✅ ·
final rounding exactly 2 decimals ✅ · THB precision ✅ · zero / negative / invalid / non-THB /
non-decimal edge cases ✅.

*Snapshot* — purchased plan preserves the final price ✅ · composition and quantities preserved ✅ ·
ordered applied rules with exact factors recorded ✅.

*Invariant / property tests* — a seeded LCG (deliberately **not** `Math.random`, so a failure is
reproducible) generates 400 commitments with 0–4 rules each and asserts, for every one:

1. `0 ≤ effective_discount ≤ 0.30`;
2. `finalPrice ≥ 0.70 × base`;
3. the charge matches `^\d+\.\d{2}$`;
4. **no rule is ever silently dropped** — every input rule is accounted for, in ascending priority;
5. the result is deterministic, including under input reordering.

A second pass asserts that the **only** permitted failure across those 400 samples is the cap, that
what it refused really was below 70 % of the base, and that the generator actually exercises that
path (`refusals > 0`) so the cap can never silently stop being tested.

---

## 9. Unresolved blockers — deliberately NOT implemented

None of the following was guessed, defaulted, or worked around.

| # | Open item | Why it is not decided | Blocks |
|---|---|---|---|
| 1 | **Cap breach resolution** — clamp to the 70 % floor, trim the last rule, scale the rules, or keep only the top priority? | Each is a distinct business policy with a distinct customer-facing price. The task brief forbids selecting one. Enforced fail-closed instead. | Phase 2 completion |
| 2 | **Absolute/fixed-amount discount rules** | Their interaction with a multiplicative chain and with a base-relative cap is undefined. Rejected at parse time. | Phase 2 |
| 3 | **Rule scoping** — which rules apply to which package, category or seller | No owner decision exists. `loadPricingRuleSet()` returns the platform rule set and filters nothing; scoping is isolated to that one function. | Phase 2 |
| 4 | **Which pricing rule set a package is sold under** — `velrepeat_pricing_rules` is currently an empty/absent setting, so every commitment prices at base | Seeding it is a data/ops action, not code. | Phase 4 |
| 5 | **Per-cycle price derivation, and which side gets the rounding remainder** | Not in the locked set. `total_amount / commitment_cycles` was explicitly **not** assumed. | Phase 5/9 |
| 6 | **Prepaid refund, skip, pause, out-of-stock money** | Unchanged from the pending-decision sheet. | Phase 9 |
| 7 | **`sold_count` recognition moment** | Unchanged. The engine never touches a counter. | Phase 6 |
| 8 | **Inventory reservation window** | Unchanged. No reserve/commit/release code was added. | Phase 6 |
| 9 | **Multi-seller financial attribution** | G3 = B removes multi-seller packages from V2, so no attribution is needed. Nothing was invented. | Phase 7/9 |
| 10 | **Plan / cycle status vocabularies, cycle identity migration** | Unchanged. | Phase 3/5 |
| 11 | **Payment linkage + the Stripe prepaid charge** | Explicitly out of scope. `insertPricingSnapshot()` is exported and tested but **not yet called from any route** — Phase 4 wires it to purchase. | Phase 4 |
| 12 | **`velrepeat_plans.package_id` does not exist** | A V2 plan cannot yet reference its package. Package/seller provenance is therefore recorded in the snapshot's existing `metadata` JSONB rather than in an invented column. | Phase 3/4 |
| 13 | **`stripe.ts` `toMinor()` is float-based** | Pre-existing payment-boundary code; changing it is a payment-architecture change. | payment architecture |

---

## 10. Production readiness

**Nothing here is live.**

- Phase 1's `velrepeat_*` tables **do not exist in production**. Migrations
  `048_payment_reservation`, `049_payment_incidents`, `050_orders_status_check` remain unapplied
  (last successful migrate 2026-09-25; Neon quota `53000` — an owner action). The V2 tables have no
  migration file, so pushing this commit changes nothing in production.
- The new routes are mounted, but they operate on a table that does not exist in production: a call
  would fail closed with a database error, not act on live data.
- **No migration 051 was created**, and the migration chain was not bypassed.
  `.github/workflows/migrate-neon.yml` triggers on changes to `db/migrations/*.sql` only — this commit
  touches none, so no unattended migration is triggered by it.
- `db/schema.sql` and `db/run-sqleditor.sql` are byte-identical, so a fresh `postgres:16` bootstrap
  still produces the complete current database.
- **Phase 3 is not started by this work.** The pricing engine and the package routes exist; nothing
  buys a plan, charges a customer, reserves stock or fulfils anything.

**Verification performed in this pass**

| Check | Result |
|---|---|
| `bun run test` | **1445 pass / 207 skip / 0 fail** (1652 tests, 56 files) |
| `cd backend && bunx tsc --noEmit` | 0 errors |
| `bun run typecheck` | 4/4 |
| `bun run build:apps` | 4/4 |
| `git diff --check` | clean |
| `cmp db/schema.sql db/run-sqleditor.sql` | identical |
| `db/run-update.sql` | absent (unchanged) |
| `db/migrations/051*` | does not exist |

> **Local caveat.** This environment has **no local PostgreSQL**, so the 11 DB-gated tests in
> `velrepeat-packages-ownership.test.ts` and the DB-gated half of
> `velrepeat-v2-domain-schema.test.ts` **skipped locally and were not executed here.** They are
> covered by CI's disposable `postgres:16` (`.github/workflows/test.yml`), which is the only real
> database execution. No claim is made about them until CI reports the real result, and nothing here
> should be read as a production PASS.
