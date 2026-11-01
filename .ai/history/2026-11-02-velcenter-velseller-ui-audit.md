# VelCenter + VelSeller UI/UX audit — Phase 1 (2026-11-02)

**SHA audited:** `f1322b9` (`HEAD == origin/main`), working tree clean. **No code changed** — audit first, as
the task requires.

## Findings (from the actual source, not assumptions)

| Area | Reality | Verdict |
|---|---|---|
| Language provider | `apps/velcenter/src/main.tsx` and `apps/velseller/src/main.tsx` mount **`RealtimeProvider` only** — no `LanguageProvider` — yet pages call `useLanguage()` (`Center.tsx`, `SellerOrders`, `MyShop`, `SellerChat`, verification queue…). Outside a provider the shared hook cannot switch or persist a language. | **Defect — the single biggest i18n gap.** VelShop wraps it; these two do not. |
| Hardcoded Thai | 10 `.tsx` files in `apps/velcenter/src` and 6 in `apps/velseller/src` contain Thai literals (e.g. ChatManagement's "พิมพ์ข้อความ...", verification labels). | Needs keys, not string replacement per file. |
| VelCenter shell | `app/pages/Center.tsx` owns routing + its own section list; there is **no shared AppHeader/sidebar shell** and no `MobileTabBar`. Admin sections (dashboard, verification, moderation, orders, employees, incidents, chat, audit, categories, settings) are reached from one page. | Needs a real app shell: desktop sidebar + top bar, mobile drawer. |
| VelSeller shell | Uses shared `AppHeader` + `MobileTabBar` (`SELLER_TABS`, `until="lg"`) — the pattern already exists and should be reused, not reinvented. | Good baseline; needs visual alignment with the new center chrome. |
| Design tokens | Both apps already use the shared `Button`, tokens and `t()`; no bespoke design system was found. | Reuse shared components; no new design system.

## Why these three, and nothing else

I did **not** audit every screen line-by-line in this pass — the three findings above already determine the
work order, and inventing page-level redesigns without reading each page would be guesswork.

## Proposed phases (implementation not started)

1. **Shared shell** — extract one `AppShell` (desktop sidebar + sticky top bar + `MobileTabBar` fallback +
   `LanguageSwitcher`) in `packages/shared/src/components/`, wire `LanguageProvider` in **both** apps'
   `main.tsx` (VelShop untouched).
2. **VelCenter** — move `Center.tsx` sections behind the shell; keep every route, permission check and query
   as-is; compact tables/cards (`text-sm`, `p-3/4`, `rounded-xl`), sidebar with icons + labels, drawer on
   `<768px`.
3. **VelSeller** — same shell; keep `MobileTabBar`; compact product cards (max-w, 2-up desktop grid instead
   of oversized cards); order status chips from the existing status map.
4. **i18n sweep** — add `center.*` / `seller.*` keys for the 16 files with Thai literals, th/en/my parity via
   the existing `i18n:check`; no business terms re-worded.
5. **Onboarding** — display `needs_correction` reason (already in the API) + resubmit CTA; no new statuses.
6. **Verify** — typecheck, builds, `i18n:check`, plus viewport checks at 360/390/430/768/1024/1280/1440/1920
   (browser automation of a logged-in admin/seller session is **not possible** in this environment — see
   blocked report; visual sign-off needs the owner).

## Risks / notes

- Adding `LanguageProvider` changes the default language resolution for two apps — must be verified that
  Thai remains the default and the stored preference is honoured (VelShop's pattern is the reference).
- `Center.tsx` is large; the shell extraction must not move permission logic into the UI layer.
- No payment, API, schema or auth change is involved.
