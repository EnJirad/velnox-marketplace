# QA REPORT VELSELLER-DASH-01 — ROUND 2

OUTCOME: PASS

Scope of this round: re-verification of the two round-1 defects (D1 verification
link min-height, D2 `aria-pressed` on MyShop chips) plus a full regression pass
over every criterion that passed in round 1, on this round's exact file state.
HEAD unchanged at `1372850`; nothing staged or committed.

CRITERIA CHECKED:

  - D1 (round-1 medium) — verification submit/resubmit link carries
    `inline-flex min-h-11 items-center`
    → PASS — read the source, not just the grep: `sed -n '618,640p'
    apps/velseller/src/pages/MyShop.tsx` shows the `<button>` (the link was
    already a real `<button>` element) at line 626 with
    `className="inline-flex min-h-11 items-center text-[11px] font-medium
    text-[#10B981] underline-offset-2 hover:underline"`; the `text-[11px]`
    styling was kept as AI 01 reported. Only this one attribute changed on that
    element (`type`, `onClick` body, children untouched).

  - D2 (round-1 medium) — MyShop product status chips render `aria-pressed`
    → PASS — source read at `apps/velseller/src/pages/MyShop.tsx:684-699`: the
    chip `<button>` now has `key`, `type="button"`, `aria-pressed={active}`
    (line 691), `onClick={() => setStatusFilter(f.key)}`, className with
    `inline-flex min-h-11`. `grep -n "aria-pressed" MyShop.tsx` → exactly 1
    match (691), mirroring `SellerOrders.tsx:236`'s pre-existing
    `aria-pressed={active}`.

  - AC1 `bun run i18n:check` exit 0, equal key counts, `sellerDash` identical
    key set in th/en/my
    → PASS — real output: `i18n:check OK — th=1454 en=1454 my=1454 keys, all
    locales at parity.` EXIT=0. Independent probe (bun script flattening the
    three dicts from `locales/index.ts`): `sellerDash defined: th=108 en=108
    my=108`, `identical key sets: true`, `sellerDash keys used by pages: 108;
    missing from any locale: 0`. (Round-1 count reconfirmed on this round's
    tree; AI 01's retraction of the "111 keys" claim is accepted.)

  - AC2 `bun --filter @velnox/velseller typecheck` and `bun run typecheck` exit 0
    → PASS — first: `@velnox/velseller typecheck: Exited with code 0`, EXIT=0.
    Second: all four apps (`@velnox/velshop`, `@velnox/velseller`,
    `@velnox/velcenter`, `@velnox/velnox`) `Exited with code 0`, EXIT=0.

  - AC3 `bun --filter @velnox/velseller build` exit 0
    → PASS — `@velnox/velseller build: ✓ built in 6.36s`,
    `@velnox/velseller build: Exited with code 0`, EXIT=0.

  - AC4 Zero raw Thai in Income.tsx and SellerGoals.tsx; MyShop Thai confined to
    excluded regions
    → PASS — `grep -cnE "[ก-๙]"` → Income.tsx: 0 matches (exit 1),
    SellerGoals.tsx: 0 matches (exit 1). MyShop.tsx residue only at lines
    435–487 (onboarding form) and 992–1109 (verification wizard `<Dialog>`
    internals) — exactly the two excluded clusters; nothing new appeared after
    this round's edits.

  - AC5 44px classes on SellerOrders chips + retry chip, MyShop chips + mobile
    delete + verification link
    → PASS — SellerOrders.tsx:237 (chip) and :257 (retry chip) both carry
    `inline-flex min-h-11 items-center`; the SellerOrders diff is still exactly
    2 one-line className additions, nothing else. MyShop.tsx:626 verification
    link (D1), :692 chips (with `min-h-11`), :928 mobile delete button now
    `size-11 shrink-0 ...` (source-read at lines 920–940).

  - AC6 MyShop filter chips render `aria-pressed`
    → PASS — see D2 above (line 691).

  - AC7 `git status` shows only the 7 AFFECTED FILES
    → PASS — `git status --short -uall`: modified = Income.tsx, MyShop.tsx,
    SellerGoals.tsx, SellerOrders.tsx, locales/{th,en,my}.ts; untracked = only
    the three authorized `.ai/office/*` records (brief, impl report, r1 QA
    report). The temporary key-probe script I created during QA was removed;
    `git status` after cleanup shows the same 7+3 set.

  - AC8 No API/auth/routing/dependency changes
    → PASS — `git diff --name-only` lists exactly the 7 files;
    `locales/index.ts`, `package.json`, `bun.lock`, backend absent. All three
    locale diffs are purely additive (`grep -c "^-[^-]"` on each diff →
    0 removed lines in th.ts, en.ts, my.ts); no existing namespace edited,
    no mock data.

Additional checks (regression pass on previously-green criteria):

  - Scope limits: no diff hunks inside AppHeader, MobileTabBar,
    GoalCard/GoalFormDialog/ProgressDialog, ProductFormDialog, EvidenceUploader,
    the MyShop onboarding/approval-gate/wizard-Dialog regions, or the four
    excluded pages. This round's MyShop edits landed only at line 626 (className)
    and line 691 (`aria-pressed`) — both inside already-approved in-scope
    hunks from round 1.
  - Formatting behavior unchanged: per-file call-occurrence counts identical
    HEAD vs working tree for `formatBaht(` / `formatThaiDate(` / `formatNumber(`
    / `formatIsoDate(` / `formatIsoDateTime(` / `toLocaleString("th-TH")` —
    Income 8/0/0/2/0/2, SellerGoals 0/1/1/0/0/0, MyShop 2/0/0/0/0/1,
    SellerOrders 2/0/0/1/1/0. (`pct()` untouched. The round-1 report's slightly
    different per-file figures (e.g. "Income formatBaht 9") included import
    lines; occurrence-vs-occurrence HEAD→now is the regression-relevant
    comparison and is identical everywhere.)
  - `git diff --check` → clean (exit 0); no whitespace-error markers introduced.
  - `sellerDash.t` usage per page: Income 35, SellerGoals 22, MyShop 50,
    SellerOrders 0 (SellerOrders already used `sellerOrders.*` — correct).

REGRESSIONS: none observed. All four verification commands pass on this round's
tree; D1/D2 fixes are minimal single-attribute changes; formatting-helper call
counts, locale diff additivity, file set and excluded-region integrity all
identical to round 1.

BLOCKERS: none.

NOT VERIFIED: nothing material. Two cosmetic observations, not defects, carried
over from round 1: (1) the MyShop evidence-toast hunk at ~line 100 keeps its
cosmetically misaligned indentation (valid TS, typecheck passes); (2) taller
44px chips change the desktop silhouette slightly — intended per the brief.

VERDICT: VELSELLER-DASH-01 satisfies all eight acceptance criteria with
independently re-run evidence on this round's exact file state. Cleared for
AI 01's post-QA shipping step (commit per its git-safety protocol; QA remains
read-only).
