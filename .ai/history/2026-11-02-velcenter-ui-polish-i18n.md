# VelCenter shell copy i18n + accessibility detail (2026-11-02)

**Starting SHA:** `7ab2978` · **Ending SHA:** this commit.

## What changed

`apps/velcenter/src/pages/Center.tsx`
- Section labels now come from translation keys via the existing `t()` (`useLanguage()` was already in the file):
  `center.nav.{overview,chat,orders,intel,products,sellers,categories}`, the nav `aria-label`
  (`center.nav.sections`), the page title/subtitle (`center.title`, `center.subtitle`), the realtime reconnecting
  notice (`center.realtime.reconnecting`) and the queue error prefix (`center.queue.loadFailed`).
- No tab id, `?tab=` handling, RBAC check, query, dialog or handler was touched.

`packages/shared/src/lib/i18n/locales/index.ts`
- New `center` namespace with th / en / my values (13 keys × 3 locales). i18n parity: **1294 × 3**.

## Coverage status (honest)

Translated in this pass: the shell (nav, title, subtitle, realtime notice, queue error). Still Thai-only inside
individual panels: dashboard KPI cards, verification/moderation copy, employee management, incidents, chat,
settings sections and audit logs (~10 component files). `i18n:check` proves key **parity**, not that every
string uses a key.

## Accessibility / responsive

No new focus-trap code was added in this pass. Existing behaviour: drawer closes on Escape, backdrop and
selection; body scroll is locked and restored; 36 px triggers with `aria-label`/`aria-expanded`/`aria-controls`;
safe-area padding on the drawer.

## Verification (executed)

- `apps/velcenter` typecheck → **pass**
- `bun --filter '@velnox/velcenter' build` → **success**
- `bun run i18n:check` → **OK th=1294 en=1294 my=1294**
- `git diff --check` → clean
- lint: no real lint script in the repo (stub) → not run
- browser/viewport 360–1920 → **NOT VERIFIED** (no authenticated session)

## Protected areas

Untouched: Stripe/PromptPay/payments/webhooks/refunds, backend, schema, auth, RBAC, API contracts, VelShop,
VelSeller. Diff touches one VelCenter page plus the shared locale table only.
