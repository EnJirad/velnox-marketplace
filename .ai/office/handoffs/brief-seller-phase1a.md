# Task Brief — Seller Phase 1 / sub-slice P1-A

> **Phase A authorship note.** The workflow expects AI 02 (subagent) to author this
> brief. Two delegation attempts failed with `context_length_exceeded`
> (`max supported context is 272000 tokens`) before the subagent produced any
> output. Per the harness instruction *"Do the research yourself with read-only
> tools"*, **AI 01 performed Phase A read-only** and authored this brief. Recorded
> as **BLOCKED (AI 02 planning)** in the final report. Phase B QA will likewise be
> attempted and, if blocked again, replaced by AI 01 self-verification with real
> command output — never by a self-issued "PASS".

## TASK BRIEF SELLER-P1A

**REQUEST:** Rebuild the seller Goals/Performance page (`apps/velseller/src/pages/SellerGoals.tsx`)
as a professional, real-data dashboard shell — no emoji, Lucide icons only, ≥44px
touch targets, responsive 360–1440px, full i18n (th/en/my), real loading/empty/error
states, and no hard-coded business numbers.

**AFFECTED FILES**

- `packages/shared/src/lib/i18n/locales/th.ts` — repair (duplicate keys, emoji)
- `packages/shared/src/lib/i18n/locales/en.ts` — repair (duplicate keys, emoji)
- `packages/shared/src/lib/i18n/locales/my.ts` — **restored from `89d7563`** (file at
  HEAD was 143 lines with a syntax error; HEAD typecheck + `i18n:check` were red)
- `packages/shared/src/lib/i18n/locales/index.ts` — new `sellerPerf` namespace +
  `sellerDash.goals` patch for all three languages
- `packages/shared/src/components/goals/GoalCard.tsx` — i18n (currently hard-coded Thai)
- `apps/velseller/src/pages/SellerGoals.tsx` — rewrite
- `new: backend/tests/seller-goals-surface.test.ts` — static contract test

**APPROACH**

1. **P0 repair first.** HEAD `bdbd7ce` is red: `my.ts` truncated to 143 lines
   (`TS1005`), and `th.ts`/`en.ts` carry duplicated object keys plus contradictory
   `{rate}` interpolations in `sellerDash.goals`. Repair before any feature work.
2. Reuse `GoalCard` / `GoalFormDialog` / `ProgressDialog` (grep proves they are
   imported **only** by `SellerGoals.tsx`) and the existing APIs
   `api.goals.*` (`/api/seller/goals*`) and `api.commerce.sellerIncomeReport`
   (`GET /api/seller/income`). No backend, schema, route or auth change.
3. New copy goes into a **new top-level `sellerPerf` namespace** plus a
   `sellerDash.goals` patch, merged in `locales/index.ts` — the sanctioned
   mechanism that avoids editing the 1352–1695-line dictionaries.
4. Goal progress stays on stored `current_value` + `addProgress`.
   **Server-computed progress from order data is deferred to Phase 2** and the UI
   says so factually ("progress is based on the values you record").
5. Error state is real: `useAction` + explicit load (like `Income.tsx`), because
   `useQuery` swallows failures and would render fake zeros.

**STEPS**

1. Restore `my.ts` from `89d7563` (1352 lines).
2. Remove duplicated `sellerDash.goals` blocks and the now-unused
   `kpiRevenue/kpiOrders/kpiCustomers/kpiUnits(+Sub)` keys from `th.ts` and `en.ts`.
3. Remove the 👋 emoji from `greeting` in all three dictionaries.
4. Add `sellerPerf` (6 keys) + `sellerDash.goals` patch (4 keys) to `index.ts` for
   th/en/my and merge them in `translations`.
5. Convert `GoalCard` to `useLanguage()`; replace hard-coded Thai labels.
6. Rewrite `SellerGoals.tsx`: header, 4 real KPI cards from the income report,
   goals summary strip, `GoalCard` grid, dialogs, loading skeleton, empty state,
   error + retry, ≥44px controls, 2/4-column responsive grid.
7. Add static contract test.

**ACCEPTANCE CRITERIA**

1. `bun run i18n:check` exits **0** (th/en/my parity, no interpolation mismatch).
2. `bun --filter @velnox/velseller typecheck` exits **0**.
3. `bun run build:velseller` exits **0**.
4. `grep -c "👋"` in the three dictionaries returns **0**.
5. `SellerGoals.tsx` contains no emoji and no hard-coded currency/count literals;
   every KPI value derives from `api.commerce.sellerIncomeReport` or `api.goals.list`.
6. Every interactive control in the changed page/components carries `h-11`/`min-h-11`.
7. `GoalCard.tsx` imports `useLanguage` and contains no literal Thai label.
8. `bun test ./backend/tests/seller-goals-surface.test.ts` passes.
9. `git diff --check` clean.

**TEST CASES**

```
bun run i18n:check → exit 0
bun --filter @velnox/velseller typecheck → exit 0
bun run build:velseller → exit 0
bun test ./backend/tests/seller-goals-surface.test.ts → pass
grep -rn "👋" packages/shared/src/lib/i18n/locales/{th,en,my}.ts → no match
git diff --check → exit 0
```

**RISKS**

- `my.ts` repair changes a committed file; must verify no key regression
  (`i18n:check` compares merged dictionaries, so patch-only keys are still checked).
- `GoalCard` is shared code: confirmed seller-exclusive by grep; a future consumer
  outside velseller would need the same keys.
- Removing `kpiRevenue*`/`kpiOrders*`/`kpiCustomers*`/`kpiUnits*` deletes keys that
  only the old dashboard used — `SellerGoals.tsx` is rewritten in the same change so
  no reference remains (criterion 5/7 are checked by grep + typecheck).

**SCOPE LIMITS**

- No changes to `apps/velshop`, `apps/velcenter`, `apps/velnox`, `backend/`, `db/`.
- No new dependencies, no schema, no route, no auth changes.
- V-badge removal is **Phase 6**; `MyShop.tsx` keeps its current imports for P1-B.
- My Shop / Orders / Income / Profile redesigns are **P1-B … P1-E**, not this slice.
