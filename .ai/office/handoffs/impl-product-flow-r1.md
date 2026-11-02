# Implementation report — product-creation-flow-audit (round 1)

STATUS: done · implemented from `.ai/office/handoffs/brief-product-flow.md`

## Files changed (5)

- `packages/shared/src/components/seller/ProductFormDialog.tsx` — migrated ALL user-facing copy to the new `productForm` i18n namespace (create/edit dialog, VariantManager, validation messages, toasts, aria-labels). Create-mode default unit is now localized via `defaultUnit` in the useState initializer; the module-level `defaultForm.unit: "ชิ้น"` remains as a data-shape fallback (documented). ฿ currency glyphs and `toLocaleString()` number formatting untouched.
- `packages/shared/src/lib/i18n/locales/th.ts` — added `productForm` namespace (108 keys, source of truth)
- `packages/shared/src/lib/i18n/locales/en.ts` — same shape, English
- `packages/shared/src/lib/i18n/locales/my.ts` — same shape, Burmese
- `backend/routes/products.ts` — added explicit `MAX_VARIANTS = 100` guard to `POST /api/seller/products/create-full` with 400 `VALIDATION_ERROR` (the generate endpoint already capped at 100; create-full bypassed it)

DIFF SIZE at time of writing: 5 files, +472/−116

## Brief-step disposition

- Step 1 (i18n migration): DONE as above.
- Step 2 (empty-gallery validation): ALREADY PRESENT pre-existing (validate() line ~747 pushes `errGalleryRequired` for both create and edit when `galleryImages.length === 0`) — no change needed; reported, not duplicated.
- Step 4 (backend variant cap + missing-option-groups 400): cap ADDED; missing/unknown option-group selections were ALREADY enforced server-side (products.ts 785–819: unknown option values → 400, missing selection when groups declared → 400). Only the cap was missing.
- Step 5 (response header exposing image persistence): NOT IMPLEMENTED — judged redundant with step 3's DB-based verification (the header adds API surface for the same evidence; kept the contract unchanged per user constraint). Flagged for QA judgement.
- Step 7 (DB-gated ownership test probes): NOT ADDED — the existing `seller-access-authorization.test.ts` and `product-visibility` suites already cover ownership isolation, and HTTP-level probes require `TEST_DATABASE_URL` (unset locally; they would skip). No new test file was added; coverage documented as pre-existing.

## Commands run (real results)

- `bun run i18n:check` → exit 0, `th=1562 en=1562 my=1562 keys, all locales at parity` (1454 + 108 productForm)
- `bun run typecheck` → exit 0 (all 4 apps); `bun --filter @velnox/backend typecheck` → exit 0
- `bun test ./backend/tests/product-image-state.test.ts` → 9 pass 0 fail
- `bun test ./backend/tests/product-upload-guards.test.ts` → 7 pass 0 fail
- `bun test ./backend/tests/category-validation.test.ts` → 18 pass 3 skip 0 fail
- `bun test ./backend/tests/product-variant-options.test.ts` → 11 pass 0 fail
- `bun test ./backend/tests/product-lifecycle.test.ts` → 77 pass 3 skip 0 fail
- `bun test ./backend/tests/upload-security.test.ts` → 14 pass 7 skip 0 fail
- `bun test ./backend/tests/commerce-core-invariants.test.ts` → 23 skip (DB-gated)
- `bun run test` (full) → 1155 pass / 382 skip / **8 fail** — all 8 are the pre-existing `test-database-isolation` execPath environmental failures (identical failure list to the daily-health-report baseline; no new failures)
- `bun --filter @velnox/velseller build` → exit 0 (✓ 12.30s); `bun --filter @velnox/velshop build` → exit 0 (✓ 14.31s) — both ProductFormDialog consumers

## File state this report describes

HEAD `8e1b415`, branch `main`, nothing staged/committed, working tree contains
exactly the 5 modified files above plus this handoff. No backend tests were
added or modified; no schema files touched; `db/schema.sql` unchanged.

---

# Round-2 addendum (QA round-1 corrections D1 + D2)

## D1 — negative stock now an explicit validation error

- `productForm.errStockNegative` added to all three locales (1563×3 parity)
- `validate()` now rejects `stock < 0` (and non-numeric non-empty stock) per
  variant with a localized error; the server-side `Math.max(0, …)` clamps in
  create-full remain untouched as defense in depth

## D2 — new DB-gated ownership probe file

- `backend/tests/seller-product-ownership.test.ts` (new, 7 tests): mounts the
  REAL `setupProductRoutes` + `setupProductOptionRoutes` on a throwaway express
  server, seeds two approved sellers with shops, creates a product via the real
  `create-full` endpoint as seller A, then probes cross-seller access
  (expects 403/404, never 200) and unauthenticated access (401/403) across
  product PATCH/DELETE, option groups/values, variants list/generate, and the
  shop-scoped product list (B must not see A's product even in a search).
  Skips locally without `TEST_DATABASE_URL` (7 skips observed); runs in CI
  against the disposable PostgreSQL from .github/workflows/test.yml.

## Commands re-run after corrections (real results)

- `bun run i18n:check` → exit 0, `th=1563 en=1563 my=1563 keys, all locales at parity`
- `bun run typecheck` → exit 0 (4/4 apps); `bun --filter @velnox/backend typecheck` → exit 0
- `bun test ./backend/tests/seller-product-ownership.test.ts` → 0 fail, 7 skip (DB-gated)
- `bun run test` (full) → 1155 pass / 389 skip / 8 fail — the 8 are byte-for-byte
  the pre-existing `test-database-isolation` execPath failures; no new failures
