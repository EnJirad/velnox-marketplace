# Product Creation Flow — E2E audit & hardening

## Task ID
`product-creation-flow`

## Original user request
Real E2E validation of the Velseller product creation flow: create page → info →
category → variants/options → R2 images → price/inventory → submit → success/
error state → product in backend/DB → edit/reopen preserved → seller list →
auth/ownership/API/storage intact. No redesign, no mocks, no schema changes.

## Task Brief
`.ai/office/handoffs/brief-product-flow.md` — architecture audit (frontend
ProductFormDialog/MyShop; backend products/product-options/upload; DB tables;
R2 pipeline; ownership via `verifyProductOwnership`; validation; existing tests;
known problems; 12 ACs; NOT-VERIFIED list).

## Implementation status
Complete. Report: `.ai/office/handoffs/impl-product-flow-r1.md` (incl. r2
addendum).

## Modified file list
- `packages/shared/src/components/seller/ProductFormDialog.tsx` — full i18n
  migration to new `productForm` namespace (108→109 keys); localized create-mode
  unit default; explicit negative-stock validation (AC-02)
- `packages/shared/src/lib/i18n/locales/{th,en,my}.ts` — additive `productForm`
  namespace (1563×3 parity)
- `backend/routes/products.ts` — MAX_VARIANTS=100 guard on create-full (400
  VALIDATION_ERROR; mirrors the generate-endpoint cap create-full bypassed)
- `backend/tests/seller-product-ownership.test.ts` — NEW DB-gated HTTP
  ownership probes (AC-08; 7 tests, run in CI, skip locally)

## Test results (local, real)
- `i18n:check` exit 0 — th=1563 en=1563 my=1563 parity
- `bun run typecheck` exit 0 (4/4 apps); `@velnox/backend typecheck` exit 0
- ownership test: 0 fail / 7 skip locally (no TEST_DATABASE_URL)
- full suite: 1155 pass / 389 skip / 8 fail — the 8 byte-identical to the
  pre-existing test-database-isolation execPath baseline; zero new failures
- velseller build exit 0; velshop build exit 0; `git diff --check` clean

## QA report
- Round 1: **PASS** — 2 low defects (D1 negative stock silently clamped;
  D2 missing DB-gated ownership probes), 1 observation, 5 NOT-VERIFIED,
  2 accepted deviations (step-5 header declined — API-contract constraint;
  step-7 justification corrected). `reviews/QA-product-flow-r1.md`
- Round 2: **FAIL** — new test's seed payload missing `product.price` → would
  red-fail CI on correct code (invisible locally: all 7 skip).
  `reviews/QA-product-flow-r2.md`
- Round 3: **PASS** — seed price + honest list-scoping comment verified;
  create-full gates traced; no false-PASS path; ship recommended conditional
  on CI green. `reviews/QA-product-flow-r3.md`

## Correction round number
3 of max 5

## Final acceptance status
`ACCEPTED (QA PASS)` — ship, conditional on CI run of the new probes.
