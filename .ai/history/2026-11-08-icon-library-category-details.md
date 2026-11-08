# 2026-11-08 — Icon Library (offline Iconify) + Category Details Panel (VelCenter)

Starting commit: `96870bb4cdb9f12d4be1170d8c7ef086aaf12fc6` (HEAD == origin/main, clean).
Ending commit: set after push (see git log).

## Scope
Integrate the full Iconify icon library into VelCenter category management (offline, lazy),
remove the slug preview/copy/refresh UI, and move product counts from the tree into a category
details panel. Owner-approved "Approach A — Iconify Full Library (offline local, backward
compatible)".

## Findings (verified)
- `packages/shared/src/lib/icons/` was scaffolded at `7d06455` (registry, lazy loader via
  dynamic `import()` of `generated/icons/*.json`, name search over `generated/names/*.json`,
  safe allowlist SVG renderer, licenses, `LibraryIcon`) but was UNCONNECTED and had latent bugs:
  - `icon-licenses.ts` comment `` `@iconify-json/*/info.json` `` contained `*/`, prematurely
    closing the block comment (syntax errors when the module is imported).
  - `icon-loader.ts` alias-resolution loop triggered TS7022 (circular-init false positive) — fixed
    with explicit type annotations.
  - `index.ts` `export { ICON_TOTAL_COUNT };` could not resolve a name that only arrives via
    `export *` — changed to `export { ICON_TOTAL_COUNT } from "./icon-collections"`.
- Data: 5 collections, 26,620 primary icons: lucide 2109 (ISC) · mdi 7638 (Apache-2.0) ·
  tabler 6305 (MIT) · ph 9161 (MIT) · fa6-solid 1407 (CC-BY-4.0, attribution shown).

## Changes
- `packages/shared/src/components/ui/category-icon.tsx`: resolution order is now image URL →
  Iconify `prefix:name` (lazy `LibraryIcon`) → curated Lucide fast-path (preserves legacy
  kebab/Pascal/"Icon"-suffix including e.g. `tools`→Wrench) → full local Lucide → fallback.
- `apps/velcenter/src/components/IconifyIconPicker.tsx` (new): collection chips + cross-collection
  search (`searchIcons`, paginated 48/page), real SVG previews (bodies batch-loaded per page),
  namespaced ids, license footer, offline.
- `apps/velcenter/src/components/CategoriesManagement.tsx`: picker swapped, slug URL-preview/copy/
  refresh removed (auto-generation kept), product-count badge removed from rows, category-name
  click opens a right Sheet details panel (breadcrumb, published-product count, status/dates/sort,
  children navigation, quick actions reusing existing dialogs).
- i18n th/en/my: removed `formSlugReset/formSlugPreview/formSlugCopy/iconModeLucide`, added
  `details*` + `iconPicker*` (+`iconModePicker`). Parity 2206 × 3.

## Lid concern / checks
- `git diff --check` clean; velcenter/velshop/velseller/velnox typecheck pass; all 4 `vite build`
  pass (icon body + name assets are separate lazy chunks — none in the initial bundle);
  `bun packages/shared/scripts/i18n-check.ts` OK.
- `bun test backend/tests`: 1345 pass / 418 skip / **7 fail — all PRE-EXISTING at HEAD**,
  verified: source-assertion tests expecting `...payload`/`createCategory(payload)`/multi-line
  toggle that don't match committed source; ShopHome `HomePromoStrip` removed earlier; missing
  `.ai/secrets/browser-cookies.json` (cookie-store 0600); velseller nav/orders source assertions.
  The change touched none of those files and adds no new failure.

## Known limitations
- Large lazy chunks for body data (mdi ~2.9 MB / ph ~4.5 MB raw; gzip ~729/957 KB) load on
  demand when a collection is selected — the designed tradeoff for full offline libraries.
- Live authenticated browser E2E still BLOCKED (no local DB/R2; expired saved cookies).

## Backward compatibility
- Existing stored icons: R2 URLs, uploaded SVG/raster, legacy Lucide names, PascalCase/"Icon"
  suffixes all keep working; invalid values fall back to `Package`. CategoryIcon API unchanged.

See `.ai/reports/LATEST.md` for the full task report.
