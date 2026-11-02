TASK BRIEF product-creation-flow-audit
REQUEST: Audit, test, and improve the complete Velseller Product Creation Flow end-to-end: open creation page → enter info → select category → configure variants/options (if supported) → upload images via the EXISTING Cloudflare R2 pipeline → price + inventory → submit → success/error state → product exists in backend/DB → re-open edit → saved data preserved (incl. images, category, price, inventory, variants) → product appears in seller list/dashboard → auth/ownership/API/storage behavior intact.

AFFECTED FILES:
- packages/shared/src/components/seller/ProductFormDialog.tsx (frontend create/edit form)
- apps/velseller/src/pages/MyShop.tsx (seller dashboard entry point)
- backend/routes/products.ts (seller product CRUD + image endpoints)
- backend/routes/product-options.ts (option groups/values + variant generation)
- backend/routes/upload.ts (R2 presign/confirm pipeline)
- backend/lib/product-images.ts (seedGalleries/pendingUploads helpers)
- backend/lib/upload-paths.ts (sanitiseSegment/sanitiseSubfolder guards)
- backend/lib/categories.ts (validateCategory/resolveCategory)
- backend/lib/variant-options.ts (normalizeVariantOptions/resolveVariantOptionValueIds)
- backend/lib/media-config.ts (MAX_UPLOAD_BYTES/isUploadTooLarge)
- backend/lib/product-lifecycle.ts (canSellerTransition/resolveCreationStatus)
- backend/lib/inventory.ts (reserveInventoryStock/releaseOrderInventory)
- db/schema.sql (products, product_images, product_variants, product_option_groups, product_option_values, product_variant_values, inventory, categories tables)
- backend/tests/product-image-state.test.ts (unit tests for image state)
- backend/tests/product-upload-guards.test.ts (unit tests for upload guards)
- backend/tests/category-validation.test.ts (unit + integration tests)
- backend/tests/product-lifecycle.test.ts (unit + integration tests)
- backend/tests/product-variant-options.test.ts (unit tests)
- backend/tests/seller-access-authorization.test.ts (unit + integration tests)
- backend/tests/inventory-race.test.ts (unit + integration tests)
- backend/tests/buy-now-checkout.test.ts (unit + integration tests)

APPROACH: Static audit of the existing product creation flow — no redesign, no new architecture, no mock APIs/fake data, no schema changes unless genuinely required (none found). The flow already uses the correct systems: R2 presign → PUT → confirm → media row → product_images rows; category validation against categories table; variant/option linkage via product_variant_values; ownership enforcement via verifyProductOwnership; seller approval gate via requireApprovedSeller middleware. Recent history shows three fixes already applied: (1) seedGalleries/pendingUploads for image state (commit 7396a4a), (2) upload-path sanitisation + stored-size check (commit 68dd372), (3) existing image restoration (commit 1e51ff0). The audit identifies remaining gaps in validation, error states, i18n, and test coverage that are fixable without schema changes.

STEPS:
1. Fix i18n gap: ProductFormDialog has hard-coded Thai labels/placeholders — migrate to use t() keys from shared locales (th/en/my) matching the rest of the codebase.
2. Tighten frontend validation: Add missing checks for compareAtPrice ≥ price, discountPercent ≤ 100, stock ≥ 0 in create mode (currently only edit mode validates); ensure variant array non-empty for products with options.
3. Improve error-state UX: Surface backend error codes (INVALID_CATEGORY, FILE_TOO_LARGE, INSUFFICIENT_STOCK, SELLER_NOT_APPROVED) as localized toasts instead of generic "บันทึกไม่สำเร็จ".
4. Backend: Add explicit 400 for variantCount > 100 in create-full (currently only generate endpoint caps); add 400 for missing option groups when variants reference them.
5. Backend: Ensure save-image returns updated product with re-seeded image arrays (already implemented) but add response header indicating if images were persisted.
6. Add integration test coverage for create→upload→save→edit→reopen matrix (requires TEST_DATABASE_URL; note 8 pre-existing env failures in test-database-isolation).
7. Verify ownership isolation: seller cannot access foreign product images/options/variants — add test probes for 403/404 on all seller product endpoints.
8. Run typecheck + build:apps + i18n:check + bun test backend/tests + git diff --check.

ACCEPTANCE CRITERIA:
1. ProductFormDialog renders all labels/placeholders via t() in th/en/my — no hard-coded Thai strings in JSX.
2. Frontend validation rejects create-mode submit when: compareAtPrice < price, discountPercent > 100, stock < 0, variantCount > 100, or galleryImages empty.
3. Backend create-full returns 400 with INVALID_CATEGORY, FILE_TOO_LARGE, or VALIDATION_ERROR codes as appropriate.
4. save-image endpoint returns updated product; frontend re-seeds gallery/detail from response (no duplicate images on repeat save).
5. Edit dialog opens with existing images, category, price, inventory, variants, attributes preserved (verified via seedGalleries tests + live API probes).
6. Product appears in MyShop list with correct status, image count, variant count after create.
7. Owner cannot access another seller's product images/options/variants (403/404 on all endpoints).
8. All typechecks pass (4/4), velseller builds, i18n parity (1346×3), backend test suite runs (1139 pass / 382 skip / 8 env fail), git diff --check clean.

TEST CASES:
- bun run typecheck → exit 0
- bun run build:velseller → exit 0
- bun run i18n:check → exit 0
- bun test backend/tests/product-image-state.test.ts → 9 pass / 0 fail
- bun test backend/tests/product-upload-guards.test.ts → 7 pass / 0 fail
- bun test backend/tests/category-validation.test.ts → unit tests pass
- bun test backend/tests/product-lifecycle.test.ts → unit tests pass
- bun test backend/tests/product-variant-options.test.ts → 22 pass / 0 fail
- bun test backend/tests/seller-access-authorization.test.ts → unit tests pass
- bun test backend/tests/inventory-race.test.ts → unit tests pass
- bun test backend/tests/buy-now-checkout.test.ts → unit tests pass
- git diff --check → clean

RISKS:
- i18n migration is large surface (100+ strings in ProductFormDialog) — may miss keys or introduce inconsistencies.
- Frontend validation duplicates backend logic; divergence could cause confusing UX if backend accepts what frontend rejects.
- TEST_DATABASE_URL unset in this environment — DB-gated integration tests skip; production mutations cannot be verified safely.
- 8 pre-existing test failures in test-database-isolation (process.execPath linker issue) are environmental, not code defects.
- Product form Thai-only copy was reported in history but not fixed — could be scope creep if not bounded.

SCOPE LIMITS:
- NO schema changes (db/schema.sql, db/run-sqleditor.sql) — existing tables/columns sufficient.
- NO new API endpoints — reuse existing /api/seller/products, /api/seller/products/create-full, /api/seller/products/save-image, /api/seller/products/draft-upload-intent, /api/seller/products/image-upload-intent, /api/seller/products/options, /api/seller/products/variants.
- NO R2 configuration changes — fixed keys and presign pipeline are correct.
- NO auth/ownership model changes — verifyProductOwnership and requireApprovedSeller are correct.
- NO variant/option architecture changes — product_variant_values linkage is correct.
- NO duplicate systems or mock APIs — real DB/R2 only.
- Image add/remove/save against production shop NOT executed in audit (would mutate production data); those paths are code-verified only.

CURRENT ARCHITECTURE:
Frontend files:
- packages/shared/src/components/seller/ProductFormDialog.tsx: Main create/edit dialog with sections for product info, category picker, option groups, variants (auto-generated), gallery images (draft upload), detail images (draft upload), option value images, attributes. Uses seedGalleries/pendingUploads for image state. Draft upload via /api/seller/products/draft-upload-intent → R2 PUT → local state. Save via createFullProductAction (new) or updateProductAction + saveOptions + save-image (edit). VariantManager component for edit mode manages existing variants (price, stock, SKU, images). CategoryPicker loads from /api/categories/tree.

Backend/API files:
- backend/routes/products.ts: Seller endpoints (requireAuth + ownership): GET /api/seller/products, POST /api/seller/products, PATCH /api/seller/products/:productId, DELETE /api/seller/products/:productId, PATCH /api/seller/products/:productId/status, POST /api/seller/products/draft-upload-intent, POST /api/seller/products/image-upload-intent, POST /api/seller/products/save-image, DELETE /api/seller/products/images/:imageId, PATCH /api/seller/products/:productId/primary-image, PATCH /api/seller/products/:productId/reorder-images. Public endpoints: GET /api/products/catalog, GET /api/products/:productId. Uses verifyProductOwnership (product→shop→seller join). formatProduct maps DB rows to StoreProduct with images, variants, inventory. applyVariantStock sums active variant stock. loadProductExtras bulk-loads images/inventory/variants/detail-images.

- backend/routes/product-options.ts: Seller endpoints for option groups/values, attributes, variant generation, variant CRUD, variant images. Uses getSellerForUser (approved-only) + verifyProductOwnership. validateCategory via lib/categories.ts.

- backend/routes/upload.ts: Generic R2 presign/confirm for avatar/cover/shop-logo/shop-cover/chat/announcement. Fixed keys (profile/avatar/{userId}.webp etc.). Media table upsert on confirm. validateObjectKeyOwnership enforces prefix ownership.

DB tables:
- products (id, shop_id, name, slug, description, short_description, price, compare_at_price, currency, unit, supplier, status, category_id TEXT=slug, featured_variant_id, verification_status, created_at, updated_at)
- product_images (id, product_id, url, alt, sort_order, image_type gallery/detail/variant, variant_id, created_at)
- product_variants (id, product_id, name, sku, price, compare_at_price, discount_percent, stock, status, options JSONB, sort_order, created_at, updated_at)
- product_option_groups (id, product_id, name, display_type, required, sort_order, created_at, updated_at)
- product_option_values (id, option_group_id, value, label, image_url, is_enabled, sort_order, created_at)
- product_variant_values (id, variant_id, option_value_id, UNIQUE)
- inventory (id, product_id UNIQUE, quantity, reserved, reorder_level, low_stock_threshold, updated_at)
- categories (id, name, slug UNIQUE, icon, parent_id, sort_order, names JSONB, description, description_names JSONB, image_url, is_active, created_at, updated_at)

R2 flow:
1. Frontend: POST /api/seller/products/draft-upload-intent (draftId, filename, mimeType, subfolder) → presigned PUT URL (draft-uploads/{sellerId}/{safeDraftId}/{safeSubfolder}/{uuid}.webp)
2. Frontend: PUT file to R2 (converts to WebP client-side)
3. Frontend: POST /api/seller/products/save-image (productId, objectKey, cdnUrl, alt, imageType, variantId) → backend HeadObject to verify object exists + size ≤ 10MB → INSERT product_images → returns full formatted product
4. Edit: existing images seeded via seedGalleries(product.images); pendingUploads filters drafts without id; re-seed after save from server response

Auth/ownership:
- requireAuth middleware validates JWT from httpOnly cookie
- getSellerForUser requires sellers.status = 'approved'
- verifyProductOwnership joins product→shop→seller
- All seller product endpoints check ownership before any write
- Terminal statuses (suspended/archived) block seller writes (admin-only)
- Seller cannot access another seller's product/images/options/variants (403/404)

Existing validation:
- Category: resolveCategory validates slug/UUID against categories table + is_active
- Image: ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES (10MB), sanitiseSegment/sanitiseSubfolder for draft path
- Variant: max 100 variants, option-value consistency validated in create-full
- Stock: reserveInventoryStock validates available ≥ requested; releaseOrderInventory idempotent
- Status: resolveCreationStatus maps seller-requested 'published' → 'pending_review'; canSellerTransition enforces state machine

Existing tests:
- product-image-state.test.ts: 9 tests for seedGalleries/pendingUploads (split by type, order, id retention, null input, re-seed no-dup)
- product-upload-guards.test.ts: 7 tests for path sanitisation + size check wiring
- category-validation.test.ts: validateCategory unit tests + schema consistency + integration (skipped w/o test DB)
- product-lifecycle.test.ts: creation status, seller/admin transitions, visibility, V eligibility, verification schema, R2 pipeline, variants+cart, rate limits, schema sync
- product-variant-options.test.ts: 22 tests for normalizeVariantOptions, buildOptionValueIndex, resolveVariantOptionValueIds
- seller-access-authorization.test.ts: isSellerApproved/shouldShowSellerTab unit + HTTP integration (5 statuses, ownership isolation)
- inventory-race.test.ts: validateCheckoutQuantity + reservation/release integration (concurrent, rollback, double-release)
- buy-now-checkout.test.ts: buy-now contract (client sends quantity, server reads price, cart untouched, idempotent) + DB integration

Known problems (from history):
1. ProductFormDialog UI copy is hard-coded Thai — EN/MY users see Thai inside product form (reported, not changed — large string surface).
2. Create/edit/add/remove/save/reopen mutations NOT VERIFIED against disposable database (would mutate production).
3. Viewports other than 492px NOT VERIFIED (no viewport control in harness).
4. 8 pre-existing test failures in test-database-isolation (process.execPath linker issue) are environmental.
5. Repeat-save duplication fixed by pendingUploads + re-seed; earlier image loss fixed by seedGalleries.
6. Draft upload path traversal + oversized image acceptance fixed by sanitiseSegment/sanitiseSubfolder + isUploadTooLarge.

NOT VERIFIED (static inspection only):
- Actual R2 PUT from frontend (browser WebP conversion + PUT to presigned URL)
- Full create→upload→save→edit→reopen mutation matrix on disposable database
- EN/MY rendering of ProductFormDialog after i18n migration
- Viewport sweep (360/390/430/768/1024/1280/1440px)
- Screenshots (unavailable in harness)
- Production Neon DB state (read-only for agents per §17)

IMAGE LIFECYCLE (verified from history):
- Existing images seed editor via seedGalleries → gallery/detail split by image_type
- Draft uploads stored in local state (DraftImage with optional id)
- save-image persists only pendingUploads (drafts without id)
- After save, frontend re-fetches product and re-seeds from server images
- Remove existing image (has id) → DELETE /api/seller/products/images/:id (ownership checked server-side)
- Remove draft (no id) → local state filter only
- R2 object deleted on server delete (awaited)
- Counter shows gallery.length / 10, detail.length / 10
