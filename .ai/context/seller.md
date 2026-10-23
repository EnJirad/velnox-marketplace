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
  `FULFILLMENT_TRANSITIONS` in `backend/lib/order-fulfillment.ts` — the ONE authority for the
  fulfilment state machine, shared with the VelCenter admin route (`backend/routes/center.ts`)
  (`backend/tests/seller-order-ux.test.ts` pins the two together). Terminal statuses offer nothing.
  Cancelling restores the seller's stock server-side and is confirmed first.
- **The chain is `pending → confirmed → packing → shipped → delivered → completed`, plus terminal
  `cancelled`.** `confirmed` means the shop ACCEPTED the order — packing has not started, so the
  customer may still cancel. `packing` means fulfilment has STARTED (items being picked/packed):
  from there NEITHER side may cancel (there is no `packing → cancelled` edge) and the only move is
  `shipped`. Two gates are enforced inside the seller route's transaction, under `FOR UPDATE` on
  the order row: shifting to `confirmed` requires a SETTLED payment (a `paid` `payments` row — the
  Stripe webhook is the only writer; COD passes only while its disabled rail is on), and
  `packing → shipped` requires a `shipments` row with a carrier AND a tracking number, sent with
  the transition (`carrier` + `trackingNumber` in the request body) so the status change and the
  shipment are one transaction. The seller's ship dialog and VelCenter's
  (`apps/velcenter/src/components/OrderShipDialog.tsx`) collect those two values.
- `normalizeSellerOrderStatus()` maps the payment-lifecycle values stripe.ts writes onto the seven
  fulfilment statuses: `pending_payment`/`paid` → `pending`, `expired`/`refunded`/`payment_failed` →
  `cancelled`. The list's filter chips are exactly those seven. Payment state stays a SEPARATE axis
  exposed as `paymentStatus` — a fulfilment status never stands in for it.
- **Contact details come from the ORDER, not the profile:** the seller list/detail read
  `orders.shipping_address.recipientName` / `.phone` (`orderContact()` in `seller-orders.ts`) and
  fall back to the account row only when a legacy order's snapshot lacks them, so a customer who
  edits their name or phone later never rewrites an order that was already placed.
- The order-status badge and the progress-stage icons live in
  `packages/shared/src/components/order/OrderStatusBadge.tsx` — ONE mapping shared with VelShop.

## Common Failure Modes

- `seller === null` conflated with loading (use `sellerLoaded`); missing ownership check on presign/confirm; shop `category`/`address` fields not persisted; offering a status transition the backend refuses (read `NEXT_ORDER_STATUSES`, never a hand-written list).

## Verification

Typecheck `backend` + `velseller`; test apply → approval → profile/shop update → product create with category → R2 shop media.

Related: `security.md`, `categories.md`, `products.md`, `media.md`.
