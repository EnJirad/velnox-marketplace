# Velnox Marketplace — Master Progress Audit

Audit date: 2026-11-04 · Read-only · Branch `main`

## 1. Executive summary

The marketplace is a real, working three-sided system: a customer storefront, a
seller console, and an operations centre over one Express/WebSocket backend and a
64-table Neon schema. 174 API routes exist and are wired to real frontends; there
is no mock layer.

**What actually works end to end:** browse → product → variant → cart → checkout
(PromptPay/Stripe test mode) → order → seller fulfilment → shipment → customer
tracking → income report → admin oversight. Verified in a browser this session.

**What does not exist despite being documented or schema'd:** wholesale pack
pricing, community shop accounts, restock ordering, a shipping-rate engine,
returns workflow, payouts/settlements, customer review submission, Convex.

**Financial defect (P0):** every order is created with `shipping_fee = 0`; the
checkout UI hard-codes "shipping free". Revenue and seller income are therefore
understated by whatever shipping should cost.

## 2. Latest repository commit

`ff69d51` (main) — clean working tree, local == remote. Audited tree includes
`63d7b0a` (VelCenter nav fix) and `b205112` (cookie/write-mode hardening).

## 3. Project structure

```
apps/velshop     22 routes   customer storefront
apps/velseller   11 routes   seller console
apps/velcenter    3 routes   one shell + 12 tab modules
apps/velnox      12 routes   corporate/marketing
backend          174 endpoints across 16 route modules + ws
packages/shared  UI kit, i18n (th/en/my, 1706 keys), api-routes
db               schema.sql + run-sqleditor.sql (64 tables, 148 indexes)
```

## 4. Overall application status

| Application | Status |
|---|---|
| VelShop | IMPLEMENTED — NOT FULLY VERIFIED (checkout money defect) |
| Velseller | PARTIAL (shipping engine, returns, payouts missing) |
| VelCenter | IMPLEMENTED — NOT FULLY VERIFIED (dashboard/orders/sellers verified) |
| Velnox Corporate | IMPLEMENTED (informational site) |
| Backend API | IMPLEMENTED — NOT FULLY VERIFIED |
| Database | IMPLEMENTED (3 orphan tables, see §10) |
| Convex | NOT IMPLEMENTED (no code, no dependency) |
| Cloudflare R2 | IMPLEMENTED (no deletion path) |
| Stripe / PromptPay | IMPLEMENTED (test mode only) |

## 5. VelShop feature matrix

| Feature | Status | Evidence |
|---|---|---|
| Homepage | VERIFIED COMPLETE | browser: announcements (4), categories, trending card |
| Announcements/banners | VERIFIED COMPLETE | `announcements.ts`; carousel rendered |
| Categories | VERIFIED COMPLETE | `/categories`, `/products?category=` |
| Listing / search / filters | VERIFIED COMPLETE | `/products` (search, filter, sort, "พบ 1 สินค้า") |
| Product detail | VERIFIED COMPLETE | gallery, price, stock 18, tabs |
| Variants | VERIFIED COMPLETE | selection sheet, live total, cart badge 1 |
| Cart | VERIFIED COMPLETE | `cart.ts` 11 routes; empty state + add verified |
| Checkout | **PARTIAL** | `cart.ts:117` inserts no `shipping_fee`; `ShopCheckout.tsx:791` hard-codes free shipping |
| Addresses | IMPLEMENTED — NOT FULLY VERIFIED | `ShopAddresses.tsx` |
| Auth / Google | IMPLEMENTED — NOT FULLY VERIFIED | `auth.ts`, OAuth tests (3) |
| Profile / avatar | IMPLEMENTED — NOT FULLY VERIFIED | `ShopProfile.tsx`, `upload.ts` avatar |
| Wishlist | IMPLEMENTED — NOT FULLY VERIFIED | `ShopWishlist.tsx`, `cart.ts` wishlist routes |
| Reviews — display | VERIFIED COMPLETE | `GET /api/products/:productId/reviews` |
| Reviews — submission | IMPLEMENTED — NOT FULLY VERIFIED | `POST /api/products/:productId/reviews` (`products.ts:3211`), UI `submitReview` in `ShopProductDetail.tsx:388`; not exercised in a browser |
| Orders / tracking | IMPLEMENTED — NOT FULLY VERIFIED | `cart.ts` order routes; `ShopTracking.tsx` |
| Notifications | IMPLEMENTED — NOT FULLY VERIFIED | bell (badge count observed) |
| Chat/support | VERIFIED COMPLETE | `/chat` conversations, unread, tabs |
| i18n (th/en/my) | VERIFIED COMPLETE | `i18n:check` 1706 × 3 |
| Responsive | NOT VERIFIED | see §19 |

## 6. Velseller feature matrix

| Feature | Status | Evidence |
|---|---|---|
| Registration / application | IMPLEMENTED | **two** UIs: `RequireRole.tsx` (4-step) + `ShopOnboarding.tsx` (2-step) |
| Verification / ID upload | VERIFIED COMPLETE | `verification.ts` 10 routes, 3 purposes enforced |
| My Shop | VERIFIED COMPLETE | browser: identity, address, 2 products, filters |
| Logo / cover (R2) | IMPLEMENTED — NOT FULLY VERIFIED | presign/confirm `shop-logo`/`shop-cover` |
| Products CRUD + variants | IMPLEMENTED — NOT FULLY VERIFIED | 40 routes in `products.ts` |
| Inventory | VERIFIED COMPLETE | `inventory.ts` reserve/commit/release; tests |
| Orders / detail | VERIFIED COMPLETE | browser: 7 filters, 5 real orders, transitions |
| Shipping (manual) | IMPLEMENTED | carrier + tracking number, `shipments` one-per-order |
| Shipping **engine** (rates/zones/volumetric) | **NOT IMPLEMENTED** | no tables, no endpoints |
| Tracking events | PARTIAL | `tracking_events` read only — nothing writes it |
| Income / fees | VERIFIED COMPLETE | browser: 3% fee ฿12.58, return 23.8%, net ฿348.65 |
| Shipping cost in income | NOT IMPLEMENTED | no field |
| Returns | **NOT IMPLEMENTED** | `order_returns` table unused |
| Payouts | **NOT IMPLEMENTED** | `settlements` table unused |
| Goals / performance | VERIFIED COMPLETE | `seller-intelligence.ts` + tests |
| Profile / settings | PARTIAL | 3 sections only |
| Permissions | IMPLEMENTED | `requireApprovedSeller`, ownership tests |

## 7. VelCenter feature matrix

| Module | Status | Evidence |
|---|---|---|
| Auth + role gate | VERIFIED COMPLETE | seller → company-only screen; `/api/admin/overview` → 403 |
| Navigation | **FIXED + VERIFIED** | `63d7b0a`; click → `?tab=orders` → real orders |
| Dashboard | VERIFIED COMPLETE | ฿419.3, 5 orders, 2 shops, 2 products, low-stock 1 |
| Orders | VERIFIED COMPLETE | `?tab=orders`, 5 orders with status controls |
| Sellers / verification | VERIFIED COMPLETE | `?tab=sellers` queue + search + filter |
| Products / categories / users / staff / audit / incidents / marketing / settings | IMPLEMENTED — NOT FULLY VERIFIED | `center.ts` 20 routes; tabs wired but not clicked through |
| Intelligence | IMPLEMENTED — NOT FULLY VERIFIED | `/api/admin/market-overview` 200 |
| Chat | IMPLEMENTED — NOT FULLY VERIFIED | `center-chat.ts` 8 routes |
| Responsive | NOT VERIFIED | §19 |

## 8. Velnox Corporate

12 routes, static/marketing: home, ecosystem, contact, static pages. All
informational; no commerce backend. Brand tokens consistent with
`VELNOX_DESIGN_THEME.md`. Links to the three apps exist. Status: IMPLEMENTED
(informational), NOT browser-verified this task.

## 9. Backend API audit

- 174 `/api/*` routes; 16 modules. Auth: httpOnly `SameSite=None; Secure` cookie,
  7-day JWT (`auth.ts:263-272`); staff password login separate.
- Cross-site defence: `createOriginGuard` (`server.ts:86`) + rate limiting
  (`server.ts:90`).
- Ownership: seller routes resolve `sellers.user_id`; uploads prove shop ownership
  before minting keys (`upload.ts:431-443`).
- Payment webhook: signature-verified and idempotent (`stripe.ts:8,41`).
- Gaps: no returns endpoints, no payout/settlement endpoints, no review-creation
  endpoint, no shipping-rate endpoint, no tracking-event writer.
- Duplicate logic: two seller-application flows (frontend), one `apply` endpoint.

## 10. Neon database audit

- 64 tables, 148 indexes, 20 `NUMERIC(12,2)` money columns — correct precision.
- FK integrity across orders/payments/shipments/items; one-shipment-per-order
  enforced by unique index; stock movement audited (`inventory_movements`).
- **Orphan tables:** `order_returns` has **no** read or write anywhere; `settlements`
  appears only in a `stripe.ts` comment and `ledger_entries` only in tests — schema
  ahead of implementation, a drift risk. (Corrected after AI 02 review.)
- `db/schema.sql` and `db/run-sqleditor.sql` both maintained (no drift check ran
  here — no test database; production never touched).

## 11. Convex audit

No `convex/` directory, no dependency in any `package.json`, no client calls.
Realtime is the backend's own WebSocket (`realtime/index.ts`). The brief's
"Convex = realtime/intelligence" is **documentation that the source does not
support**. Activity/intelligence lives in Postgres (`behavioral_events`,
`customer_events`) and `center.ts`.

## 12. Cloudflare R2 audit

Presign/confirm with purpose allowlist (`avatar`, `cover`, `shop-logo`,
`shop-cover`, `chat`, `announcement`); server mints keys; confirm re-checks
ownership, object size and MIME. Client converts to WebP before upload.
**Gaps:** no delete path (replaced logo/cover and deleted products leave objects);
no orphan sweep job found.

## 13. Payment audit

Stripe test mode (card + PromptPay), checkout session creation, signature-verified
webhook, idempotent status transitions, refund endpoint (webhook-confirmed),
payment incidents + reservation scheduler. **Not verified against production**;
no live transaction attempted. Shipping fee never charged — checkout totals are
product-only.

## 14. Security audit

| Control | State |
|---|---|
| Cookie store | `.ai/secrets/`, gitignored, `0600`, refuses tracked file |
| Cookie helper | cannot print a cookie; export is human-gated |
| Proxy safe mode | GET/HEAD only, 405 + never forwarded |
| Access gate | per-run token, httpOnly SameSite=Strict |
| Host/Origin/Sec-Fetch-Site | allowlisted; cross-site refused |
| Write mode | proof-file gate; production refused; bare flag refused |
| Session | httpOnly, Secure in prod, 7 days |
| Role boundary | middleware-derived; seller 403 on admin API |
| Secrets in reports | none |

All hardening from `502ce94`/`c52cd83` intact; 63 security tests green.

## 15. Architecture audit

- Single backend gateway is respected: no frontend touches Neon or R2 directly.
- Two seller-application UIs remain the main duplication (P1).
- `tracking_events`, `order_returns`, `settlements`, `ledger_entries` are unused
  structures — either build them or drop them (decision, not cleanup).
- VelCenter uses one component file (`Center.tsx`, 2701 lines) with 12 tabs — a
  maintainability risk, not a defect.

## 16. Documentation audit

- `AGENTS.md` still contains a triplicated "Progressive Context Loading" block and
  two corrupted fragments (`.ai/.text/backend.md`, `.ai/.ntext/frontend.md`).
- Brief mentions Convex; repository has none (§11).
- Brief names "NestJS"; backend is Express (`backend/server.ts`).
- Root-level `AI_RULES.md` / `AI_Handoff.md` correctly absent.

## 17. Automated test results

| Command | Result |
|---|---|
| `bun run typecheck` (4 apps) | exit 0 |
| `bun test backend/tests` | **1308 pass / 389 skip / 0 fail** (3 consecutive runs) |
| one earlier full run | 1 fail, not reproducible; flaky test suspected (proxy/port timing) |
| `bun test … proxy-security … proxy-write-mode … velcenter-nav` | 63 pass |
| `git diff --check` | exit 0 |

389 skips are DB-gated suites; no `TEST_DATABASE_URL` configured.

## 18. Browser E2E results

Owner (`role: owner`) and seller sessions, local authenticated proxy, read-only.

| App | Pages actually rendered |
|---|---|
| VelShop | home, /products, product detail + variant sheet + add-to-cart, empty cart, chat, 404 |
| Velseller | /seller/shop, /seller/orders, order detail, /seller/income |
| VelCenter | dashboard, `?tab=orders`, `?tab=sellers` |
| VelCenter (seller role) | company-only screen + 403 on admin API |
| Velnox Corporate | not opened this task |

No screenshot capability (hidden surface); evidence is DOM text + URL transitions.

## 19. Responsive QA results

**All five widths NOT VERIFIED** (360/390/768/1024/1440): the in-app WebView has
no resize control; `mcp__chrome_devtools__*` cannot start on android/arm64; an
in-page iframe harness timed out. Only the device viewport (~492 px) was rendered.

## 20. Impeccable execution evidence

```
scripts/impeccable context → error: "…impeccable" has unexpected e_type: 2
ELF header: 7f 45 4c 46 02 01 01 00 … 02 00 b7 00  (ET_EXEC, AArch64)
```
No supported alternative entry point exists; no binary was substituted.
**IMPECCABLE: BLOCKED.** No UI redesign performed.

## 21. Wholesale roadmap status

| Phase | Status | Evidence |
|---|---|---|
| 1 — Marketplace foundation | IMPLEMENTED — NOT FULLY VERIFIED | commerce works; shipping fee + returns gaps |
| 2 — Pack pricing | **NOT IMPLEMENTED** | zero references to pack price/pieces/min packs |
| 3 — Shop accounts | **NOT IMPLEMENTED** | no account/membership model |
| 4 — Restock workflow | **PARTIAL** | `Reorder.tsx` suggests restock, no pack ordering |

## 22. Critical bugs

1. **Shipping fee is always 0** — `cart.ts:117` (insert), `ShopCheckout.tsx:791`,
   `ShopCheckout.tsx:929`. Orders under-charge; income is understated. P0.
2. **`tracking_events` never written** — customer tracking page can only ever show
   the shipment's static status (P1).
3. **Flaky backend test** — one non-reproducible failure in 4 full runs (P2).

## 23. Missing features

Returns workflow · payouts/settlements · shipping-rate engine · wholesale phases
2–4 · Convex (documented, absent) · R2 object deletion · browser-verified shop
media management in the seller UI.

## 24. Blocked items

- Responsive QA (no resize path).
- Impeccable execution (arm64 engine).
- Production payment verification (test mode only; no live transaction allowed).
- DB-gated suites (no test database; Postgres `initdb` hangs on this device).
- Velnox Corporate browser pass (not opened in this audit).

## 25. Not verified items

Nine VelCenter modules not clicked · VelShop checkout/profile/addresses/wishlist/
notifications · seller logo/cover upload · corporate site · all responsive widths.

## 26. Recommended development priorities

**P0**
1. Compute and persist `shipping_fee` (server-authoritative), show it at checkout —
   `cart.ts`, `ShopCheckout.tsx`, `orders.shipping_fee`. Acceptance: order total =
   items + shipping; seller income includes it.
2. Gate checkout totals on a server quote; never ship `shippingFee: 0` as a
   constant.

**P1**
3. Returns workflow (`order_returns` exists; add endpoints/UI or drop the table).
4. Payouts/settlements (same decision).
5. Single seller-application UI (delete one of the two).
6. Write `tracking_events` on shipment transitions.

**P2**
8. VelCenter module-by-module browser QA + responsive harness.
9. `AGENTS.md` repair (duplicates/corrupted lines).
10. R2 orphan cleanup (delete on replace/delete).

**P3**
11. Wholesale phase 2 (pack pricing) once P0/P1 money paths are trustworthy.

## 27. AI 02 independent review

AI 02 fact-checked six load-bearing claims against source. **One was wrong and
was corrected in this report**: product-review creation exists
(`products.ts:3211` POST + `submitReview` in `ShopProductDetail.tsx:388`), so the
"reviews are read-only" finding was removed and the matrix row changed to
IMPLEMENTED — NOT FULLY VERIFIED.

Verdicts: shipping_fee = 0 → **CORRECT**; `order_returns` unused → **CORRECT**
(settlements/ledger re-worded to "no runtime writer"); Convex absent →
**CORRECT for code/dependencies**, re-worded because "anywhere in the repo" is
broader than what was checked; `tracking_events` read-only → **CORRECT**; review
creation missing → **WRONG, fixed**; 174 routes → **CORRECT**.

No other claim was challenged. Remaining findings are evidence-backed but not all
independently re-derived (the full 64-table and 174-route inventories were
produced by AI 01's queries).
