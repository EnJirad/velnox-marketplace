# PRODUCTS

## Purpose

Product catalog, creation, editing, display, search, filtering, and lifecycle/moderation.

## Source Locations

- `backend/routes/products.ts` — catalog + CRUD + category joins (note: `c.slug = p.category_id`)
- `backend/routes/product-options.ts`, `backend/lib/variant-options.ts` — option groups/values, variant mapping
- `backend/lib/product-lifecycle.ts`, `backend/lib/inventory.ts` — status machine, stock
- `backend/lib/categories.ts` — DB-backed `validateCategory` / `resolveCategory` (slug-based)
- `packages/shared/src/components/seller/ProductFormDialog.tsx` — seller product form (loads categories from `GET /api/categories/tree`)
- `packages/shared/src/lib/commerce.ts` — types, `PRODUCT_CATEGORY_META` fallback
- `apps/velshop/src/pages/*` — product listing/detail, search

## Data Flow

```
categories (slug) → ProductFormDialog loads GET /api/categories/tree → seller selects slug
→ backend validates via categories table → products.category_id (TEXT = slug)
→ catalog/detail queries JOIN c.slug = p.category_id → storefront display + filtering
```

`products.category_id` is `TEXT` storing the category **slug**, not a UUID FK (migrations 015/029).

## Important Files

`backend/routes/products.ts`, `backend/lib/categories.ts`, `packages/shared/src/components/seller/ProductFormDialog.tsx`.

## Important Rules

- Validate `category_id` server-side against `categories` (exists + `is_active`). Never trust client slug.
- Variants/options use `optionValue.id` (UUID), not display text, for identity.
- Product images via `product_images` / `product_variant_images`; fixed R2 keys where applicable.
- Status/moderation via lifecycle lib; preserve existing `status` values.

## Common Failure Modes

- Wrong category JOIN (`c.id::text = p.category_id` → always NULL). Flat category selector when tree exists. Missing `is_active` check.

## Verification

Typecheck `backend` + `velshop`/`velseller`; test create/edit/list/detail/search/filter with valid/invalid categories and variants.

Related: `docs/ai/CATEGORIES.md`, `docs/ai/SELLER.md`, `docs/ai/MEDIA.md`.
