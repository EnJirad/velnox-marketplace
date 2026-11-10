# SHIPPING & PAYMENTS — marketplace rules, carrier readiness, QR checkout

## 1. How the large Thai marketplaces behave (the model we follow)

Shopee / Lazada / TikTok Shop all use the SAME three rules, which is why Velnox
adopts them unchanged:

| Rule | What the marketplaces do | Velnox status |
|---|---|---|
| **Select items in the cart** | A checkbox per line, plus per-shop and select-all. Only ticked lines are ordered. | ✅ implemented (`packages/shared/src/lib/cart-selection.ts`, `ShopCart.tsx`, `selectedCartItems` → checkout) |
| **One order per shop** | Checking out a 3-shop cart creates **3 orders**, each with its own payment share, its own shipment and its **own tracking number**. "Packed together" only happens inside one seller. | ✅ implemented (`POST /api/customer/checkout` groups by `shop_id`; `shipments_order_id_unique` = one parcel row per order) |
| **A quantity ceiling per order** | Marketplaces cap how many units one checkout may contain (fraud/abuse + carrier limits). | ✅ **100 units** (this change) — `backend/lib/order-limits.ts`, enforced in the cart, in `POST /api/customer/cart/*` and authoritatively in `POST /api/customer/checkout` |

Consequence for parcels: because one order = one shop, a customer buying from
three shops receives **three separate tracking numbers**, exactly like Shopee's
"ผู้ขาย 3 ร้าน → พัสดุ 3 กล่อง". Nothing about our schema needed to change for
that — it was already the model; the cap and the UX were the missing pieces.

## 2. Carrier readiness (6 carriers)

`backend/lib/tracking/carrier-adapter.ts` is the registry; every adapter
implements the same contract (`types.ts`) and **never fabricates data**.

| Code | Carrier | How it is reached | Status today |
|---|---|---|---|
| `JT` | J&T Express | Public website API — captcha-gated | **BLOCKED** (needs merchant API) |
| `FLASH` | Flash Express | Public site behind anti-bot shield | **BLOCKED** (needs official API) |
| `KERRY` | Kerry Express | Merchant API only (no public endpoint) | **BLOCKED** until `KERRY_API_KEY` set → then `PARTIAL` |
| `THAILANDPOST` | ไปรษณีย์ไทย | **Official** Track & Trace API v1 (free developer token) | **READY** — set `THAILANDPOST_API_TOKEN` → `PARTIAL` |
| `SPX` | SPX Express | Internal Shopee-portal API | **UNSUPPORTED** |
| `TNT` | TNT Express | Public JSON API (verified working) | **PARTIAL** |

### What to request from each provider

1. **Kerry Express** — apply for a merchant/e-commerce account; ask for the
   *tracking API* base URL + API key/secret for the account. Then set
   `KERRY_API_KEY`, `KERRY_API_SECRET`, optionally `KERRY_TRACK_URL`.
2. **Thailand Post** — register at the Thailand Post developer portal
   (`trackapi.thailandpost.co.th`), request a token for Track & Trace v1. Then
   set `THAILANDPOST_API_TOKEN`. **No code change needed** — the adapter is
   already written against the documented request/response.
3. **J&T Thailand** — request the merchant open-API contract (the website API
   requires a captcha and must not be bypassed).
4. **Flash Express** — request the B2B/open API contract.

### Environment variables (values never committed)

```
KERRY_API_KEY=            # Kerry merchant API key
KERRY_API_SECRET=         # optional, when the account issues one
KERRY_TRACK_URL=          # optional override of the documented base
THAILANDPOST_API_TOKEN=   # Thailand Post developer-portal token
THAILANDPOST_TRACK_URL=   # optional override
```

The admin health surface (`GET /api/admin/tracking/health`) reports each
carrier's real state, so "we have the key" and "it works" cannot be confused.

## 3. Payment: PromptPay QR rendered by Velnox

**Before:** choosing PromptPay sent the customer to `checkout.stripe.com`.
**Now:** `POST /api/payments/promptpay/intent` creates a Stripe *PaymentIntent*
with `payment_method_types: ["promptpay"]` and returns the EMVCo payload + PNG;
VelShop draws it in its own card at `/orders/:orderId/pay`, with our countdown,
our copy and a poller that flips to "paid" when Stripe confirms.

* The money still settles through the **same Stripe account and the same
  webhook** — no second payment rail, no second ledger.
* The amount always comes from `orders.total_amount` server-side; the request
  body never carries a price.
* Ownership is in the SQL `WHERE` — a non-owner gets 404.
* **Fail-closed:** without Stripe keys the endpoint answers `503
  PAYMENTS_NOT_CONFIGURED` and the page shows our own explanatory state; no
  fake QR is ever produced.
* Scope today: **order-scoped** intents. A multi-shop purchase (one
  `checkout_group`) still uses the Stripe Checkout Session until group-level
  intents are added — see §5.

## 4. Payment method registry

`backend/lib/payment-config.ts → paymentMethodOptions()` is the single list the
UI renders:

| Method | Provider | State |
|---|---|---|
| `CARD` | Stripe | enabled when Stripe is usable |
| `PROMPTPAY` | Stripe | enabled when Stripe is usable (QR page above) |
| `COD` | carrier | disabled by default (fail-closed flags) |
| `TRUEMONEY` | — | **disabled**, `REQUIRES_PROVIDER_CONTRACT` (Stripe has no TrueMoney rail for TH) |
| `LINEPAY` | — | **disabled**, `REQUIRES_PROVIDER_CONTRACT` (LINE Pay was withdrawn from Stripe) |

TrueMoney / LINE Pay are listed **disabled with a reason** so the roadmap is
visible — never as a button that cannot work.

## 5. Next steps (in order)

1. Group-level PromptPay intents (set `metadata.checkoutGroupId`, verify the
   webhook settles the whole group) → then the QR page can serve multi-shop
   baskets too.
2. Kerry + Thailand Post credentials → flip the two adapters from `BLOCKED` to
   `PARTIAL`, then verify with one live consignment each.
3. Seller-side carrier choice per shop (stored on `shipments.carrier_code`) is
   already collected in the ship dialog; add per-shop default carrier settings
   when a second carrier becomes usable.
4. Real rate cards (weight/dimension) once a carrier API exposes them — the
   current fee is a documented per-shop flat rate.

## Verification

- `bun test tests/order-limits.test.ts` → 10 pass
- cart/checkout/payment/tracking suites → 152 pass, 0 fail
- 4 apps typecheck ✅ · i18n parity (2256 × 3) ✅ · `git diff --check` ✅
- Not verified: live carrier calls (no credentials) and live Stripe (no keys) —
  both are reported as BLOCKED above, never as working.
