# Archived handoff sections — velShop MyOrders status contract + cart selection

Moved verbatim out of `.ai/AI_HANDOFF.md` on 2026-09-28 (sections **28** and **29**) because
the handoff was at its in-place edit ceiling (~55 KB) and both records are superseded: the
order-status contract and the cart selection UI are shipped and covered by tests. The live
state and remaining gaps stay in `.ai/AI_HANDOFF.md`.

---

## 28. velShop MyOrders crash — order-status contract completed at the source (2026-09-27)

**Reported:** production velShop `/orders` threw `Cannot read properties of undefined (reading
'badge')` (`MyOrders-DRYpOOC9.js`). **Fixed at the contract, not hidden behind optional
chaining.**

**Root cause.** `orders.status` is a superset of the fulfilment state machine: the Stripe
routes write payment-lifecycle values into the same column (`backend/routes/stripe.ts` —
`pending_payment` when a Checkout Session is created, `paid` on the confirming webhook,
`payment_failed`, `refunded`), and it is free text with **no CHECK constraint**
(`db/schema.sql`). `GET /api/customer/orders` (`backend/routes/cart.ts`) returns
`status: r.status` **raw**, while shared `ORDER_STATUS_META` knew only the six fulfilment
statuses — so the lookup was `undefined` for exactly those rows and `meta.badge` threw. Sellers
never hit it because `normalizeSellerOrderStatus` normalises first; the customer route had no
equivalent. **ACTUAL STATUS:** `pending_payment`, then `paid` — the customer's own order,
seconds after a successful test-mode checkout.

**Proven in production, not inferred.** The **deployed** bundle
(`velshop.vercel.app/assets/MyOrders-DRYpOOC9.js`) does `const a=re[s.status]` then `${a.badge}`
/ `${a.dot}` / `a.label` with **no guard**, and its table (`ShopHeader-CTizaw2L.js`) contains
**only** the six keys — `pending_payment` / `paid` / `payment_failed` / `refunded` count **0**.
`/api/stripe/configured` → `{configured:true, mode:"test", webhookConfigured:true}` with CARD +
PROMPTPAY enabled ⇒ the path that writes those statuses is live.

**Fix (Case A + Case C; no invented backend normalisation).** `StoreOrderStatus` +
`ORDER_STATUS_META` + `NEXT_ORDER_STATUSES` (`packages/shared/src/lib/commerce.ts`) now carry the
four real statuses, and a new `getOrderStatusMeta(status: unknown)` always returns a complete
`{label,badge,dot}` — a neutral "ไม่ทราบสถานะ" for anything unrecognised (unknown, null,
non-string, inherited prototype member) instead of `undefined`. Unguarded or lying call sites
switched to it: `MyOrders.tsx`, `ShopOrderDetail.tsx` (was `?? …pending`, which showed an unknown
order as "รอตรวจสอบ"), `Income.tsx` ×2. **Second defect:** a fully **refunded** order normalised to
`pending` for sellers, offering a confirm action that would silently un-refund the order's
status — now `cancelled`/terminal, matching `seller-intelligence.ts`, which already books
`refunded` as a return. No schema, migration, DB write, payment-behaviour or API-shape change.

**Verified.** `backend/tests/order-status-contract.test.ts` — **16 pass / 0 fail**: every backend
status displayable, **stripe.ts's write literals re-derived from the file itself** (a new backend
status fails the test instead of crashing a page), unknown/null/prototype fallbacks, a mixed
valid+unknown+null list rendering end to end, seller invariants. Full backend suite **589 pass /
87 skip / 0 fail** (was 573/87/660) · backend `tsc` 0 · `bun run typecheck` 4/4 exit 0 ·
`i18n:check` th=en=my=1319 · `git diff --check` clean.

**Still open:** the **browser** E2E on production `/orders` (needs a signed-in customer — Google
OAuth only, no credentials in this workspace) and the Vercel redeploy that carries the fix.

---

## 29. VelShop cart — marketplace selection + sticky summary (2026-09-27)

**Goal:** `/cart` reads like a marketplace cart without a second cart system — no new
API, table, cart store or payment code (Stripe untouched, `db/` untouched).

**What changed**
- **Grouping is by `shop_id`, not the display name.** `GET /api/customer/cart` now returns
  `shopId` (`p.shop_id AS shop_id` added to `CART_ITEMS_QUERY_FULL`/`_BASIC` + one field in
  `formatCartRow`) — the same key `POST /api/customer/checkout` groups orders by, so the
  groups shown are literally how the orders split. Additive field on existing endpoints.
- **One `Set` of cart-item ids is the only stored selection state.** Item / per-shop /
  select-all checkboxes are all *derived* (`selectionState`), so ticking one item flips its
  shop and the global box automatically and the three can never disagree. Checkbox uses
  Radix `checked="indeterminate"` — the previous `ref.indeterminate = …` on a `<button>`
  was a no-op (that property exists only on `input`), so partial state never rendered.
- **The big in-content summary box is gone.** A sticky bottom bar is the only summary
  surface (now on every breakpoint; `md:bottom-[calc(1rem+…)]` because `MobileTabBar` is
  `md:hidden`), showing selected count, subtotal, discount, shipping, total — **all derived
  from the current selection**, never the whole cart. Tapping it **only** opens the
  shop-grouped order sheet (name / variant / qty / unit price / line total per shop + the
  four totals). Checkout buttons keep the existing `navigate("/checkout", { state:
  { selectedCartItems } })` flow.
- **Discount and shipping are genuinely 0**, not invented: checkout inserts orders with
  `total_amount` only (so `orders.discount`/`shipping_fee` keep their 0 defaults), the
  order payload reports `shippingFee: 0`, and the UI reuses `checkout.shippingFree`.
  `packages/shared/src/lib/cart-selection.ts` is pure (no I/O, no React) and holds this.

**Selection cannot touch data** — it calls no API at all (only the qty stepper `setQty`,
the trash `remove` and `handleCheckout` do), and a test deep-compares the line fixtures
before/after to prove the helpers mutate nothing: no quantity, stock, order or payment path.

**Verified:** new `backend/tests/cart-selection.test.ts` **40 pass / 0 fail** (item/shop/all
selection, partial, multi-shop, empty cart, variant lines, no-mutation, summary arithmetic,
per-shop totals summing to the grand total; no mock API — pure functions over the real line
shape) · full backend suite **629 pass / 87 skip / 0 fail** (was 589/87/676) · backend `tsc`
0 · `bun run typecheck` 4/4 exit 0 · `i18n:check` th=en=my=**1320** (new `cart.discount`) ·
`bun run build:velshop` exit 0 · `git diff --check` clean.

**Responsive / mobile-first:** the bar clears the `MobileTabBar` on phones
(`bottom-[calc(5rem+env(safe-area-inset-bottom))]`, that bar is `md:hidden`) and drops to
`md:bottom-[calc(1rem+…)]` on larger screens; the page carries `pb-44 md:pb-32` so no content
sits behind it, and the sheet pads with `env(safe-area-inset-bottom)`. All three checkboxes are
a 20px box with a transparent 12px halo (`after:absolute after:-inset-3`) = a **44px** touch
target — confirmed present in the emitted `index-*.css`, not just written in the source.

**Still open:** browser verification of `/cart` (selection taps, sheet, one-handed mobile
layout) — no signed-in session exists in this workspace.
