# P0 — Shipping fee & server-authoritative shipping quote

Date: 2026-11-05 · Branch `main` · BASE `7f01075dad8dfba6ec6c3f36e9329976989c4786`

## 1. Root cause of `shipping_fee = 0`

There was **no shipping price anywhere in the system** — not in the schema, not in
the seller UI, not on the server. Confirmed against source, not the audit text:

| # | Cause | Evidence (before this change) |
|---|---|---|
| 1 | Order creation wrote only `total_amount`; `subtotal`, `shipping_fee`, `discount` kept their `0` defaults | `backend/routes/cart.ts` `insertOrderWithUniqueNumber` INSERT column list |
| 2 | The checkout screen printed a hard-coded "ส่งฟรี" (free) row and totalled only `qty × price` | `apps/velshop/src/pages/ShopCheckout.tsx` summary block, `checkoutTotal` |
| 3 | The backend had no shipping endpoint at all — `POST /api/customer/checkout` accepted no fee and produced none | route list in `cart.ts` (11 routes, none shipping) |
| 4 | `shops` had **no** shipping columns, so a seller could not express a fee | `db/schema.sql` `shops` table |
| 5 | The client sent a meaningless `shippingMethod: "standard"` that the backend ignored | `ShopCheckout.tsx` checkout payload |
| 6 | Order totals therefore omitted delivery, while order *items* did not | `orders.total_amount` was the item sum only |

Nothing on the backend ever accepted a client-supplied fee (there was nowhere to
put one), so the defect was **missing pricing**, not tampering — the manipulation
surface only becomes relevant once a fee exists, and it is closed in Part 4.

## 2. Financial contract (authoritative)

Per shop shipment — exactly one `orders` row and one `shipments` row:

```
subtotal      = Σ (current server unit price × integer quantity)   exact decimal
shipping_fee  = the shop's shipping rule                            exact decimal
discount      = 0.00   (no shop-level discount system exists in checkout)
total_amount  = subtotal − discount + shipping_fee
```

Per purchase (`checkout_groups.total_amount`) = `Σ per-shop total_amount`, which is
what Stripe/PromptPay is asked to charge (`payments.amount`; Stripe line items are
built from `orders.total_amount` / the group total — `backend/routes/stripe.ts`).

Money is carried as decimal **strings** and computed through `backend/lib/money.ts`
(exact rationals over `bigint`, one round-half-up at the boundary). No float is
part of an authoritative amount. Currency THB, `NUMERIC(12,2)`.

Quote lifecycle: TTL **15 minutes**, server clock, sha-256 **fingerprint** of
`(currency, address id, per line: product / variant / quantity / server price / shop)`.
The quote is a *claim* checkout re-derives and compares; it is consumed exactly once
(`UPDATE … WHERE consumed_at IS NULL AND expires_at > NOW()`), so two concurrent
submits cannot both spend it.

## 3. Business rule approved for this scope

No carrier API exists and no product carries weight/dimension data, so a real rate
engine would have meant inventing numbers. Large Thai marketplaces (Shopee, Lazada,
TikTok Shop) charge **one delivery per seller** because each seller ships their own
parcel, and let the seller set that channel's fee. That structure is what is
implemented — with the numbers explicit and configurable, never hard-coded in the UI:

| Source | Meaning |
|---|---|
| `shops.shipping_fee = NULL` | use the platform default (`SHIPPING_FLAT_FEE_THB`, else **50.00**) |
| `shops.shipping_fee = 0` | the seller ships free (explicit) |
| `shops.shipping_fee > 0` | that flat fee per parcel |
| `shops.free_shipping_threshold` | free once that shop's item subtotal reaches it (NULL = no automatic free shipping) |

**Limitation, stated plainly:** there is no zone/weight/volumetric/carrier rate, no
provider integration, and no tracking API. The fee is a per-shop flat rate. *Web
verification of the marketplace comparison was not possible this session* (search
engines returned no results / HTTP 429 and the Shopee help URL 404'd), so the
comparison above is general market practice, not a citation.

## 4. API changes

**New** `POST /api/customer/shipping/quote` (`backend/routes/shipping.ts`, auth required)

```jsonc
// request — the client may only NAME what it wants priced
{ "addressId": "<uuid>", "cartItemIds": ["<uuid>"], "buyNow": { "productId": "...", "variantId": null, "quantity": 2 } }
// 200
{ "success": true, "data": {
    "quoteId": "<uuid>", "expiresAt": "…", "expiresInSeconds": 900,
    "method": "shop_flat_rate", "currency": "THB",
    "subtotal": "59.97", "discount": "0.00", "shippingTotal": "25.00", "total": "84.97",
    "itemCount": 3,
    "shops": [{ "shopId": "…", "shopName": "…", "subtotal": "59.97", "shippingFee": "25.00",
                "freeShipping": false, "reason": "shop_flat_rate", "method": "shop_flat_rate", "itemCount": 3 }] } }
```

Refusals: `400 CLIENT_AMOUNT_NOT_ACCEPTED`, `400 ADDRESS_REQUIRED`,
`403 ADDRESS_NOT_FOUND`, `422 SHIPPING_DESTINATION_UNSUPPORTED` (only `TH` is
priceable), `400 SHIPPING_EMPTY_CART`, plus the existing product/stock codes.

**Changed** `POST /api/customer/checkout`
- accepts `shippingQuoteId`; a **supplied** quote is rejected with `409`
  `SHIPPING_QUOTE_INVALID | _USED | _EXPIRED | _STALE` when it does not match.
- refuses any client money field with `400 CLIENT_AMOUNT_NOT_ACCEPTED`
  (`shippingFee`, `shipping_fee`, `shippingTotal`, `subtotal`, `total`,
  `totalAmount`, `amount`, `discount`) — refused, not ignored.
- persists `subtotal`, `shipping_fee`, `discount`, `total_amount`, `shipping_quote_id`;
  the group total includes delivery.
- when no quote id is sent (API clients, older builds) the server **mints and
  redeems** a quote from the same computation, so no order can carry a client
  price either way. The VelShop UI always sends one, which is what makes "the
  customer saw this fee before paying" true for real users.

**Changed** `PATCH /api/seller/shop` — accepts `shippingFee` / `freeShippingThreshold`
(`null` = platform default, `0` = free, ≤2 decimals, bounded); `GET /api/seller/profile`
returns `shipping: { fee, freeShippingThreshold }`.

**Changed** order payloads — `shippingMethod` is `"shop_flat_rate"` only when a quote
actually priced the order, `null` for legacy orders (customer list/detail, seller
list/detail).

## 5. Database changes (additive, reversible)

1. `shops.shipping_fee NUMERIC(12,2) NULL`, `shops.free_shipping_threshold NUMERIC(12,2) NULL`
2. `orders.shipping_quote_id UUID NULL` + FK → `shipping_quotes(id) ON DELETE SET NULL`
3. `shipping_quotes` table — `user_id`, `address_id`, `fingerprint`, `currency`,
   `subtotal`, `shipping_total`, `total_amount`, `breakdown JSONB`, `expires_at`,
   `consumed_at`, `checkout_group_id`, `created_at`, with
   `CHECK (total_amount = subtotal + shipping_total)` and non-negative checks;
   indexes `(user_id, created_at DESC)` and partial `(expires_at) WHERE consumed_at IS NULL`.

Both `db/schema.sql` and `db/run-sqleditor.sql` updated (reconciler parity test passes:
21/21). Existing orders/payments untouched; every column is nullable, so the change is
reversible with `DROP COLUMN` / `DROP TABLE` and **no production migration was run**
(and must not be run by an agent).

## 6. Checkout changes (VelShop)

`ShopCheckout.tsx` now: requests the quote whenever the address, the selected lines or
their quantity/price change (debounced, stale responses discarded by sequence);
auto-refreshes shortly before expiry; renders **subtotal → discount (only when non-zero)
→ delivery → total** exclusively from server strings; shows "ฟรีค่าจัดส่ง" **only** for a
valid quote whose delivery is exactly `0.00` (and says whether that is a seller choice or
a threshold); shows a spinner while pricing, an actionable **Retry** on failure, and an
em dash instead of a total when no quote exists; blocks submit until a quote is ready and
sends `shippingQuoteId`, never a number. A `409` quote refusal re-quotes and asks the
customer to review the new total instead of retrying the charge.

## 7. Order & payment integrity

- Order rows are written from `buildShippingQuote(...)` output only; the per-shop
  amount map is a hard lookup (a missing shop now **throws** instead of writing 0).
- `total_amount = subtotal − discount + shipping_fee` is computed term by term.
- Before responding, the persisted per-shop totals are compared with the quote total
  and a mismatch **rolls the checkout back** (`CHECKOUT_TOTAL_MISMATCH`).
- Idempotency (`checkout_requests`), the order-row lock, payment reservation and the
  Stripe webhook path are unchanged; Stripe still derives the charge from the stored
  order/group amount, so payment, order and group agree by construction and by check.

## 8. Seller / fulfilment compatibility

`PATCH /api/seller/shop` writes the shop's fee (validated server-side), `My Shop` shows
`ใช้ค่าเริ่มต้นของแพลตฟอร์ม` / `ฟรี` / the amount plus the free threshold, and the edit
dialog exposes both fields with an invalid-input message. Seller order list/detail
already carried `subtotal` / `discount` / `shippingFee` / `total`; they now carry real
numbers plus `shippingMethod`. Ownership checks are untouched (seller detail is scoped
by `sh_shops.seller_id`). No carrier/tracking integration was invented.

## 9. Tests

`backend/tests/shipping-quote.test.ts` — **33 pass, 0 fail** (runs with no database):
the rule (default / flat / explicit free / threshold / corrupt negative), exact decimal
totals (`19.99 × 3 + 50 = 109.97`, `0.10 × 3 + 0.20 = 0.50`), multi-shop one-fee-per-shop,
empty cart and invalid quantity/price refusals, fingerprint stability and change on
quantity/price/address, platform-default env handling, TTL, and **8 route-level refusals**
of client money (`shippingFee = 0`, arbitrary fee, `total`, `totalAmount`, `amount`,
`subtotal`, `discount`) plus the quote endpoint's own refusals.

`backend/tests/checkout-shipping-integrity.test.ts` — **15 tests, all SKIPPED here**
(DB-gated): non-zero fee persisted with the invariant, explicit free quote, platform
default, unsupported destination, expired quote (no order created), quantity changed,
price changed, seller fee changed, quote reuse, foreign quote, multi-shop sum vs group,
no-quote server pricing, client fee/total manipulation, decimal precision end to end,
seller visibility + stranger refusal. Scenario coverage of the 18 requested items:
implemented in these two files, except 12–13 (payment creation failure / retry) and 15
(refund/cancel), which are already covered by the existing untouched suites
(`payment-*`, `checkout-payment-flow`, `customer-order-cancel`, `payment-refund-replay`).

## 10. Evidence — commands and results

| Check | Command | Result |
|---|---|---|
| Backend types | `cd backend && bun run typecheck` | exit 0 |
| All apps types | `bun run typecheck` | exit 0 (velshop, velseller, velcenter, velnox) |
| Backend suite | `bun test ./backend/tests` | **1340 pass, 404 skip, 1 fail** |
| New unit suite | `bun test ./backend/tests/shipping-quote.test.ts` | 33 pass |
| Schema parity | `bun test ./backend/tests/db-run-sqleditor-reconciler.test.ts` | 21 pass |
| Schema drift | `bun test ./backend/tests/schema-drift.test.ts` | 8 pass |
| VelShop build | `bun run build:velshop` | exit 0 |
| VelSeller build | `bun run build:velseller` | exit 0 |
| i18n parity | `bun run i18n:check` | `th=1702 en=1702 my=1702` |
| Whitespace | `git diff --check` | clean |

The single failure is the pre-existing timing-sensitive `proxy-write-mode.test.ts >
--check prints identity only` case (5 s timeout under full-suite load; it **passes**
when the file runs alone: 29/29). It is unrelated to this change and was not
"fixed" by loosening it.

## 11. Browser E2E — BLOCKED

BLOCKED: **no reachable PostgreSQL for a local backend.** `initdb` cannot complete on
this device (two attempts, 120 s and 600 s, hang at "selecting default max_connections";
the engine also rejects `--describe-config`), so a disposable database — and therefore
a local API, a genuine test account and an order-writing flow — could not be started.
No production write, no live payment and no production order mutation was performed.

What was verified instead: the built VelShop bundle was served locally
(`apps/velshop/dist` on `127.0.0.1:8100`) and loaded in the in-app browser —
`/checkout` correctly redirects an unauthenticated visitor to `/auth`, the bundle
executes with no console/runtime error, and the new copy compiles into the shipped
JS. That is **not** an E2E of the purchase flow.

## 12. Impeccable — NOT EXECUTED (engine unavailable), manual review performed

The launcher is unusable on this device:
`/data/user/0/com.androidharness.app/files/skills/impeccable/scripts/impeccable --version`
→ `error: ".../.impeccable/bin/0.1.18/impeccable" has unexpected e_type: 2`.
Per the skill's degraded path I loaded `VELNOX_DESIGN_THEME.md` (the repo's design
source of truth — there is no `DESIGN.md`/`PRODUCT.md`) and `references/craft-floor.md`,
then reviewed the changed surface against the floor:

- **Contrast:** label `slate-500` on white (4.76:1) ✓; "free delivery" moved from
  `#059669` (3.99:1, below 4.5 for 12 px) to `#047857` (≈4.9:1) ✓; error text
  `rose-700` on `rose-50` ≈5.6:1 ✓; em-dash placeholder is `aria-hidden` decoration.
- **States:** loading (spinner + `aria-live`), error (`role="alert"` + actionable
  retry), empty (no address → "Choose an address" control), disabled submit while
  unpriced ✓.
- **Depth/spacing/type:** unchanged card system, one authored status row set per
  group, tabular numerals for money, no new shadows or gradients.
- **Bans:** no gradient text, no kicker, no nested cards, no emoji-as-icon, no
  left-border accents ✓.
- Motion: none added (a price refresh is a state change, not an animation).

**IMPECCABLE: BLOCKED** — the engine never ran; the review above is manual and is
not evidence of engine execution.

## 13. AI 02 — independent review (executed, 5 findings, 4 fixed)

AI 02 (`task`, read-only, prompt scoped to the five shipping/pricing files) returned a
verdict. Its findings and dispositions:

| Finding | Disposition |
|---|---|
| Per-shop amount fallback could silently write a 0 THB order while the group charged the full amount | **Fixed** — missing shop now throws (`SHIPPING_QUOTE_SHOP_MISMATCH`) |
| Group and order totals were derived independently with no assertion | **Fixed** — persisted sum is compared with the quote total; mismatch rolls back |
| Fingerprint used the client's spelling of the address id while quotes store `String(address.id)` | **Fixed** — checkout now fingerprints the DB-resolved address id |
| `total_amount` ignored the `discount` term of the documented contract | **Fixed** — computed term by term with `subtract` |
| Float appears in display-only conversions (`Number()` for JSON responses / rendered money) | **Accepted, documented** — authoritative arithmetic is exact; only the wire/display layer converts |
| No-quote checkout may carry no address (fee still charged) | Accepted by design: the flat rule is destination-independent, and the UI always sends an address |

## 14. Status by category

**IMPLEMENTED** — quote library + store, `POST /api/customer/shipping/quote`,
checkout re-derivation and persistence, single-use quote redemption, group total with
delivery, seller shipping configuration (API + Velseller UI), order payloads carrying
`shippingMethod`, i18n (th/en/my), schema + reconciler.

**AUTOMATED TESTS** — 33 unit/route tests pass; 15 DB-gated integration tests written
and skipped locally; full backend suite green apart from one pre-existing flaky case.

**BUILD** — velShop and velseller production builds exit 0; all four apps typecheck.

**BROWSER E2E** — **BLOCKED** (no disposable database on this device).

**SECURITY VERIFICATION** — no auth/authz change; client money refused before any DB
read; quote lookup is ownership-scoped; single-use redemption is atomic; no cookie
output, write-mode or safe-mode change; no secret printed; `git diff --check` clean.

**BLOCKED** — browser E2E purchase journey; execution of the 15 DB-gated tests;
Impeccable engine execution; production migration (never run by an agent).

**NOT VERIFIED** — Stripe/PromptPay settlement against a charged amount including
shipping (no payment was created anywhere); seller-side visual confirmation; live
mobile layout at 320 px (no authenticated session locally).

Commit SHA: `1fca88e64d8703a8df572a9b3e31c0f5036c551b`
