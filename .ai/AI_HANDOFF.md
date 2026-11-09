# Velnox AI Handoff — Current State

**Last verified:** 2026-11-09 · **Branch:** `main` · **HEAD:** `b5819df` (pushed — logo/favicon task)

## 1. Current Project State

**WORKING** — 4/4 apps typecheck, i18n parity, all commits pushed to origin/main. NOTE: full `bun test tests` still has pre-existing failures from the in-progress Phase 2 UI overhaul (HomePromoStrip design, seller-order-ux source tests, cookie-store 0600 needs `.ai/secrets/browser-cookies.json`) — confirmed present on the baseline before the tracking work. DB-gated suites skip locally (no disposable PostgreSQL).

### Active Tasks
- **BUGFIX CRITICAL (2026-11-08): customer order tracking 500 "Failed to fetch order"** — **RESOLVED** ✅. Root cause VERIFIED: `fetchShipmentsForOrder()` selected new tracking columns without a fallback → `42703` on an unreconciled production schema → 500 on every order detail. Fix: schema-gap-only fallback (42703/42P01) in all readers of the new columns + ShopTracking error classification (401/403/404/5xx/network) with Retry. Committed in `96bbb74` (shipping) + `6ab1ddc` (icons2), pushed. **Production Neon now reconciled & verified 2026-11-09 via Neon MCP** (`wandering-glitter-94857012`): `shipments` has all 18 columns incl. carrier_code/original_status/last_checked_at/last_error/tracking_confirmed, `tracking_events` has `carrier_status`. Tracking fallback test `backend/tests/order-read-schema-fallback.test.ts` → 5 pass.
- **Multi-carrier tracking (integrated)** — committed + pushed. New `backend/lib/tracking/` (adapter contract + J&T/Flash/SPX/TNT adapters + normalizer + safe-fetch + repo + service with cache/dedup/cooldown), `backend/routes/tracking.ts`, additive DB columns on `shipments` + `tracking_events` (schema.sql + run-sqleditor.sql in sync, 67-tables match verified 2026-11-09), frontends extended (ShopTracking refresh UI, seller ship dialog carrier select + refresh, VelCenter Tracking tab), i18n th/en/my at parity. Carrier status: J&T BLOCKED (captcha), Flash BLOCKED (anti-bot), SPX UNSUPPORTED (internal portal API), TNT PARTIAL (public API verified working). Docs: `.ai/context/tracking.md`.
- **Logo/favicon rollout (2026-11-09)** — ✅ committed + pushed:
  - `41fe884` — use new Velnox V-mark (`public/logo.svg`, #0F172A) as favicon across velshop/velseller/velcenter/velnox + shared asset; `Logo.tsx` LogoMark now white box + dark V-mark (design B); fixed manifest icon refs that pointed at missing `logo.png` → `/logo.svg`.
  - `b5819df` — fixed velnox `public/public/` double-nesting: files moved up one level so the favicon actually serves at `/logo.svg` (index.html already referenced it). All 4 apps build cleanly; `dist/logo.svg` at root of each build.
- **Phase 2 UI/UX Overhaul** — **Group 1 complete** (shared components + VelShop homepage/products) ✅ VERIFIED
  - **Group 2 in progress**: Created shared `ProductGrid` component (server-paginated, reusable) ✅, integrated into `ShopProducts.tsx` ✅
  - Next: GalleryLightbox for Product Detail; integrate ProductGrid into ShopHome rails
- **Icon library + category details (2026-11-08)** ✅ — full offline Iconify library wired into VelCenter (lucide/mdi/tabler/ph/fa6-solid) via `packages/shared/src/lib/icons/`; CategoryIcon resolves `prefix:name` lazily; category details panel (Sheet) with product count/status/dates/breadcrumb. Icon picker is a responsive Radix Dialog modal (search, collection chips, grid, confirm-only). Committed & pushed (`7d06455`, `5a8359a`, `6ab1ddc`).
- Seller roadmap Part 2 (Orders / Order Detail re-verification) — **not started**.
- Shipping P0 (fee + quote) — **implemented and committed**; production schema reconciled 2026-11-05.
- **35.00 THB flat default per shop** is the owner-approved placeholder until a carrier API exists (`PLATFORM_DEFAULT_FLAT_FEE`); per-shop `shops.shipping_fee` still wins. Checkout E2E + 15 DB-gated shipping tests BLOCKED (no disposable PostgreSQL).

### Important Unresolved Issues
1. **No local PostgreSQL** — `initdb` hangs on Android, so every `TEST_DATABASE_URL`-gated suite skips here. Escape hatch: GitHub Actions `test.yml` runs them on CI (push to origin = server-side verification).
2. **Responsive verification BLOCKED** — CDP cannot install on android/arm64.
3. **Production DB access is indirect** — no `psql` connection string; agents READ production via Neon MCP (`wandering-glitter-94857012`), WRITE only through manual `production-db-migrate.yml` reconcile workflow.
4. **Stripe live payments are NOT enabled** — sandbox/test keys only. Real money needs live keys + `STRIPE_MODE=live` + `STRIPE_ALLOW_LIVE=true` in Render (see `.ai/context/payment.md`). **Owner deferred live-card testing until device can test it — do not test until owner asks.**
5. **Impeccable engine BLOCKED** — `impeccable --version` fails (`unexpected e_type: 2`); UI review falls back to `VELNOX_DESIGN_THEME.md` + craft-floor.

### Important Recent Decisions
- **Stripe live mode is an explicit opt-in (2026-11-05).** Production runs Stripe **test mode**; real cards / real PromptPay cannot complete. Live key used only with `STRIPE_ALLOW_LIVE=true` **and** `STRIPE_MODE=live` plus webhook secret (`backend/lib/payment-config.ts`). Owner decision (2026-11-09): do not run live-card tests until owner says the device can test.
- **Shipping is server-priced (2026-11-05).** One flat fee per shop shipment; quotes in `shipping_quotes` (15 min TTL, single use). Checkout refuses every client money field.
- **One canonical report:** `.ai/reports/LATEST.md`, overwritten per task. Dated records in `.ai/history/`, archive index in `.ai/history/AI_Handoff_Archive.md`.
- **Compact handoff** (this file). Pre-compaction 105 KB handoff preserved at `.ai/history/archive/AI_HANDOFF_2026-11-02_FULL.md`.

---

## 2. Quick Pointers

| Need | Location |
|------|----------|
| Startup (read first) | `.ai/office/QUICK_START.md` |
| Always-on safety rules | `.ai/office/ESSENTIAL_RULES.md` |
| Full rulebook | `.ai/AI_RULES.md` |
| Latest task report | `.ai/reports/LATEST.md` |
| History index | `.ai/history/AI_Handoff_Archive.md` |
| Verbatim archive | `.ai/history/archive/` |
| Subsystem docs | `.ai/context/<topic>.md` |
| AI Office architecture | `.ai/office/ARCHITECTURE.md` |
| Agent roles | `.ai/office/agents/developer.md` · `architect.md` |

---

## 3. Runtime limits (must be stated honestly)

- The Android Harness **request builder is not in this repository.** `.ai/office/context-management/` is a real, tested library, but whether the live session calls it is controlled by Harness settings, not by this workspace. Do not claim the runtime uses it without evidence.
- AI 01 selects the routing level and acts on it by following `.ai/office/agents/developer.md`. The router constrains the *decision and its context payload*, not the platform's tool dispatch.
- `bun test` needs the `./` prefix on this host (bun 1.4.4).

---

## 4. Environment Notes

- `TEST_DATABASE_URL` is the only database a test may write to; DB tests **skip** when unset.
- `DATABASE_URL` points at production Neon — never write to it from a test.
- `bun run lint` runs real ESLint (`eslint .`) and `bun run format` runs `prettier --check .` (wired 2026-11-09, commit `6a2543e`). Both report the repo's pre-existing style debt (1061 eslint problems, many prettier-formattable files) — they are tools, not a clean bill of health.

---

## 5. Next Agent Should

1. `git fetch origin`; compare `HEAD` with `origin/main`. Behind → `git pull --ff-only`. Diverged → STOP.
2. Read `.ai/office/QUICK_START.md`, then only the subsystem doc the task touches.
3. Classify T1/T2/T3 and follow the matching workflow — do not read the full history.
4. Update `.ai/reports/LATEST.md` (overwrite) and this handoff when state changes.
