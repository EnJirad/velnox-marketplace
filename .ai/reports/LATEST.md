# Phase 2 — Shipping-adjacent wholesale pricing: pack prices, buyer gate, order snapshot

Date: 2026-11-05 · Branch `main`
**Starting SHA:** `96cce629ac1b405ea456526b4ad6548b2305e663` (= `origin/main`, clean tree)
**Final SHA:** see the commit that carries this report (`git log -1`).

## 1. Status summary (read this first)

| Area | Status |
|---|---|
| Pricing engine (`lib/wholesale.ts`) | IMPLEMENTED + tested (21 assertions) |
| Schema (`wholesale_tiers`, `business_verifications`, `business_verification_history`, `order_items.wholesale_*`) | IMPLEMENTED, snapshot + reconciler at parity |
| Buyer gate (business verification, API) | IMPLEMENTED (submit/read/review) |
| Seller tier configuration (API) | IMPLEMENTED (atomic replace, ownership + validation) |
| Checkout / quote / order snapshot / stock | IMPLEMENTED |
| Storefront + seller + VelCenter **UI** | **NOT IMPLEMENTED** (blocked — §8) |
| DB-gated integration tests | WRITTEN, **SKIPPED locally** (no disposable DB) |
| AI 02 independent review | **BLOCKED** (delegation fails, §9) |
| Browser QA | **BLOCKED** |
| Impeccable | **BLOCKED** |

Wholesale pack pricing is therefore **complete on the server contract and NOT
complete as a product**: there is no screen yet through which a seller sets a
pack price or a buyer applies for a business account. Nothing in this report
claims otherwise.

## 2. Approved business contract

Owner decisions taken this session (recorded because they are not derivable from
the codebase):

1. **Per-unit price of record.** A seller configures a pack size N and a price
   per pack; the engine converts that to an exact per-unit rational
   (`price_per_pack / pack_size`) and rounds only the final line amount.
2. **Partial packs are retail** (rule A). Wholesale applies only when
   `units % pack_size === 0` **and** the pack count reaches the seller's lowest
   `min_packs`. Anything else is priced at retail — never refused, never blended.
3. **Only a verified business account sees wholesale prices.** A normal customer,
   a pending applicant and a rejected/suspended applicant all pay retail. This
   requirement was added by the owner and supersedes the task template's ban on
   "Phase 3 — Wholesale Shop Accounts"; the phase ships **only the verification
   gate**, not a B2B storefront.
4. **Verification bar = the seller's bar** (owner Spec A): commercial
   registration number (13 digits), shop-front photo, authorised person ID photo,
   bank book, reviewed per account in VelCenter by `sellers.manage`.
5. **Tier selection:** the tier with the greatest `min_packs ≤ packs`.
6. **Inventory deducts units**, never packs.
6. **A tier edit never rewrites history:** the order stores the pack size, pack
   count and pack price it was sold at.

## 2a. Business rules → implementation map

| Rule | Where |
|---|---|
| tier resolution, per-unit math, partial-pack policy | `backend/lib/wholesale.ts` |
| buyer status resolved per request | `backend/lib/checkout-lines.ts` (`business_verifications`) |
| exact line amount in quote + order | `QuotedLine.lineTotal` (`lib/shipping.ts`), `order_items.subtotal` |
| fingerprint includes pack identity | `shippingFingerprint` |
| seller validation + atomic replace | `backend/routes/wholesale.ts` |
| verification lifecycle | `backend/routes/business-verification.ts` |

## 3. Database changes (additive, reversible)

- `wholesale_tiers(id, product_id, variant_id, pack_size, min_packs, price_per_pack, …)`
  with `CHECK` guards (`pack_size` 2..1000, `min_packs` ≥ 1, `price_per_pack > 0`)
  and `idx_wholesale_tiers_unique` on `(product_id, COALESCE(variant_id, zero-uuid), min_packs)`.
- `business_verifications(user_id UNIQUE, status CHECK, business_name, business_type,
  registration_number, evidence_urls JSONB, submitted_at, reviewed_at, reviewed_by,
  rejection_reason, review_note, …)`.
- `business_verification_history(verification_id, action, note, created_at)`.
- `order_items.wholesale_pack_size INTEGER`, `wholesale_packs INTEGER`,
  `wholesale_tier_price NUMERIC(12,2)`.

Both `db/schema.sql` and `db/run-sqleditor.sql` updated; the parity + drift suites
pass (`db-run-sqleditor-reconciler` 21/21, `schema-drift` 8/8). **No production
migration was executed**, and none may be run by an agent.

## 4. What the engine guarantees

```
units      = cart line quantity (integer)
pack_size  = wholesale_tiers.pack_size for (product, variant)      — NULL => retail
packs      = units / pack_size                                     — integer only
eligible   = buyer verified AND pack_size set AND units % pack_size == 0
             AND packs >= min(min_packs for that scope)
tier       = greatest min_packs <= packs
line_amount= packs × price_per_pack        (exact; never unit_price × units)
unit_price = line_amount / units           (2 dp, display only)
```

`100.00 per pack of 3` therefore charges **100.00** for 3 units, not 33.33 × 3 =
99.99, and `orders.subtotal` equals the sum of `order_items.subtotal` because the
quote sums the same exact line amounts it later persists. `order_items.price`
keeps the 2-decimal per-unit value for existing readers and is explicitly **not**
the basis of the line total; a test asserts both halves of that statement.

## 5. Tests

**Executed here, passing**

| Suite | Result |
|---|---|
| `backend/tests/wholesale-pricing.test.ts` | **21 pass** — retail regression, gate, one pack exact, 99.99×7 precision, tier boundaries (1/4/5/9/10/25 packs), partial packs, below-minimum, fingerprint change on tier edit, cheapest-from display, invalid input |
| `backend/tests/wholesale-tiers.test.ts` | **15 pass** — every validation refusal (pack size, min packs, price 0/negative/3-dp, duplicate min_packs, mixed pack sizes in one scope, foreign variant, >20 tiers, non-array), plus one-pack-size-per-scope and product-vs-variant scopes |
| `backend/tests/db-run-sqleditor-reconciler.test.ts` | 21 pass |
| `backend/tests/schema-drift.test.ts` | 8 pass |
| full `bun test ./backend/tests` | **1376 pass / 418 skip / 1 fail** |

The single failure is the pre-existing, timing-sensitive
`proxy-write-mode.test.ts > --check prints identity only` case (5 s timeout under
full-suite load; it passes when that file runs alone, 29/29). It is unrelated to
this change and was not loosened.

**Written but SKIPPED (no disposable database on this device)**

`backend/tests/wholesale-checkout-integrity.test.ts` — 14 DB-gated cases:
retail regression, the five-state gate matrix, one pack = 100.00, tier
boundaries, partial packs, below-minimum, invalid seller input leaves no rows,
cross-seller refusal, unit-level stock deduction, exact `order_items` snapshot,
history immutability after a tier edit, quote↔order consistency, stale quote
after losing verification, client money manipulation. These have **never been
executed**; they are not evidence of anything yet.

## 6. Commands and results

| Check | Command | Result |
|---|---|---|
| Backend types | `cd backend && bun run typecheck` | exit 0 |
| All apps | `bun run typecheck` | exit 0 (4/4) |
| VelShop build | `bun run build:velshop` | exit 0 |
| VelSeller build | `bun run build:velseller` | exit 0 |
| i18n | `bun run i18n:check` | `th=1702 en=1702 my=1702` |
| Whitespace | `git diff --check` | clean |

## 7. Commits

```
f74d518 feat(db): wholesale tiers + business verification schema (Part 2)
0fd951d feat(checkout): server-authoritative wholesale pricing in quote + checkout (Part 4)
080f72e feat(seller): wholesale tier config + business verification gate (Part 3)
```

## 8. BLOCKED — UI and every check that needs a live stack

- **UI is not built.** There is no seller screen for tiers, no storefront
  indication of pack size / pack price / applied tier, and no VelCenter review
  screen. The APIs exist and are validated; the surfaces do not. Shipping P0's
  checkout already renders server totals, so a wholesale order will display the
  correct amount — but the customer cannot see *why* it is cheaper.
- **DB-gated tests cannot run.** `initdb` cannot complete on this device
  (documented in the previous report), so `TEST_DATABASE_URL` has no target and
  418 tests skip, including all 14 written here.
- **Browser QA is impossible** for the same reason plus no authenticated
  seller/business account in a local stack.
- **Impeccable cannot execute:** `impeccable --version` fails with
  `unexpected e_type: 2` on this device. **IMPECCABLE: BLOCKED.** No UI review
  claim is made.

## 9. AI 02 — independent review BLOCKED

Delegation failed with the exact error:

```
[400] This model's maximum context length was exceeded.
The maximum supported context is 272000 tokens.
```

The instruction "AI 02 must independently approve" therefore **cannot be
satisfied in this environment**. What follows is AI 01's own review, labelled as
such and **not** presented as independent sign-off:

| Point | Self-check |
|---|---|
| Client cannot set price/pack/tier/discount/total | PASS — pricing reads DB rows only; `CLIENT_MONEY_FIELDS` refuses `shippingFee`/`total`/`amount`/`discount`/…; no route reads a client tier during pricing |
| Only `verified` unlocks wholesale, resolved per request | PASS — `checkout-lines` queries `business_verifications` on every pricing pass |
| Exact line amount reaches `order_items.subtotal` | PASS — `QuotedLine.lineTotal` → `order_items.subtotal`; quote sums the same values |
| Inventory deducts units | PASS — untouched code path uses `item.quantity` |
| Seller can only write own tiers; table is never half-valid | PASS — ownership via `shops.seller_id`, whole-list validation, single transaction |
| Fingerprint changes on tier/verification change | PASS — pack identity is hashed |
| Partial packs fall back to retail | PASS — `priceLine` returns `retail_partial_pack` |

Residual risks I can see: (a) `order_items.price` cannot reproduce the exact line
amount for a pack whose per-unit value is not 2-decimal — documented in code and
pinned by a test, but any future report that recomputes revenue from
`price × quantity` will be a cent short per such line; (b) the gate is per user,
so a business account can buy at wholesale for any seller's product — that is the
approved rule, not an oversight; (c) no UI means no human has yet exercised the
flow.

## 10. Remaining work (honest backlog)

1. Seller UI: wholesale tiers inside the product editor (pack size, tiers, preview
   of the per-pack price).
2. VelShop: pack badge + "ซื้อเป็นแพ็ค" explainer on product/cart/checkout lines
   (the quote endpoint already returns `lines[].packSize/packs/pricePerPack`).
3. VelCenter: business verification queue with signed evidence URLs.
4. Run the 14 DB-gated tests on a disposable PostgreSQL and paste the counts here.
5. Then, and only then, browser QA of the three journeys.
