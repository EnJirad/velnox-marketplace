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

## Common Failure Modes

- `seller === null` conflated with loading (use `sellerLoaded`); missing ownership check on presign/confirm; shop `category`/`address` fields not persisted.

## Verification

Typecheck `backend` + `velseller`; test apply → approval → profile/shop update → product create with category → R2 shop media.

Related: `security.md`, `categories.md`, `products.md`, `media.md`.
