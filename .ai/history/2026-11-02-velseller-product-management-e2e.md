# 2026-11-02 — Velseller product management: end-to-end audit

| # | Field | Value |
|---|---|---|
| 1 | Date + time (timezone) | 2026-11-02 18:20–19:15 +07 (11:20–12:15Z) |
| 2 | AI / agent | AndroidHarness (Coding agent) |
| 3 | Git branch | `main` |
| 4 | Commit SHA before | `7396a4aea8a7305a8a7e893f89ce34b2709aa9af` (in sync with origin) |
| 5 | Commit SHA after | local commit created by this pass (**not pushed**) |
| 6 | Purpose | Prove or disprove the full product lifecycle (create → upload → save → list → edit → add → remove → save → reopen) and harden what could be proven without writing production data |
| 7 | Inspected | `MyShop.tsx`, `ProductFormDialog.tsx`, `product-images.ts` (new), `backend/routes/products.ts` (`POST /api/seller/products`, `POST save-image`, `DELETE images/:id`, `GET /api/seller/products`, `formatProduct`), `lib/product-images.ts`, `upload`/R2 helpers, live production API |
| 8 | Files touched | `packages/shared/src/lib/product-images.ts` (new), `packages/shared/src/components/seller/ProductFormDialog.tsx`, `backend/tests/product-image-state.test.ts` (new) + docs |
| 9 | Added | pure `seedGalleries` / `pendingUploads` helpers; re-seed after save; 9 deterministic unit tests |
| 10 | Removed | duplicated inline image-mapping logic in the dialog |
| 11 | What changed | the editor's image lists are now derived by one tested helper, and after a successful save they are rebuilt from the server response so a second save cannot duplicate uploads |
| 12 | Why | a repeated save re-POSTed every image that still lacked an id — the arrays were never refreshed from the server list |
| 13 | Systems affected | Velseller product editor + a new pure shared helper; no API or schema change |
| 14 | Confirmed unaffected | backend contract untouched (`tsc` 0); all four apps typecheck; Velseller build passes; i18n parity unchanged at 1346 |
| 15 | Checks run | `bun run typecheck` · `bun run build:velseller` · `bunx tsc -p backend` · `bun test backend/tests` · `bun test backend/tests/product-image-state.test.ts` · `i18n-check` · `git diff --check` · live read-only probes of the production seller API and the edit dialog at 492 px |
| 16 | Results | helper tests **9 pass / 0 fail** · full suite **1139 pass / 382 skip / 8 fail (env)** across 81 files (1538 tests) · typecheck 4/4 · build 6.75–7.12 s · i18n 1346×3 · backend tsc 0 · edit dialog renders **4/4 stored images** (`naturalWidth 1280`) at 492 px; ownership probes: seller+unknown image **404**, customer delete **403**, customer save-image **403**, seller on a foreign product **403** |
| 17 | Problems found | (a) repeated-save duplication (fixed); (b) the editor UI copy is hard-coded Thai, so EN/MY users still see Thai inside the product form (reported, not changed — large string surface, out of a correctness pass); (c) no viewport beyond 492 px can be rendered in this environment |
| 18 | Limitations | every mutating scenario (create, upload, add, remove, text save, reopen) runs against the production shop, so per the task's safety rule it was **not executed**; those rows are NOT VERIFIED and are backed only by code + unit coverage. Screenshots unavailable (§137) |
| 19 | Work still open | run the mutation matrix on a disposable seller account/database; move the product form copy into `th/en/my` |
| 20 | Next agent must know | the editor's image state must always come from `seedGalleries(product.images)` and only `pendingUploads()` may be POSTed; `save-image` returns the full product and `DELETE images/:id` is ownership-scoped server-side. Never "fix" a missing image by adding a placeholder URL |

## Verified data flow (read from source)

```
R2 draft upload  →  POST /api/seller/products/save-image
                     ├─ requireAuth → seller lookup (403 if none)
                     ├─ verifyProductOwnership(productId, seller.id) → 403 on mismatch
                     ├─ product status must not be suspended/archived → 403
                     ├─ HeadObject on R2 → 400 when the object is missing
                     ├─ sort_order = MAX(sort_order)+1 for that image_type
                     └─ INSERT product_images → returns the full formatted product
GET /api/seller/products → formatProduct() maps every row:
     images[] = { id, url, displayUrl, thumbUrl, storageKey, alt, sortOrder,
                  imageType, variantId, isPrimary }
Editor: seedGalleries(images) → { gallery, detail }
Save:   pendingUploads(state) → only drafts without an id
DELETE /api/seller/products/images/:imageId → ownership join, 404 if not theirs,
     403 when the product is suspended/archived, else delete + R2 cleanup
```

## Test matrix

| Scenario | Result | Evidence |
|---|---|---|
| Create product | **NOT VERIFIED** | writes to the live shop; payload trace only |
| Upload image | **NOT VERIFIED** | writes to production R2 + DB |
| Save product | **NOT VERIFIED** | same |
| Product appears in list | **PASS** | production API returns 2 products with statuses and image counts |
| Open edit | **PASS** | dialog 437 × 713 inside an 815 px viewport at 492 px |
| Existing images render | **PASS** | 4 `<img>`, all `naturalWidth 1280`, R2 host, counter `4 / 10` |
| Add image | **NOT VERIFIED** | write path |
| Remove image | **NOT VERIFIED** | write path; delete endpoint ownership proven (403/404 probes) |
| Text-only edit | **NOT VERIFIED** | write; save handler never touches image rows with ids |
| Reopen after save | **NOT VERIFIED** | requires a write |
| Image ordering | **PASS** | `seedGalleries` sorts by `sort_order`; unit test covers ties |
| No duplicate on repeat save | **PASS** | `pendingUploads` skips ids; 9 helper tests incl. re-seed case |
| Ownership protection | **PASS** | seller 404 / customer 403 / foreign product 403 |
| Thai UI | **PASS** | default locale renders Thai |
| English / Myanmar UI | **NOT VERIFIED** | catalogs at parity, but the product form copy is hard-coded Thai |
| 360 / 390 / 430 / 768 / 1024 / 1280 / 1440 px | **NOT VERIFIED** | no viewport control in this harness |
| 492 px | **PASS** | dialog fits, no horizontal overflow |

## Security

- `save-image` and `DELETE images/:id` both resolve the seller from the session and prove product ownership
  before writing; suspended/archived products refuse both.
- Anonymous/customer callers get 403; no client-supplied seller or shop id is trusted.
- Nothing in this change touches authorization, cookies or CORS.
