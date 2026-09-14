# SELLER

## Purpose

Seller identity, onboarding, shop/profile, products, orders, and verification.

## Source Locations

- `backend/routes/seller.ts` — `POST /api/seller/apply`, `GET /api/seller/status|profile`, `PATCH /api/seller/shop`, admin `GET /api/admin/sellers` + `PATCH /api/admin/sellers/:id/status`
- `backend/routes/verification.ts`, `backend/routes/seller-orders.ts`, `backend/routes/seller-intelligence.ts`
- `packages/shared/src/components/RequireRole.tsx` — 4-step onboarding (Store Info → Applicant → Identity → Review)
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

- Canonical statuses: `pending|approved|rejected|suspended`. Approval uses `FOR UPDATE` lock, promotes `users.role`, writes `audit_logs`, blocks self-approval.
- All shop/product mutations verify `user → seller → shop` ownership server-side.
- `PRODUCT_CATEGORY_META` is display fallback only; categories come from `GET /api/categories`.

## Common Failure Modes

- `seller === null` conflated with loading (use `sellerLoaded`); missing ownership check on presign/confirm; shop `category`/`address` fields not persisted.

## Verification

Typecheck `backend` + `velseller`; test apply → approval → profile/shop update → product create with category → R2 shop media.

Related: `docs/ai/AUTH.md`, `docs/ai/CATEGORIES.md`, `docs/ai/PRODUCTS.md`, `docs/ai/MEDIA.md`.
