# SELLER

## Purpose

Seller identity, onboarding, shop/profile, products, orders, and verification.

## Source Locations

- `backend/routes/seller.ts` — `POST /api/seller/apply`, `GET /api/seller/status|profile`, `PATCH /api/seller/shop`, admin `GET /api/admin/sellers` + `PATCH /api/admin/sellers/:id/status`
- `backend/middleware/seller.ts` — `resolveSellerAccess(userId)` + `requireApprovedSeller` (the ONE server-side seller-access decision; 403 `SELLER_NOT_APPROVED`)
- `backend/routes/verification.ts`, `backend/routes/seller-orders.ts`, `backend/routes/seller-intelligence.ts`
- `packages/shared/src/lib/seller-access.ts` + `packages/shared/src/hooks/use-seller-application.ts` — fail-closed client reading of the server verdict
- `packages/shared/src/components/RequireRole.tsx` — 4-step onboarding (Store Info → Applicant → Identity → Review) + revision prefill
- `packages/shared/src/components/seller/*` — `EvidenceUploader.tsx`, `ImageUploader.tsx`, `ProductFormDialog.tsx`
- `apps/velseller/src/pages/*` — Goals, MyShop, Orders, Income, Reorder, SellerProfile

## Data Flow

```
Google user → POST /api/seller/apply (shop + applicant data) → sellers (pending)
→ admin approves (transaction + audit_logs + users.role → seller) → seller manages shop/products
→ PATCH /api/seller/shop (owner-checked) → R2 presign for shop logo/cover
```

Shop media keys: `shop/{shopId}/logo.webp`, `shop/{shopId}/cover.webp` (ownership via seller→shop).

## Important Files

`backend/routes/seller.ts`, `packages/shared/src/components/RequireRole.tsx`, `apps/velseller/src/main.tsx`.

## Important Rules

- Canonical statuses: `pending|under_review|needs_correction|approved|rejected|suspended`. Approval uses `FOR UPDATE` lock, promotes `users.role`, writes `audit_logs`, blocks self-approval.
- **Seller access = `sellers.status === 'approved'` ONLY.** `GET /api/seller/status` computes `sellerAccess` server-side; the seller tab bar and every seller dashboard API gate on it (never on `users.role`, never on a client-sent flag). Everything else is refused: `requireApprovedSeller` → 403 `SELLER_NOT_APPROVED`; the UI hides the tab while loading, on error, and for every non-approved status (fail closed).
- Applicant-side endpoints (`POST /api/seller/apply`, `GET /api/seller/status`, `/api/seller/evidence*`, `/api/seller/verification`) are deliberately NOT approval-gated — they are the application flow.
- `needs_correction` / `rejected` resubmission reuses the SAME `sellers` row and the SAME application: `RequireRole` prefills the previous shop + applicant data and re-hydrates the three identity documents from `GET /api/seller/evidence` (matched by purpose), so nothing has to be re-entered or re-uploaded.
- All shop/product mutations verify `user → seller → shop` ownership server-side.
- `PRODUCT_CATEGORY_META` is display fallback only; categories come from `GET /api/categories`.

## Seller order surfaces (VelSeller Orders)

```
GET   /api/seller/orders?limit=&status=&offset=   list — seller-scoped, server-side status filter
GET   /api/seller/orders/:id                      detail — ownership verified INSIDE the query
PATCH /api/seller/orders/:id/status               transition — enforced by canTransitionOrderStatus()
```

- **`/seller/orders/:orderId` is a SELLER route** (`RequireRole role="seller"`), backed by
  `apps/velseller/src/pages/SellerOrderDetail.tsx`. It reads the seller endpoint only — never
  `api.customer.orderDetail` — and passes no seller id: the server resolves it from the session.
- **Ownership is in the SQL** (`WHERE o.id = $1 AND sh.seller_id = $2`) and only this seller's items are
  selected (`fetchSellerItemsForOrders`) — another seller's portion of a shared order is never exposed.
  Unknown and foreign orders answer the SAME 404, so existence does not leak.
- **The status buttons come from `NEXT_ORDER_STATUSES`** in `commerce.ts`, which mirrors
  `SELLER_ORDER_STATUS_TRANSITIONS` in `backend/routes/seller-orders.ts`
  (`backend/tests/seller-order-ux.test.ts` pins the two together). Terminal statuses offer nothing.
  Cancelling restores the seller's stock server-side and is confirmed first.
- `normalizeSellerOrderStatus()` maps the payment-lifecycle values stripe.ts writes onto the six
  fulfilment statuses: `pending_payment`/`paid` → `pending`, `expired`/`refunded`/`payment_failed` →
  `cancelled`. The list's filter chips are exactly those six.
- **Starting fulfilment is GATED on payment** (`sellerConfirmationPaymentGate()`, 2026-09-29):
  `pending → confirmed` is refused with **409 `PAYMENT_REQUIRED`** for CARD / PROMPTPAY until a payment
  really SUCCEEDED (`payments.status = 'paid'`, written by the Stripe webhook only). There is
  deliberately NO seller action that marks a Stripe payment paid — the status button is a FULFILMENT
  action, not a payment one. COD may always start (the carrier collects, so a `pending` payment row is
  normal for the whole delivery); an absent/unrecognised method fails CLOSED unless a payment provably
  succeeded. `SellerOrderDetail` mirrors the same rule through `orderFulfillmentPaymentGate()` and
  disables the confirm button with the `sellerOrders.paymentLock*` reason instead of letting the API
  refuse silently.
- **The shipping contact comes from the order's OWN snapshot** — `orders.shipping_address`, read through
  `shippingContact()`: `customerPhone` is `addressSnapshot.phone`, NEVER `users.phone` (the seller
  queries no longer select it at all). A legacy order whose snapshot has no phone reports NO phone
  (`sellerOrders.phoneUnavailable`) rather than borrowing today's profile, so editing a profile can
  never rewrite an order's history. Both seller endpoints also return `paymentMethod`, and the list's
  payment badge comes from `orderPaymentSummary()` — a COD order reads as COD, not "awaiting payment".
- **Cancellation is locked by fulfilment evidence** (see `checkout.md`): a `shipments` row ⇒ **409
  `ORDER_ALREADY_SHIPPING`** for the customer, and this route takes the same `orders` row lock, so a
  seller confirm racing a customer cancel resolves to exactly one outcome. Seller cancellation releases
  stock through the canonical `releaseOrderInventory()`, never a hand-rolled `stock + qty`.
- The order-status badge and the progress-stage icons live in
  `packages/shared/src/components/order/OrderStatusBadge.tsx` — ONE mapping shared with VelShop.

## Common Failure Modes

- `seller === null` conflated with loading (use `sellerLoaded`); missing ownership check on presign/confirm; shop `category`/`address` fields not persisted; offering a status transition the backend refuses (read `NEXT_ORDER_STATUSES`, never a hand-written list); confirming an unpaid CARD/PROMPTPAY order (the server answers 409 `PAYMENT_REQUIRED` — treat the seller status button as FULFILMENT, never as a way to mark a Stripe payment paid); showing `users.phone` or the current profile address as the shipping contact instead of the order's `shipping_address` snapshot.

## Verification

Typecheck `backend` + `velseller`; test apply → approval → profile/shop update → product create with category → R2 shop media.

Related: `security.md`, `categories.md`, `products.md`, `media.md`.
