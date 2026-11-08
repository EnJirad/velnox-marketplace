# CATEGORIES

## Purpose

Platform-owned hierarchical taxonomy. Single source of truth for discovery, filtering, and analytics.

## Source Locations

- DB: `categories` table in `db/schema.sql` / `db/run-sqleditor.sql`; seeds 15 roots + children via deterministic UUIDs (`c00000xx-...`) and `ON CONFLICT (slug) DO UPDATE` (idempotent, th/en/my in `names`/`description_names` JSONB)
- Backend: `backend/lib/categories.ts` (`validateCategory`, `resolveCategory`), `backend/routes/products.ts` — public `GET /api/categories`, `GET /api/categories/tree`, `GET /api/categories/stats`; admin `POST/PATCH/DELETE /api/admin/categories` + `GET /api/admin/categories`
- VelCenter: `apps/velcenter/src/pages/Center.tsx` (Categories tab) + `apps/velcenter/src/components/CategoriesManagement.tsx`
- Velseller: `packages/shared/src/components/seller/CategoryPicker.tsx` — hierarchical picker (search + breadcrumbs, Radix Dialog on top of `ProductFormDialog`, exactly one close X) opened from `packages/shared/src/components/seller/ProductFormDialog.tsx` (`flattenCategoryTree`); both load `/api/categories/tree` and store the canonical slug

## Data Flow

```
categories (DB) → GET /api/categories|/tree → VelCenter admin / Velseller selector (hierarchical)
→ products.category_id = slug (TEXT) → catalog JOIN c.slug = p.category_id → VelShop display/filter
```

## Important Files

`db/schema.sql`, `backend/lib/categories.ts`, `backend/routes/products.ts`, `apps/velcenter/src/components/CategoriesManagement.tsx`, `apps/velcenter/src/components/IconifyIconPicker.tsx`, `packages/shared/src/lib/icons/` (offline Iconify library: registry, lazy loader, name search, safe SVG renderer, licenses), `packages/shared/src/components/ui/category-icon.tsx`, `packages/shared/src/components/seller/CategoryPicker.tsx`, `packages/shared/src/components/seller/ProductFormDialog.tsx`.

## Icon Values (categories.icon)

A category icon value may be one of:

- **Image URL / R2 URL / data:** → rendered as `<img>` (upload route: `category-icon` purpose, R2).
- **Iconify namespaced id** — `"mdi:shopping"`, `"tabler:device-laptop"`, `"ph:house"`,
  `"lucide:shopping-bag"`, `"fa6-solid:cart-shopping"` → rendered lazily from local generated
  data (`packages/shared/src/lib/icons/generated/icons/<prefix>.json`, code-split + cached; no
  runtime icon API). 5 collections, 26,620 primary icons.
- **Legacy Lucide kebab / PascalCase / "Icon"-suffix** → curated `CATEGORY_ICON_SET` synchronous
  fast-path (map covers names that differ from Iconify lucide naming, e.g. `tools`→Wrench);
  unknown bare names resolve via the full local Lucide collection.
- **Anything else** → `Package` fallback (never blank/broken).

Render ONLY through `CategoryIcon` (shared). Licenses: lucide ISC · mdi Apache-2.0 · tabler MIT ·
ph MIT · fa6-solid CC-BY-4.0 (attribution shown in the picker). Regenerate assets:
`scripts/generate-icon-library.mjs` (writes manifest + per-collection icons/names JSON).

## VelCenter Details Panel

The category tree no longer shows product-count badges. Clicking a category **name** opens a
right-side details sheet (`Sheet side="right"`, full width on mobile) fed only by the existing
`GET /api/admin/categories` fields: `product_count` (published products — labelled as such),
`child_count`, `is_active`, `sort_order`, `created_at`, `updated_at`, `display_description`, plus
breadcrumb/parent/children derived from the tree. Quick actions reuse the existing edit/add-child/
activate/delete dialogs. Expand/collapse and the per-row action buttons stay independent of the
name-triggered details open.

## Important Rules

- Schema: `id UUID PK`, `slug TEXT UNIQUE`, `parent_id UUID REFERENCES categories(id) ON DELETE SET NULL`, `sort_order`, `names JSONB`, `description`, `description_names JSONB`, `image_url`, `is_active`. Arbitrary depth via `parent_id`. Indexes: `idx_categories_parent`, `idx_categories_parent_active`, `idx_categories_slug`, `idx_products_category`.
- Ownership: platform-owned; sellers read/select active categories only; mutations are `owner`/`admin` only.
- Safety: circular-parent prevented by DB trigger `prevent_circular_category_parent()` + app `wouldCreateCycle`; delete blocked if products or children exist (deactivate instead). Slugs: lowercase, hyphen, URL-safe, language-invariant.
- No hard-coded `const categories = [...]` in frontend; no duplicate category tables/APIs; no sample products.

## Common Failure Modes

- `c.id::text = p.category_id` JOIN (must be `c.slug = p.category_id`); inserting children before parents; duplicate slugs; orphan `parent_id`; inactive category accepted on product create.
- Long category names overflowing their container: every grid/flex chain that renders a name needs `min-w-0` on the containers, `shrink-0` on icons and `truncate` on the text node. In VelCenter's Create/Edit dialog the parent-category `<select>` needs `w-full min-w-0 truncate` (its wrapper is a `min-w-0` grid item) or a long `<option>` grows past its column and covers the “ลำดับ” field.

## Verification

Fresh DB → `SELECT COUNT(*) FROM categories` = 96; `GET /api/categories` + `/tree` return hierarchy; VelCenter CRUD + search; Velseller selector shows indented tree; backend rejects invalid/inactive slug; `diff db/schema.sql db/run-sqleditor.sql` clean.

Related: `database.md`, `products.md`, `seller.md`.
