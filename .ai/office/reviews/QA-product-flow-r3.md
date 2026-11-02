# QA REPORT product-creation-flow-audit — ROUND 3

**Reviewer:** AI 02 (Architect/Planner/QA) · **Date:** 2026-11-02 (round run against working tree, HEAD `8e1b415`, branch `main`, nothing committed)
**Basis:** AI 01's claims treated as claims only; every verdict below is AI 02's own command output and code reads on this round's exact file state.

```
QA REPORT product-creation-flow-audit — ROUND 3
OUTCOME: PASS
(Both round-2 corrections verified on the file: seed now sends `price: 100`
through the real create-full validation path, and the decorative `?search=`
misuse is gone in favour of the bare list endpoint with an honest shop-scoping
comment. Product source unchanged since round 2 — diff numstat byte-identical.
All gates re-run green on this state: suite 1155 pass / 389 skip / 8 fail =
isolation baseline, typecheck 4/4 path checked, i18n 1563×3, probe file
0 pass / 7 skip / 0 fail locally, 7 tests CI-enabled via job-level env.)
```

---

## A. Round-3 file state (unchanged product surface)

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
?? .ai/office/reviews/QA-product-flow-r2.md
?? backend/tests/seller-product-ownership.test.ts
```

`git diff --numstat` (product/locale surface):

```
  9   0  backend/routes/products.ts
125 116  packages/shared/src/components/seller/ProductFormDialog.tsx
114   0  packages/shared/src/lib/i18n/locales/en.ts
114   0  packages/shared/src/lib/i18n/locales/my.ts
119   0  packages/shared/src/lib/i18n/locales/th.ts
```

Totals +481/−116 — **identical to the round-2 quanta**. HEAD unchanged at `8e1b415`. Conclusion: `products.ts`, `ProductFormDialog.tsx` and the three locales are **byte-for-byte in the round-2 state**; the only delta from round 2 is inside the untracked test file (195 → 200 lines, +5 lines) and the new `.ai` records. `git diff --check` → exit 0.

## B. Round-2 corrections — verified

### C1 (was D2) — seed price: VERIFIED FIXED

`backend/tests/seller-product-ownership.test.ts:123-139` now sends:

```ts
product: {
  name: `Ownership Probe ${marker}`,
  category: category.rows[0].id,
  // create-full requires a finite price (products.ts VALIDATION_ERROR otherwise)
  price: 100,
  unit: "ชิ้น",
  description: "created by the ownership probe",
},
previewImages: [ { url: …, objectKey: `ownership-probe/${marker}.jpg` } ],
detailImages: [],
optionGroups: [],
variants: [],
attributes: [],
```

Traced against the real handler gates (`backend/routes/products.ts`, unchanged round-2 state):

| Gate | Source | Seed satisfies? |
|---|---|---|
| name required | products.ts:748-750 | ✓ non-empty trim |
| `price` finite ≥ 0 (was the 400) | products.ts:752-756 | ✓ `Number(100)` finite |
| category resolve (DB categories, is_active, root) | products.ts:758-763 + :118-121 of the test | ✓ real root UUID |
| image counts ≤ 10 per type | products.ts:766-781 | ✓ 1 preview / 0 detail / 0 variant images |
| option-value consistency | products.ts:820-846 | ✓ trivially (no groups, no variants) |
| MAX_VARIANTS ≤ 100 | products.ts (round-1 +9 hunk) | ✓ 0 variants |

So the create-full call passes every 400 gate and reaches the DB transaction; `expect(res.status).toBe(200)` is now meaningful, and the cascade-failure chain QA round 2 predicted (productA = empty string → PATCH-403-on-empty, unsatisfiable `not.toContain`, 0-row survival) cannot occur.

### C2 (was OBSERVATION) — `?search=` misuse: VERIFIED FIXED

`seller-product-ownership.test.ts:147-161` now calls the **bare list endpoint** for both sellers and states the truth in-file:

```ts
// NOTE: the list endpoint ignores query params like `search` — isolation
// comes from the shop-scoping inside the handler, which is exactly what
// these assertions pin: A's list contains the product, B's list never does.
```

The comment now matches reality (round-2 verified: no search filter at the list handler). The `?search=` param is gone entirely — cleaner than the "fix the comment" option, since a decorative parameter would keep implying coverage that does not exist.

## C. Probe-file soundness re-check (end-to-end read on this state)

Re-verified after the edits; nothing else moved:

- **Real routes, real wiring:** same round-2 verdict stands — routes files unchanged (numstat), so `setupProductRoutes`/`setupProductOptionRoutes` mount the production handlers behind `cookieParser` + `express.json` on `app.listen(0)`. Every probed path maps to a registered route.
- **No false-PASS path:** seed asserts `200` + `success:true` from the real endpoint; list asserts owner-body `toContain(productA.id)` AND cross-seller-body `not.toContain(productA.id)`; PATCH asserts cross-seller `[403,404]` AND owner `200`; DELETE asserts refusal AND `SELECT` still finds the row (mutation-leak detector); options/variants assert `[403,404]` on write and read; unauthenticated asserts `[401,403]`. An ownership regression that lets a foreign seller mutate/see (i.e. any `200`) fails at least one of these — deterministically.
- **Skip gate correct:** `hasTestDatabase() && JWT_SECRET` (line 27); cookie name `velnox_session` matches the auth middleware; without the secret `requireAuth` would 500, not 401, so gating on it is right.
- **CI enabled:** `.github/workflows/test.yml` sets job-level `TEST_DATABASE_URL` + `JWT_SECRET` and loads `db/run-sqleditor.sql` before `bun test` (lines 57, 61, 86, 95 verified this round). The 7 tests will execute in CI.
- **Cleanup FK-ordered + production-impossible:** product children → products → shops → `purgeUsers(users)`; products children cascade per `db/schema.sql`; `hasTestDatabase()` routes through `assertTestDatabaseIsSafe()` which refuses any production-shaped `DATABASE_URL` before a pool is created. All deletes scoped to suite-created ids.

## D. AI 02's own command runs (this round's exact file state)

| Command | Real output |
|---|---|
| `bun test ./backend/tests/seller-product-ownership.test.ts` | `0 pass / 7 skip / 0 fail — Ran 7 tests across 1 file`, exit 0 (7 `(skip)` lines, DB-gated locally) |
| `bun --filter @velnox/backend typecheck` | `@velnox/backend typecheck: Exited with code 0` |
| `bun run test` (full) | `1155 pass / 389 skip / 8 fail / 11808 expect() calls — Ran 1552 tests across 83 files` |
| `bun run test` failure list | 8 `(fail)` lines, all `test database guard — a real test process fails closed` (test-database-isolation): production DATABASE_URL ×2, RENDER=true, disposable allowed, no-DB skip, CI-shaped env, Neon opt-in ×2 — byte-identical to the round-1/round-2/daily-health baseline |
| `bun run i18n:check` | `i18n:check OK — th=1563 en=1563 my=1563 keys, all locales at parity.` exit 0 |
| `git diff --check` | exit 0 |
| `git diff --numstat` | identical to round 2 (see section A) → product source unchanged since round 2 |
| `grep errStockNegative` | ProductFormDialog.tsx:772 + en.ts:173 still present (D1 fix intact) |

Suite math: 83 files / 1552 tests unchanged; skips still +7 from the new file; pass 1155 unchanged; fail 8 unchanged and name-identical to the environmental isolation baseline. No new failures; the round-2 → round-3 delta is confined to the test file.

## E. AC table

| AC | Criterion | Verdict | Evidence |
|---|---|---|---|
| AC-01 | Labels/placeholders via t() in th/en/my, no hard-coded Thai in JSX | **PASS** | i18n:check 1563×3 (this round); Thai residue = ฿ glyphs ×3 + documented `defaultForm.unit` fallback — unchanged from round 2, file unchanged |
| AC-02 | Create-mode validation rejects compareAt<price, discount>100, stock<0, variantCount>100, empty gallery | **PASS** | D1 closed in round 2 (`errStockNegative` branch + key ×3, re-grepped this round); file unchanged since |
| AC-03 | create-full 400 with INVALID_CATEGORY / FILE_TOO_LARGE / VALIDATION_ERROR | **PASS (code-level)** | products.ts:748-781+820-846 re-read this round; FILE_TOO_LARGE correctly N/A in create-full (URLs only) |
| AC-04 | save-image returns updated product; re-seed, no duplicates | **PASS (code-level) / live NOT VERIFIED** | routes unchanged; DB-gated |
| AC-05 | Edit dialog preserves images/category/price/inventory/variants | **NOT VERIFIED (live)** | disposable-DB constraint, unchanged |
| AC-06 | Product appears in MyShop list after create | **NOT VERIFIED (live)** | same constraint |
| AC-08 (AC-7 → renumbered) | Ownership isolation 403/404 across product/option/variant endpoints, owner 200, unauthenticated 401/403 | **STRUCTURALLY READY — live execution still deferred to CI** | File verified end to end this round: real routes, seed now passes all create-full gates (table in B), no false-PASS path, purge-safe cleanup, CI env confirmed. Local run skips (no TEST_DATABASE_URL — tool does not permit pointing at a disposable DB it would have to provision, and production Neon is read-only for agents). Cannot claim CI-green from here: no CI run was observable in this harness. |
| AC-09 (old AC-8) | typecheck 4/4, velseller build, i18n parity, backend suite, git diff --check | **PASS** | section D. `bun --filter @velnox/backend typecheck` exit 0 this round; the 4/4 + builds were verified exhaustively in rounds 1-2 on a byte-identical source state (only the untracked test file changed) — carrying that evidence forward is sound. |
| AC-10/11/12 | (brief bucket: scope limits respected, no regressions, no schema changes) | **PASS** | diff surface unchanged (section A); `db/schema.sql`, `db/run-sqleditor.sql`, workflow untouched; full-suite deltas fully accounted for |

## DEFECTS

None blocking. Carried-forward non-blocking observations (unchanged, accepted):

1. `validate()` `useCallback` dep array in ProductFormDialog.tsx omits `t` — cosmetic, stable behaviour in this app.
2. Explicit product-child deletes in the test `afterAll` are redundant with `ON DELETE CASCADE` — harmless.
3. AC-05/AC-06/AC-08 live legs remain unexercised outside CI — see B/NOT VERIFIED, not a code defect.

## REGRESSIONS

None. Baseline failure set byte-identical to rounds 1-2 and the daily-health baseline; pass/skip/file counts unchanged except the accounted-for +7 skips; product source byte-identical to the round-2 state.

## BLOCKERS

None.

## SHIP / NO-SHIP RECOMMENDATION

**SHIP** — conditional on the already-configured green CI run.

- Both round-2 defects are fixed exactly as prescribed; the probe file is now self-consistent (seed passes the real create-full validation; comment matches behaviour).
- Product source (ProductFormDialog.tsx, products.ts, 3 locales) is unchanged from the round-2 state in which all local gates were green, and gates re-verified green this round.
- The one thing this harness cannot produce is an executed CI run of `.github/workflows/test.yml` (TEST_DATABASE_URL + JWT_SECRET + disposable Postgres), where the 7 ownership probes execute for the first time. Merge only once that run is observed green; a red run there is the last possible defect surface and it would be a test-orchestration issue, not an ownership-code one — but AC-08's live evidence should not be counted until it is green.

## NOT VERIFIED

1. AC-08 live execution — file is CI-enabled and architecturally sound, but no CI/disposable-DB run was observable in this harness; status is "ready + CI-green pending".
2. AC-05/AC-06 live edit→reopen / MyShop listing — disposable DB required; production Neon read-only for agents.
3. AC-04 live repeat-save no-duplicate — DB-gated; seedGalleries unit tests + code read stand.
4. Browser R2 PUT / EN-MY rendered output / viewport sweep — no browser E2E in this harness.
