# CUSTOMER

## Purpose

Customer profile, addresses, wishlist, cart helpers, and discovery.

## Source Locations

- `backend/routes/index.ts` — `GET/PUT /api/customer/profile`, `GET/POST /api/customer/addresses`, `DELETE /api/customer/addresses/:id`
- `backend/routes/cart.ts` — cart + `cart_items`
- `packages/shared/src/lib/commerce.ts`, `packages/shared/src/lib/track.ts`, `packages/shared/src/lib/reorder.ts`
- `apps/velshop/src/pages/*` — product browsing, cart drawer, wishlist, velrepeat

## Data Flow

```
GET /api/auth/me → customer profile/address/cart APIs (requireAuth) → Neon
→ cart_items (with product/variant) → checkout; behavioral_events for tracking
```

## Important Files

`backend/routes/index.ts`, `backend/routes/cart.ts`, `apps/velshop/src/pages/ShopProducts.tsx`.

## Important Rules

- All customer mutations require auth + ownership. `carts` is one-per-user; `cart_items` composite uniqueness includes variant.
- `behavioral_events` is analytics only, never source of truth.

## Common Failure Modes

- Missing `requireAuth` on customer routes; cart quantity exceeding variant stock.

## Verification

Typecheck `backend` + `velshop`; test profile update, address CRUD, cart add/update/remove, wishlist.

Related: `security.md`, `checkout.md`, `products.md`.
