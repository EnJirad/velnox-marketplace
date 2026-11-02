# Task Brief — Seller Dashboard UI audit + bounded improvements

TASK BRIEF VELSELLER-DASH-01

REQUEST: Audit the seller-facing dashboard surfaces in `apps/velseller`, find concrete
UX/UI defects, and fix a small, verifiable set of them: full i18n coverage of the
dashboard pages' user-facing copy and 44px touch-target compliance on the interactive
controls the seller taps every day.

DASHBOARD-SURFACE DEFINITION (audit scope, and why):

- `apps/velseller/src/pages/SellerGoals.tsx` — IS a dashboard surface: it is the app's
  default landing route (`apps/velseller/src/main.tsx:80` redirects `/` to
  `/seller/goals`) and renders the overview/stat-card grid (4 KPI cards, lines 104–153).
- `apps/velseller/src/pages/Income.tsx` — IS a dashboard surface: financial KPI grid
  (4 stat cards, lines 133–181) + report + transaction list.
- `apps/velseller/src/pages/SellerOrders.tsx` — IS a dashboard surface: the seller's
  order-queue list with status filters and pagination (the "queue" view of the
  dashboard).
- `apps/velseller/src/pages/MyShop.tsx` — IS dashboard-like in its main (approved,
  on-boarded) return branch (line 545 onward): shop summary cards, product quick-stats,
  filters and the product management list. NOT the dashboard are its onboarding form,
  approval-gate and verification-wizard branches (lines 411–542, 957–1109) — see scope.
- NOT dashboard surfaces (excluded): `SellerChat.tsx` (messaging tool),
  `Reorder.tsx` (restock workflow), `SellerProfile.tsx` (settings form),
  `SellerOrderDetail.tsx` (single-order drill-down). They are task flows, not
  overview/stat pages.

AUDIT FINDINGS (in APPROACH order of severity; evidence is file:line in current HEAD):

F1 — Dashboard copy bypasses the i18n system entirely or partially.
  - `Income.tsx`: every user-facing string is hard-coded Thai — page header
    (99–106), error block (118–127), all 4 KPI card labels/sublabels (137–180),
    policy card (190–198), over-rate badge (205), section header (213), empty state
    (222–224), table headers (234–239), customer fallback (250), "+N รายการ" (263),
    fee dash note (345), mobile card labels (304–336), footnote (345). The file never
    imports `useLanguage`. Also `pct()` (34–35) and the item counts (143, 156) hard-code
    `"th-TH"` (see SCOPE LIMITS — formatting helpers stay as-is).
  - `SellerGoals.tsx`: same problem — toasts (61, 65), greeting header (84–88),
    CTA labels (98, 184–185, 231), all 4 KPI labels/sublabels (108–151), empty state
    (170–176), summary strip (213–219), delete dialog (252–263). Never imports
    `useLanguage`.
  - `MyShop.tsx`: inconsistent mix — it already localizes via `productModeration.*`,
    `verification.*`, `gate.*`, but the dashboard chrome is hard-coded Thai: eyebrow
    (554), page sub (560), "เพิ่มสินค้า" CTA (571), shop summary cards (582–604),
    product section header + count (643–645), search placeholder + aria-label
    (653, 656), 4 quick-stats labels (663–676), filter labels count context, empty
    states (708–711, 727–729), table headers (739–743), inventory sublabel (788–789),
    action labels "แก้ไข" (830, 922), mobile stock line (890), mobile delete
    aria-label (931), open-shop/publish/delete/publish toasts (100, 235, 246, 250,
    269–271, 295–301, 345), delete dialog (1114–1127), toggle label "ปิดขาย" (400).
  - Contrast: `SellerOrders.tsx` already routes everything through
    `t("sellerOrders.*")` — the correct in-repo pattern to replicate.
  - This matches the known open gap recorded in
    `.ai/history/2026-11-02-velseller-i18n-touch.md` item 19 ("migrate remaining
    hard-coded seller copy to i18n"). Consequence today: switching the app to EN or MY
    leaves three of the four dashboard pages in Thai.

F2 — 44px touch-target violations on primary interactive controls.
  Project precedent: primary actions must be 44px (`h-11` / `min-h-11`) —
  `.ai/history/2026-11-02-velseller-i18n-touch.md` (§12, §30) and
  `.ai/AI_HANDOFF.md:1518`.
  - `SellerOrders.tsx:232–245`: status filter chips are `px-3 py-1.5 text-xs` ≈ 30px
    tall. These chips are the ONLY way to filter the order queue on mobile.
  - `SellerOrders.tsx:254–259`: the stale-data retry chip is the same undersized
    `py-1.5 text-xs`.
  - `MyShop.tsx:686–700`: product status filter chips, same `px-3 py-1.5 text-xs`, and
    they also lack `aria-pressed` (SellerOrders sets it at line 236).
  - `MyShop.tsx:924–933`: mobile delete icon button is `size-9` = 36px, under 44px.
  - `MyShop.tsx:622–633`: verification submit/resubmit link is bare `text-[11px]`
    text with no minimum height.
  - (Primary CTA buttons across these pages already carry `h-11` from the previous
    pass — verified: Income.tsx:125, MyShop.tsx:481/564/714/898, SellerGoals.tsx:92/
    178/209, SellerOrders.tsx:277.)

F3 — Minor consistency gap folded into F2's fix: `aria-pressed` missing on the MyShop
  filter chips while the equivalent SellerOrders chips have it.

Not counted as defects this round (deliberately out of scope): `toLocaleString("th-TH")`
number grouping and `formatThaiDate`'s Thai calendar rendering on EN/MY (changing
formatting behavior is a functional change, see SCOPE LIMITS); the MyShop verification
wizard's internal copy (excluded cluster, see SCOPE LIMITS).

AFFECTED FILES:
- apps/velseller/src/pages/Income.tsx
- apps/velseller/src/pages/SellerGoals.tsx
- apps/velseller/src/pages/MyShop.tsx
- apps/velseller/src/pages/SellerOrders.tsx
- packages/shared/src/lib/i18n/locales/th.ts
- packages/shared/src/lib/i18n/locales/en.ts
- packages/shared/src/lib/i18n/locales/my.ts
(no new files; no new dependencies)

APPROACH: Replicate the in-repo pattern that already works — `SellerOrders.tsx` +
`useLanguage()` + locale namespaces — instead of inventing anything. Add ONE new
top-level namespace `sellerDash` with three sub-groups (`income`, `goals`, `shop`) to
each of th/en/my. Per `.ai/context/frontend.md`, th.ts (~106 KB) and my.ts (~100 KB)
are past the workspace edit window in their later blocks, so insert the namespace as a
new top-level block near the TOP of each locale file (same placement strategy as the
existing `orderCancel` example); adding a brand-new top-level key cannot collide with
the `myAuthPatch`/`myShopPatch`/`myOrderPatch` merges in `locales/index.ts`, which need
no change. Keys that appear on desktop AND mobile views (table headers, KPI labels,
action labels) are defined once and reused by both renders. Interpolated strings
(e.g. greeting name, product name in aria-label/delete dialog) use the existing
interpolation syntax that `i18n:check` already enforces. Touch-target fixes are pure
className additions (`min-h-11`, `size-11`) plus one `aria-pressed` — no layout
restructuring, no responsive-behavior change (SellerOrders' chip row is already
`flex flex-wrap`; MyShop's is `overflow-x-auto`, and taller chips only change height).

STEPS:
1. Add the `sellerDash` namespace (sub-groups `income`, `goals`, `shop`) to
   `packages/shared/src/lib/i18n/locales/th.ts`, `en.ts` and `my.ts`, inserted as a new
   top-level block near the top of each file. Key sets must be IDENTICAL across the
   three locales; every string from findings F1 that lives in the four dashboard
   branches listed below gets a key:
   - all Income.tsx strings cited in F1 (page header, error/retry, 4 KPI cards,
     policy card, badge, section header, empty state, table headers, customer
     fallback, "+N รายการ", mobile card labels, footnote);
   - all SellerGoals.tsx strings cited in F1 (toasts, greeting header, CTA labels,
     4 KPI cards, empty state, summary strip, delete dialog);
   - the MyShop dashboard-chrome strings cited in F1 (eyebrow, sub, CTAs, shop
     summary cards, product section header/count, search placeholder + aria-label,
     quick-stats labels, empty states, table headers, inventory sublabel, action
     labels, mobile stock line, delete aria-label, toasts, delete dialog) —
     EXCLUDING everything inside the verification-wizard `<Dialog>` (lines ≈957–1109)
     and `ProductFormDialog`, which stay untouched this round;
   - do NOT duplicate keys that already exist under `productModeration.*`,
     `verification.*`, `gate.*`, `sellerOrders.*`, `common.*` — reuse `t()` on the
     existing keys where the current code already does.
2. `Income.tsx`: import `useLanguage` and replace every hard-coded string with the
   matching `t("sellerDash.income.*")` call. No logic, data-flow or JSX-structure
   changes beyond the text expressions.
3. `SellerGoals.tsx`: same — import `useLanguage`, replace strings with
   `t("sellerDash.goals.*")` (greeting keeps the existing `firstName` interpolation).
   Keep `formatThaiDate(Date.now())` and `formatNumber(...)` unchanged.
4. `MyShop.tsx`: replace the dashboard-chrome strings cited above with
   `t("sellerDash.shop.*")` and reuse existing keys where they already exist
   (`productModeration.*` etc.). Do not touch the verification wizard, the
   ProductFormDialog, onboarding or approval-gate branches.
5. Touch targets + a11y:
   - SellerOrders.tsx: add `min-h-11` to the status-filter chip button (line ≈237)
     and to the amber retry chip (line ≈257).
   - MyShop.tsx: add `min-h-11` to the product status chips (line ≈690), add
     `aria-pressed={active}` mirroring SellerOrders, change the mobile delete icon
     button from `size-9` to `size-11` (line ≈927), and give the verification
     submit/resubmit link `inline-flex min-h-11 items-center` (line ≈625).
6. Run the verification commands in TEST CASES; fix anything they surface (an
   i18n-check failure means key/interpolation parity is broken between locales).

ACCEPTANCE CRITERIA:
1. `bun run i18n:check` exits 0 and reports equal key counts across th/en/my; the
   `sellerDash` namespace exists with an identical key set in all three locale files
   (same number of keys, same interpolation placeholders).
2. `bun --filter @velnox/velseller typecheck` exits 0; `bun run typecheck` exits 0.
3. `bun --filter @velnox/velseller build` exits 0.
4. Zero remaining raw Thai JSX strings in `Income.tsx` and `SellerGoals.tsx`
   (grep for the Thai Unicode range ก-๙ returns no matches in those two files except
   inside comments), and zero remaining hard-coded Thai in the MyShop dashboard-chrome
   regions listed in step 1 (wizard region exempt).
5. `SellerOrders.tsx` filter chips and retry chip, and `MyShop.tsx` product chips,
   mobile delete button and verification link, all carry the 44px classes
   (`min-h-11` / `size-11`) — verifiable by grep.
6. `MyShop.tsx` filter chips render `aria-pressed`.
7. `git status` shows changes ONLY in the seven AFFECTED FILES.
8. No API route, schema, auth, routing or dependency change appears in the diff.

TEST CASES:
- bun --filter @velnox/velseller typecheck → exit code 0
- bun run typecheck → exit code 0
- bun run i18n:check → exit code 0, th/en/my key counts equal
- bun --filter @velnox/velseller build → exit code 0
- grep -c "sellerDash\." on each of the three page files → ≥ 1 each
- grep -nE "[ก-๙]" apps/velseller/src/pages/Income.tsx and SellerGoals.tsx → 0 matches
  outside comments
- grep -n "min-h-11" apps/velseller/src/pages/SellerOrders.tsx → matches at the chip
  and retry-chip lines
- git status --short → only the seven AFFECTED FILES

RISKS:
- Locale catalogs are large; editing th.ts/my.ts in a late block hits the workspace
  edit-window limit — mitigate by inserting the new namespace near the top of each
  file (documented pattern in .ai/context/frontend.md).
- Interpolation-placeholder mismatch between locales fails `i18n:check` — the check
  is the guard; fix on first run.
- Taller filter chips change desktop appearance slightly (chips grow from ~30px to
  44px tall). Acceptable and intended; no layout wrap risk in SellerOrders
  (`flex-wrap`) or MyShop (`overflow-x-auto`).
- A missing key renders a raw key string — guarded by criterion 4/5 grep + i18n:check.
- `my.ts` content merges through patch objects in `locales/index.ts`; a new top-level
  key is unaffected, but AI 01 must not edit those patch objects.

SCOPE LIMITS (must NOT be touched):
- No backend/API, schema, auth flow, routing, or dependency changes; no mock data.
- Do not modify: `AppHeader`, `MobileTabBar`, shared `GoalCard`/`GoalFormDialog`/
  `ProgressDialog`, `ProductFormDialog`, `EvidenceUploader`, the MyShop verification
  wizard `<Dialog>` internals, MyShop onboarding/approval-gate branches, and the four
  excluded pages (SellerChat, Reorder, SellerProfile, SellerOrderDetail).
- Do not change existing i18n keys or namespaces (`sellerOrders.*`, `orderStatus.*`,
  `paymentLabels.*`, `productModeration.*`, `verification.*`, `gate.*`, `common.*`,
  `sellerNav.*`) — only ADD the new `sellerDash` namespace.
- Do not change number/date formatting behavior: keep `formatBaht`, `formatThaiDate`,
  `formatNumber`, `formatIsoDate`, `formatIsoDateTime`, and the existing
  `toLocaleString("th-TH")` calls exactly as they are (locale-aware formatting is a
  separate, functional follow-up — consciously deferred).
- No information-architecture redesign, no component system duplication, no
  responsive-breakpoint changes, no color/token inventions.
- Do not commit; AI 01 ships per its own git-safety protocol after QA PASS.
