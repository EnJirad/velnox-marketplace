# QA REPORT product-creation-flow-audit — ROUND 1

**Reviewer:** AI 02 (Architect/Planner/QA) · **Date:** 2026-11-02 (round run against working tree, HEAD `8e1b415`, branch `main`, nothing committed)
**Outcome basis:** all evidence below is AI 02's own command output on this round's exact file state. AI 01's claims were treated as claims only.

```
QA REPORT product-creation-flow-audit — ROUND 1
OUTCOME: PASS (with 2 accepted deviations recorded in section H and 1 low-severity
observation; 5 criteria NOT VERIFIED — DB/browser-gated, listed in section NOT VERIFIED)
```

---

## A. Diff and scope

`git status --short -uall`:

```
 M backend/routes/products.ts
 M packages/shared/src/components/seller/ProductFormDialog.tsx
 M packages/shared/src/lib/i18n/locales/en.ts
 M packages/shared/src/lib/i18n/locales/my.ts
 M packages/shared/src/lib/i18n/locales/th.ts
?? .ai/office/handoffs/brief-product-flow.md
?? .ai/office/handoffs/impl-product-flow-r1.md
```

`git diff --stat`: 5 files, +472/−116. Matches AI 01's reported diff size exactly.

Per-hunk justification:

| File | Diff content | Justified by brief? |
|---|---|---|
| ProductFormDialog.tsx (+235/−116) | Every hunk replaces a hard-coded Thai string with `t("productForm…")` / `t("common.cancel")` or localizes the create-mode unit default. No logic, styling or flow change. | Yes — step 1 |
| th.ts +118 / en.ts +113 / my.ts +113 | Purely additive `productForm` namespace. Verified: `git diff` contains **0 removed lines** in all three locale files (`grep -c '^-[^-]'` on each diff = 0) — no existing key was changed. | Yes — step 1 |
| products.ts +9/−0 | Single hunk: MAX_VARIANTS guard. No other change. | Yes — step 4 |

Excluded files — confirmed untouched: `db/schema.sql`, `db/run-sqleditor.sql` (not in status), `locales/index.ts` (untouched — patch objects unmodified), `CategoryPicker` / `ImageUploader` (not in status), no new or modified test files (`backend/tests/` clean), no API-contract change beyond the additive 400 guard. ✓

## B. i18n

- `bun run i18n:check` → `i18n:check OK — th=1562 en=1562 my=1562 keys, all locales at parity.` exit 0.
- AI 02's independent probe (script in `.harness-scratch/probe2.ts`, resolving every `t("…")` call in ProductFormDialog.tsx against the **merged** runtime dictionaries from `locales/index.ts` — the same merged dicts the official checker uses, since `my` is completed by `myAuthPatch`/`myShopPatch`):

```
used=108 missing=0
sizes: 1562/1562/1562 sameSet: true
productForm keys: 108 var issues: 0
```

- All 108 used keys resolve in th, en AND my; merged key sets identical (1562×3, `sameSet: true`); interpolation variables consistent across all three locales for the whole `productForm` namespace (0 mismatches).
- Call-site interpolation spot-check: every key requiring vars (`{count}` ×4, `{name}` ×3, `{message}`, `{shop}`, `{summary,count}`) is invoked with exactly those vars in the diff. ✓
- Note for the record: my first probe run against the raw `locales/my.ts` file (not the merged dict) showed 250 `th/my-only` keys — those are all **pre-existing** gaps filled by `locales/index.ts` patches (footer, cookies, home, productDetail namespaces). Not touched this round; not a regression.
- Locale diffs purely additive: verified above (0 removed lines). No existing key changed. ✓

## C. UI-copy residue

`grep -n '[ก-๛]' packages/shared/src/components/seller/ProductFormDialog.tsx` → exactly 4 hits:

| Line | Content | Allowed? |
|---|---|---|
| 364, 365, 1140 | `฿` currency glyphs | Yes — currency symbol, not copy |
| 411 | `unit: "ชิ้น"` in module-level `defaultForm` | Yes — data-shape fallback; **overridden** at line 441: `: { ...defaultForm, unit: t("productForm.defaultUnit") }` |

- Create-mode unit default IS localized: line 441 (useState initializer) and lines 795/855 (`form.unit.trim() || t("productForm.defaultUnit")` in both submit paths). ✓
- Backend unit fallbacks NOT localized (correct — server has no locale): `backend/routes/products.ts:195, 677, 863` still `|| "ชิ้น"`, untouched by the diff. ✓

## D. Backend guard

`backend/routes/products.ts:822-830` (create-full route):

```ts
const MAX_VARIANTS = 100;
if (Array.isArray(variantsData) && variantsData.length > MAX_VARIANTS) {
  res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: `Maximum ${MAX_VARIANTS} variants allowed per product` } });
  return;
}
```

- Sits **before** slug generation and `await client.query("BEGIN")` (line 846) — no database write can occur when rejected. ✓
- Returns 400 with `VALIDATION_ERROR`, matching the route's existing code vocabulary. ✓
- `variantsData` is the destructured body field (line 742) and every access is `Array.isArray`-guarded → single-product create with no variants (or `variantsData: undefined`) skips the guard entirely. Existing no-variant flow cannot break. ✓
- Success path unchanged: diff is +9/−0, no insertion/deletion inside the transaction. ✓
- `bun --filter @velnox/backend typecheck` → `Exited with code 0`. ✓
- Mirrors the generate-endpoint cap (product-options.ts) — no new limit invented. ✓

## E. Tests (AI 02's own runs)

Unit files (7), quoted real output:

| File | Result |
|---|---|
| product-image-state.test.ts | 9 pass / 0 fail |
| product-upload-guards.test.ts | 7 pass / 0 fail |
| category-validation.test.ts | 18 pass / 3 skip / 0 fail |
| product-variant-options.test.ts | 11 pass / 0 fail |
| product-lifecycle.test.ts | 77 pass / 3 skip / 0 fail |
| upload-security.test.ts | 14 pass / 7 skip / 0 fail |
| commerce-core-invariants.test.ts | 0 pass / 23 skip / 0 fail (DB-gated) |

Full suite `bun run test`:

```
 1155 pass
 382 skip
 8 fail
 11807 expect() calls
Ran 1545 tests across 82 files.
```

All 8 failures are in `backend/tests/test-database-isolation.test.ts` → `test database guard — a real test process fails closed`, with the assertion list **identical, item for item, to the baseline in `.ai/automation-reports/daily-health-report.md` §4** (production DATABASE_URL refusal ×2, RENDER=true, disposable-DB allowed, no-DB skip, CI-shaped env, Neon branch opt-in ×2). Pass/skip/fail counts (1155/382/8) match the baseline exactly. **No new failures.** ✓ (Note: baseline counts were also 1155/382/8 at HEAD 1e51ff0; suite total unchanged.)

## F. Builds

```
@velnox/velseller build: ✓ built in 6.68s — Exited with code 0
@velnox/velshop build:   ✓ built in 7.96s — Exited with code 0
```

Both consumers of ProductFormDialog. Plus `bun run typecheck` → all 4 apps exit 0; `git diff --check` → clean, exit 0. ✓

## G. AC-coverage

| AC | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | All labels/placeholders via t() in th/en/my, no hard-coded Thai in JSX | **verified (PASS)** | Section B probe (108/108 keys, 3 locales, 0 missing) + section C grep (only ฿ + documented defaultForm fallback) |
| 2 | Create-mode validation rejects compareAtPrice<price / discount>100 / stock<0 / variantCount>100 / empty gallery | **verified (PASS, 1 deviation)** | variantCount>100 → `errVariantLimit` (validate, ProductFormDialog.tsx:748) + backend 400; empty gallery → `errGalleryRequired` (pre-existing); discount 0–100 → `errVariantDiscount`; "compareAtPrice < price" is structurally impossible in create-full (variant `price` is *derived* as `full×(1−disc)`, disc clamped 0–100 → price ≤ compareAtPrice always). **stock < 0: NOT rejected — silently clamped** (`Math.max(0, Number(v.stock) \|\| 0)` client-side + `Math.max(0, …)` backend, products.ts:980). Deviation D1, low severity — negative stock can never be persisted, but the AC's letter ("rejects") is not met. |
| 3 | create-full 400 with INVALID_CATEGORY / FILE_TOO_LARGE / VALIDATION_ERROR | **verified (PASS, code-level)** | INVALID_CATEGORY (products.ts:754), VALIDATION_ERROR ×many incl. new guard; FILE_TOO_LARGE correctly lives in save-image (products.ts:1674) / upload.ts — create-full receives URLs only, never file bytes, so that code is N/A there by architecture |
| 4 | save-image returns updated product; frontend re-seeds, no duplicate images | **verified (PASS, code-level)** | Re-seed from server response + fresh GET (ProductFormDialog.tsx:825-841); seedGalleries/pendingUploads unit-tested (9 pass). Live repeat-save probe: NOT VERIFIED (DB) |
| 5 | Edit dialog preserves images/category/price/inventory/variants/attributes | **NOT VERIFIED (live)** | Code path verified statically (seedGalleries edit-mode seeding line ~435-441; VariantManager fetches variants); live edit→reopen matrix requires DB — §17 constraint |
| 6 | Product appears in MyShop list with status/counts after create | **NOT VERIFIED (live)** | No mutation against production Neon permitted; DB-gated |
| 7 | Ownership isolation 403/404 on images/options/variants endpoints | **NOT VERIFIED (live)** — **code-level only** | `verifyProductOwnership` (products.ts:116; product-options.ts:45) is invoked on all 9+10 seller product endpoints (grep-verified); but **no test file probes these endpoints' 403/404** — AI 01's claim that existing suites "already cover ownership isolation" is overstated: seller-access-authorization.test.ts covers profile/shop isolation, not the product image/options/variant endpoints. Step-7 probes not added (deviation D2). Behavior itself is code-verified only. |
| 8 | typecheck 4/4, velseller build, i18n parity, backend suite, git diff --check | **verified (PASS)** | Sections B, E, F with real exit codes |

## H. Judgement of AI 01's step-5 / step-7 deviations

**Step 5 (response header exposing image persistence) — ACCEPTED, correct call.**
The brief's step text says "add response header indicating if images were persisted", but the user's binding constraint in this round is **no API-contract changes beyond the additive 400 guard** (task scope). A new response header *is* an API-contract change (additive surface on save-image + every caller's documentation). The evidence the header was meant to provide already exists in the response **body**: save-image returns the full formatted product whose image arrays the frontend re-seeds from (AC-4, verified). Header adds no verifiable fact the body lacks. Skipping it is the right resolution of step-text vs. constraint; the constraint wins.

**Step 7 (DB-gated ownership-probe test file) — ACCEPTED short-term, but AI 01's justification is partly wrong and follow-up is owed.**
AI 01's stated reason ("existing suites already cover ownership isolation") is **not accurate for the product endpoints** — see AC-7 row: no existing test asserts 403/404 on seller product images/options/variants endpoints. The defensible reason is the one the brief itself anticipated (RISKS: TEST_DATABASE_URL unset → probes would skip locally and provide zero local evidence), plus no-new-test-file-in-a-docs-free round being scope-conservative. Net: not a defect against the ACs (AC-7's behavior is code-verified), but coverage is thinner than AI 01 claims. Recommend round 2: add one DB-gated test file (skips locally, runs in CI with TEST_DATABASE_URL) asserting 403/404 across the image/options/variant endpoints.

**Step 6 (integration test for the create→…→reopen matrix) — same disposition as step 7**, folded into the follow-up above.

## DEFECTS / DEVIATIONS

```
D1 (low) — packages/shared/src/components/seller/ProductFormDialog.tsx:884 (create payload) + :768 (validate)
   Expected: AC-2 letter — create-mode submit REJECTED when a variant's stock < 0
   Actual:   negative stock passes validate() silently (as long as one other variant
             has stock > 0) and is clamped to 0 by `Math.max(0, Number(v.stock) || 0)`
             client-side and `Math.max(0, Number(variant.stock))` server-side
             (backend/routes/products.ts:980)
   Evidence: read of validate() lines 747-771 (no stock<0 branch) vs AC-2 text
   Severity: low — no negative stock can ever persist (double clamp + hasStock check
             covers the all-non-positive case), but behavior deviates from the AC's
             letter. Fix: push `errVariantStockInvalid` when Number(v.stock) < 0, or
             amend AC-2 to "clamped, not rejected". QA does not block on this.
D2 (low) — backend/tests/ (absent file)
   Expected: brief step 7 — 403/404 ownership probes for seller product
             images/options/variants endpoints
   Actual:   no such test file; AI 01's "already covered" claim inaccurate for
             these endpoints
   Evidence: grep of backend/tests shows no verifyProductOwnership/403 probe on
             products.ts or product-options.ts endpoints
   Severity: low — behavior code-verified; CI-coverage gap only. Recommended
             round-2 item, not a blocker.
OBSERVATION (info) — ProductFormDialog.tsx:773: validate()'s useCallback dep array
   omits `t`. t is useMemo-stable per language, so impact is limited to stale
   translations if the user switches language mid-dialog before re-validation.
   Cosmetic; note for the next touch of this file.
```

## REGRESSIONS

None found. Locale diffs purely additive; full-suite counts identical to baseline (1155/382/8); the 8 failures are byte-identical to the documented environmental baseline; both app builds and all typechecks pass; backend success paths untouched (+9/−0 in products.ts, single guard hunk).

## BLOCKERS

None.

## NOT VERIFIED (harness limits — not to be filled by AI 01's claims)

1. **AC-5 live edit→reopen matrix** — requires disposable DB (TEST_DATABASE_URL unset; production Neon read-only-for-agents per §17). Code-verified only.
2. **AC-6 live MyShop listing after create** — same DB constraint.
3. **AC-7 live 403/404 ownership probes** — same DB constraint; code-verified only.
4. **AC-4 live repeat-save (no duplicate images)** — same DB constraint; covered by seedGalleries unit tests + code read.
5. **R2 PUT from the browser / EN-MY visual rendering / viewport sweep** — no browser E2E in this harness; the i18n probe verifies key resolution, not rendered pixels.
```
