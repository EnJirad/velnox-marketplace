# QA REPORT VELSELLER-DASH-01 — ROUND 1

OUTCOME: FAIL

CRITERIA CHECKED:
  - AC1 `bun run i18n:check` exit 0, equal key counts, `sellerDash` identical key set in th/en/my
    → PASS — `bun run i18n:check` → exit 0, output "i18n:check OK — th=1454 en=1454 my=1454 keys, all locales at parity."
    Independent probe (`bun` script resolving every referenced key against the three dicts): 108 `sellerDash.*` keys used by the pages, 0 missing in th/en/my; 108 keys defined per locale — perfect parity (locale diffs are purely additive, no existing keys touched).
  - AC2 `bun --filter @velnox/velseller typecheck` and `bun run typecheck` exit 0
    → PASS — first: "Exited with code 0", EXIT=0. Second: all 4 apps "Exited with code 0", EXIT=0.
  - AC3 `bun --filter @velnox/velseller build` exit 0
    → PASS — "✓ built in 5.93s", "Exited with code 0", EXIT=0.
  - AC4 Zero raw Thai in Income.tsx and SellerGoals.tsx; MyShop Thai confined to excluded regions
    → PASS — `grep -nE "[ก-๙]" Income.tsx` → 0 matches (exit 1); same for SellerGoals.tsx. MyShop.tsx residue only at lines 435–487 (onboarding form) and 992–1108 (verification wizard) — exactly the excluded clusters. All cited dashboard-chrome strings are gone.
  - AC5 44px classes on SellerOrders chips + retry chip, MyShop chips + mobile delete + verification link
    → FAIL — SellerOrders.tsx:237 chip and :257 retry chip carry `inline-flex min-h-11 items-center` (diff confirmed, nothing else changed on them). MyShop.tsx:692 chips carry `min-h-11`; MyShop.tsx:931 delete icon is now `size-11`. BUT MyShop.tsx:627 the verification submit/resubmit link is still bare `className="text-[11px] font-medium text-[#10B981] underline-offset-2 hover:underline"` — the brief's step 5 requirement (`inline-flex min-h-11 items-center`) was never applied. See D1.
  - AC6 MyShop filter chips render `aria-pressed`
    → FAIL — `grep -n "aria-pressed" apps/velseller/src/pages/MyShop.tsx` → 0 matches (exit 1). SellerOrders.tsx:236 keeps its pre-existing `aria-pressed={active}`. See D2.
  - AC7 `git status` shows only the 7 AFFECTED FILES
    → PASS — `git status --short --untracked-files=all`: exactly Income.tsx, SellerGoals.tsx, MyShop.tsx, SellerOrders.tsx, locales/{th,en,my}.ts modified; untracked entries are only the two authorized `.ai/office/handoffs/*.md` records. HEAD `1372850`, nothing staged/committed.
  - AC8 No API/auth/routing/dependency changes
    → PASS — package.json, bun.lock, backend, `locales/index.ts` absent from status; locale diffs contain only the new `sellerDash` block (no existing namespace edited); no mock data.

Additional checks performed:
  - Scope: excluded components/regions (AppHeader, MobileTabBar, GoalCard/GoalFormDialog/ProgressDialog, ProductFormDialog, EvidenceUploader, MyShop onboarding/approval-gate/wizard-Dialog, SellerChat/Reorder/SellerProfile/SellerOrderDetail) — untouched; no diff hunks inside them. MyShop line ~100 evidence-toast is inside MyShop's own callback and was explicitly cited as in-scope in the brief (F1 line 100).
  - `ctaAdd` spot-check: second SellerGoals header CTA now `t("sellerDash.goals.ctaAdd")`; th `เพิ่มเป้าหมาย` / en "Add goal" / my `ရည်မှန်းချက် ထည့်ပါ` — original Thai label preserved verbatim (matches the brief's contrast with `ctaCreate` = สร้างเป้าหมาย). Self-correction claim is genuine.
  - Formatting behavior: per-file counts of `formatBaht` / `formatThaiDate` / `formatNumber` / `formatIsoDate` / `formatIsoDateTime` / `toLocaleString("th-TH")` identical before vs after (Income 9/0/0/3/0/2, SellerGoals 0/2/2/0/0/0, MyShop 3/0/0/0/0/1, SellerOrders 3/0/0/4/2/0). `pct()` untouched.
  - SellerOrders diff is exactly 2 one-line className additions; colors, variants, behavior unchanged.
  - `git diff --check` → clean (exit 0).
  - Cosmetics only (not defects): the MyShop evidence-toast hunk at ~line 100 has misaligned indentation (`toast.error(` / `t(...)` / `);` at inconsistent indents); valid TypeScript, typecheck passes.

DEFECTS (FAIL):
  D1 (medium) — apps/velseller/src/pages/MyShop.tsx:627
     Expected: verification submit/resubmit link carries `inline-flex min-h-11 items-center` (brief step 5; AC5 names the verification link explicitly).
     Actual:   `className="text-[11px] font-medium text-[#10B981] underline-offset-2 hover:underline"` — no min height, still ≈17px tall.
     Evidence: `sed -n '620,636p' apps/velseller/src/pages/MyShop.tsx` + `grep -n "min-h-11" MyShop.tsx` → matches only at 692 (chips); no change at 627; the full `git diff` of MyShop.tsx contains no hunk for this line.
     Severity: explicit acceptance-criterion violation; the link is a primary tappable control in the dashboard chrome and fails the 44px precedent (F2).
  D2 (medium) — apps/velseller/src/pages/MyShop.tsx:684–696
     Expected: product status-filter chips render `aria-pressed={active}` mirroring SellerOrders.tsx:236 (brief step 5; AC6).
     Actual:   no `aria-pressed` anywhere in MyShop.tsx (`grep -n "aria-pressed"` → 0 matches, exit 1); chip button has only `key`, `type`, `onClick`, `className`.
     Evidence: grep above; the MyShop diff hunk at ~690 changes className only.
     Severity: explicit acceptance-criterion violation; screen-reader/state parity gap F3 was folded into this round's fix.

REGRESSIONS: none observed. All four verification commands pass on the current tree; formatting-helper call counts unchanged; locale diffs purely additive; no excluded file touched.

BLOCKERS: none.

NOT VERIFIED: AI 01's claim of "111 keys" defined — independent count is 108 defined / 108 used / 0 missing per locale. The 111 figure in the impl report appears to be a counting artifact (the report's own "Deviations" section is self-contradictory on this); the authoritative parity fact holds either way. No code impact.

VERDICT: two bounded, mechanical fixes remain (add `inline-flex min-h-11 items-center` to MyShop.tsx:627; add `aria-pressed={active}` to the MyShop chip button at ~line 688). Both are within the already-approved scope; re-run typecheck + i18n:check after. Everything else in the round is verified clean.
