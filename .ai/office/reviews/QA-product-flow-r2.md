# QA REPORT product-creation-flow-audit — ROUND 2

**Reviewer:** AI 02 (Architect/Planner/QA) · **Date:** 2026-11-02 (round run against working tree, HEAD `8e1b415`, branch `main`, nothing committed)
**Outcome basis:** all evidence is AI 02's own command output and code reads on this round's exact file state. AI 01's round-2 claims were treated as claims only and re-derived independently.

```
QA REPORT product-creation-flow-audit — ROUND 2
OUTCOME: FAIL
(D1 verified FIXED. D2's new test file is architecturally right but its seed
payload omits the required `product.price`, so the create-full handler returns
400 and the file will FAIL in CI even against correct ownership code. One-line
fix required in the test file; product source code itself is sound and
unchanged since round 1 except the accepted D1 fix.)
```

---

## A. Round-2 file state

`git status --short -uall`:

```
 M backend/routes/products.ts
 M packages/shared/src/components/seller/ProductFormDialog.tsx
 M packages/shared/src/lib/i18n/locales/en.ts
 M packages/shared/src/lib/i18n/locales/my.ts
 M packages/shared/src/lib/i18n/locales/th.ts
?? .ai/office/handoffs/brief-product-flow.md
?? .ai/office/handoffs/impl-product-flow-r1.md
?? .ai/office/reviews/QA-product-flow-r1.md
?? backend/tests/seller-product-ownership.test.ts
```

`git diff --stat`: 5 files, +481/−116 (round 1 was +472/−116; delta = D1 fix + 1 locale key ×3). New file `backend/tests/seller-product-ownership.test.ts` (195 lines, untracked). Nothing outside the expected surface changed; `db/schema.sql`, `db/run-sqleditor.sql`, `backend/db/test-database.ts` untouched.

## B. D1 — negative stock: VERIFIED FIXED

1. New key in all three locales:

```
en.ts:173:   errStockNegative: "Variant \"{name}\" stock cannot be negative",
my.ts:179:   errStockNegative: "Variant \"{name}\" စတော့ကို အနုတ် မဖြည့်ရ",
th.ts:192:   errStockNegative: "Variant \"{name}\" สต็อกไม่สามารถติดลบได้",
```

2. `validate()` branch exists (ProductFormDialog.tsx:768-773, inside the create-mode variant loop):

```ts
// AC-02: an explicitly negative stock is a validation error, not a
// silent clamp (the create-full clamp stays as defense in depth).
const stockNum = Number(v.stock);
if (v.stock !== "" && (!Number.isFinite(stockNum) || stockNum < 0)) {
  errors.push(t("productForm.errStockNegative", { name: v.name }));
}
```

Rejects `< 0` and non-numeric non-empty input; empty string still allowed (falls through to the pre-existing `hasStock` all-zero check at :775-776). Submit is blocked before any payload is built, so the clamps become unreachable for the reject case. ✓

3. Server clamps UNCHANGED: `backend/routes/products.ts:981` still `variant.stock != null ? Math.max(0, Number(variant.stock)) : 0`; `:842` product-level clamp unchanged. `git diff backend/routes/products.ts` is still exactly the single +9 `MAX_VARIANTS` hunk — the D1 fix touched nothing server-side. ✓

D1 closed.

## C. D2 — new ownership probe file: architecture VERIFIED GOOD, seed DEFECTIVE

### C.1 What is right (verified by reading `backend/tests/seller-product-ownership.test.ts` end to end against the real routes)

- **Real routes, real wiring:** `setupProductRoutes(app)` + `setupProductOptionRoutes(app)` on a throwaway express app (`app.listen(0)`), behind `cookieParser` + `express.json` — the exact middleware shape production uses. Every probed path resolves to a really registered route:
  - `POST /api/seller/products/create-full` → products.ts:722
  - `GET /api/seller/products` → products.ts:551 (shop-scoped `WHERE p.shop_id = $1`)
  - `PATCH`/`DELETE /api/seller/products/:productId` → products.ts:1085 / 1212, both guarded by `verifyProductOwnership` → 403 FORBIDDEN on miss (products.ts:1095-1096 and the DELETE twin)
  - `POST /api/seller/products/:productId/option-groups` → product-options.ts:271; `GET …/options` → :205
  - `GET …/variants` → product-options.ts:862; `POST …/variants/generate` → :603
- **Owner/cross-seller distinction is real, not theater:** the seed test asserts the create-full call itself returns 200 for A; the list test asserts A's body contains the product id and B's body does not; PATCH asserts cross-seller `[403,404]` **and owner 200**; DELETE asserts cross-seller refusal **and the row survives** (`SELECT id FROM products` still returns 1). On a regression where a cross-seller mutation succeeds (200), `expect([403,404]).toContain(theirs.status)` and `expect(theirsBody).not.toContain(productA.id)` both fail. Genuine guard in a CI run.
- **Unauthenticated leg:** `velnox_session` cookie name matches `backend/middleware/auth.ts:73`; no cookie → 401/403 asserted on list + write. JWT_SECRET is part of the skip gate (`hasTestDatabase() && JWT_SECRET`), correct — without it `requireAuth` would 500, not 401.
- **Seeding uses the real schema and the proven fixture shape:** users/sellers/shops inserts are byte-equivalent to `seller-access-authorization.test.ts:207/222/229` (same columns, same `'แฟชั่น'` category string, unique slugs via marker). Category is read from the real `categories` table (`is_active = true AND parent_id IS NULL`); `resolveCategory` accepts the UUID and stores the canonical slug. ✓
- **Cleanup cannot leak and cannot touch production:** `hasTestDatabase()` routes through `decideTestDatabase()`/`assertTestDatabaseIsSafe()` (backend/tests/helpers/test-db.ts:38-46), which fail closed on any production-shaped `DATABASE_URL` — the same guard that refuses the production Neon string. `afterAll` deletes product children → products → shops → `purgeUsers(users)` in an order consistent with the FK graph (all product children — inventory, product_images, product_variants, product_option_groups/values, product_attributes — are `ON DELETE CASCADE` from products in db/schema.sql, so the explicit child deletes are redundant but harmless; shops-before-users and children-before-products ordering is correct). All deletes are scoped to ids the suite itself created; emails/slugs are marker+UUID-scoped. No row can outlive the run, and the disposable-DB gate makes a production write structurally impossible. ✓
- **CI is configured to run it:** `.github/workflows/test.yml` sets job-level `TEST_DATABASE_URL` (disposable postgres:16 service), `JWT_SECRET`, and loads `db/run-sqleditor.sql` before `bun test`. So the file is NOT skip-forever — it executes in CI.

### C.2 The defect (blocks PASS)

**Seed payload omits `product.price` — create-full returns 400, so the seed test fails in CI even against perfect ownership code.**

The create-full handler requires a finite, non-negative price **before** anything else after the name check:

```ts
// backend/routes/products.ts:751-755
const priceNum = Number(productData.price);
if (!Number.isFinite(priceNum) || priceNum < 0) {
  res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Valid price is required" } });
  return;
}
```

The test's payload (seller-product-ownership.test.ts:123-137) sends `product: { name, category, unit, description }` — **no `price`**. `Number(undefined) === NaN` → the route rejects with 400 before reaching the DB. Consequences in a CI run (where the gate is open):

- Test 1 (seed) fails: `expect(res.status).toBe(200)` against 400.
- `productA` stays `{ id: "", slug: "" }` and dependent tests cascade-fail (e.g. owner-PATCH-200 gets 403 on the empty id; `not.toContain("")` is unsatisfiable; the product-survival query returns 0 rows against `expect(1)`).
- Net: CI goes red on correct code. The file as written cannot provide the AC-08 evidence it was created for, and a red CI blocks the pipeline.

Locally this is invisible: TEST_DATABASE_URL unset → 7 skips → "0 fail / 7 skip", which is exactly what AI 01 reported and exactly why the claim "runs in CI" was never actually exercised by AI 01. The claim is true (CI runs the file) but the file fails when it runs.

Severity: **high for the test artefact, contained** — zero production-code impact; product ownership behavior remains as code-verified as round 1. Fix is one line: add `price: 100` (or similar) to the seed `product` object; then the seed 200 assertion becomes meaningful and the guard operates as designed.

### C.3 Minor observations (no action required this round)

- `GET /api/seller/products` **ignores** the `?search=` query param (products.ts:566-575 has no search filter). The test's `?search=${productA.slug}` is therefore decorative; the assertion still works because the list is shop-scoped by `p.shop_id = $1`, so B's list cannot contain A's product regardless. The in-file comment "even in a search" overstates what is being exercised. Harmless.
- Round-1 cosmetic observation unchanged: `validate()`'s `useCallback` dep array (ProductFormDialog.tsx:779) still omits `t`. Not blocking.

## D. AI 02's own command runs (this round's exact file state)

| Command | Real output |
|---|---|
| `bun run i18n:check` | `i18n:check OK — th=1563 en=1563 my=1563 keys, all locales at parity.` exit 0 |
| `bun run typecheck` | velshop / velseller / velcenter / velnox all `Exited with code 0` (4/4) |
| `bun --filter @velnox/backend typecheck` | `Exited with code 0` |
| `bun test ./backend/tests/seller-product-ownership.test.ts` | `0 pass / 7 skip / 0 fail` — `Ran 7 tests across 1 file` (all 7 lines `(skip)`, DB-gated locally) |
| `bun run test` (full) | `1155 pass / 389 skip / 8 fail / 11808 expect() calls — Ran 1552 tests across 83 files` |
| failure list from `bun run test` | 8 unique `(fail)` lines, **all** in `test database guard — a real test process fails closed` (test-database-isolation), names identical to the round-1/daily-health-report baseline: production DATABASE_URL refusal ×2 variants, RENDER=true, disposable allowed, no-DB skip, CI-shaped env, Neon branch opt-in ×2 |
| `bun --filter @velnox/velseller build` | `✓ built in 10.68s — Exited with code 0` |
| `bun --filter @velnox/velshop build` | `✓ built in 7.81s — Exited with code 0` |
| `git diff --check` | clean, exit 0 |
| locale diff removed lines | `git diff packages/shared/src/lib/i18n/locales/ \| grep -c '^-[^-]'` → `0` (purely additive; th +119, en +114, my +114 = round-1 counts +1 `errStockNegative` each) |
| Thai residue grep on ProductFormDialog.tsx | 4 hits: `฿` glyphs at :364, :365, :1146 + documented `defaultForm.unit: "ชิ้น"` at :411 (overridden by `t("productForm.defaultUnit")` at runtime) — identical to round 1 |

Suite math checks: 82→83 files (new test file), 1545→1552 tests (+7 skips), 382→389 skips (+7), pass 1155 unchanged, fail 8 unchanged and byte-identical in name to baseline. No new failures; the only delta is the skipped new file.

## E. AC table (updated)

| AC | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Labels/placeholders via t() in th/en/my, no hard-coded Thai in JSX | **PASS** | i18n:check 1563×3 parity; Thai residue = ฿×3 + documented data-shape fallback only (section D) |
| 2 | Create-mode validation rejects compareAt<price (structurally impossible), discount>100, stock<0, variantCount>100, empty gallery | **PASS — D1 closed** | `errStockNegative` branch (ProductFormDialog.tsx:768-773) + key in 3 locales; server clamps unchanged as defense in depth (products.ts:981, :842) |
| 3 | create-full 400 with INVALID_CATEGORY / FILE_TOO_LARGE / VALIDATION_ERROR | **PASS (code-level)** | unchanged from round 1; products.ts:760/:753-755/:826; FILE_TOO_LARGE correctly N/A in create-full (URLs only, never bytes) |
| 4 | save-image returns updated product; re-seed, no duplicates | **PASS (code-level) / live NOT VERIFIED** | unchanged; DB-gated |
| 5 | Edit dialog preserves images/category/price/inventory/variants | **NOT VERIFIED (live)** | unchanged; disposable-DB constraint |
| 6 | Product appears in MyShop list after create | **NOT VERIFIED (live)** | unchanged |
| 7 → now AC-08 | Ownership isolation 403/404 across product/images/options/variant endpoints | **NOT VERIFIED — file present but currently CI-broken** | Probe file exists, mounts the real routes and would fail on an ownership regression; but the seed omits `product.price` → 400 → CI failure cascade (section C.2). It cannot be RUN locally (7 skips) and cannot be credited as CI-verified while it red-fails CI. Status stays NOT VERIFIED until the seed is fixed and a CI run (or a local run with TEST_DATABASE_URL) goes green. |
| 8 | typecheck 4/4, velseller build, i18n parity, backend suite, git diff --check | **PASS** | section D — all real exit codes on this round's state |

## F. Round-1 criteria re-check (nothing regressed)

- Locale diffs still purely additive (0 removed lines), key counts moved 1562→1563 per locale by exactly the D1 key. ✓
- Thai residue rules still hold (same 4 documented hits). ✓
- `products.ts` diff still the single +9 `MAX_VARIANTS` hunk before `BEGIN`. ✓
- Both ProductFormDialog consumers rebuilt clean (recommended in round 1 after the second edit to the file — done, section D). ✓
- Full-suite deltas fully accounted for by the new skipped file. ✓
- Round-1 accepted deviations (step-5 header omission; step-6/7 scope) — step-7/6 are now superseded by the new probe file; header omission stands as accepted.

## DEFECTS

```
D2 (high, test artefact only) — backend/tests/seller-product-ownership.test.ts:123-137
   Expected: seed product passes the real create-full validation so the probe
             actually runs in CI (workflow supplies TEST_DATABASE_URL + JWT_SECRET,
             loads db/run-sqleditor.sql)
   Actual:   payload omits `product.price` → products.ts:751-755 rejects with
             400 VALIDATION_ERROR → seed test fails and dependent tests cascade-fail
             (owner-PATCH-200, product-survival, list containment)
   Evidence: products.ts:746-755 read on this state; test file read end to end;
             locally 0 pass/7 skip/0 fail so the failure is invisible without a DB
   Severity: high for CI (pipeline goes red on correct code; the file cannot
             serve as the AC-08 guard it was written to be) — but zero impact on
             production code. Fix: add `price: 100` (any finite ≥ 0) to the seed
             product object.
OBSERVATION (info) — seller-product-ownership.test.ts:146/152: the `?search=`
   parameter is ignored by GET /api/seller/products (no search filter at
   products.ts:566-575); the shop-scoping assertion is still valid, but the
   "even in a search" comment overstates the probe. Fix the comment or drop the
   param on the next touch.
```

## REGRESSIONS

None. All round-1 PASS evidence reproduced on this state (section F); full-suite failure set byte-identical to baseline; no production-code change beyond the round-1 +9 guard and the accepted D1 frontend fix.

## BLOCKERS

None.

## SHIP / NO-SHIP RECOMMENDATION

**NO-SHIP as-is — one-line fix away.**

- Product source (ProductFormDialog.tsx, products.ts, 3 locales) is ship-quality: D1 properly closed, no regressions, all builds/typechecks/i18n green on this exact state.
- The new probe file is architecturally correct (real routes, real owner/cross-seller discrimination, safe cleanup, production-impossible) but will fail CI due to the missing seed `price`. Merge after adding `price` to the seed product and re-land with a green CI run of `.github/workflows/test.yml` (or a local run with `TEST_DATABASE_URL` set against a disposable Postgres).
- Optionally fix the `?search=` comment in the same commit.

## NOT VERIFIED (unchanged harness limits)

1. AC-5 live edit→reopen matrix — disposable DB required; production Neon read-only for agents.
2. AC-6 live MyShop listing after create — same constraint.
3. AC-08 live 403/404 ownership probes — file exists and CI runs it, but as written it fails in CI (D2 above); cannot be credited until seed fixed and run green. Locally unrunnable (skips).
4. AC-4 live repeat-save no-duplicate — DB-gated; seedGalleries unit tests + code read stand.
5. Browser R2 PUT / EN-MY rendered output / viewport sweep — no browser E2E in this harness; i18n probe verifies key resolution, not pixels.
