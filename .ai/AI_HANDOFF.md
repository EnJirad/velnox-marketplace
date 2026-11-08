# Velnox AI Handoff — Current State

**Last verified:** 2026-11-08 · **Branch:** `main` · **HEAD:** `96bbb743` (pushed SHIPPING task) — icon-picker modal work below is UNCOMMITTED (task forbids commit/push without permission)

## 1. Current Project State

**WORKING** — 4/4 apps typecheck, i18n parity (2215 × 3), all commits pushed to origin/main. NOTE: full `bun test tests` still has pre-existing failures from the in-progress Phase 2 UI overhaul (HomePromoStrip design, seller-order-ux source tests, cookie-store 0600 needs `.ai/secrets/browser-cookies.json`) — confirmed present on the baseline before the tracking work.

### Active Tasks
- **BUGFIX CRITICAL (2026-11-08): customer order tracking 500 "Failed to fetch order"** — **FIXED, NOT pushed** (rule: no commit without permission). Root cause VERIFIED: production Neon has NOT been reconciled — `shipments` lacks all 6 new tracking columns and `tracking_events` lacks `carrier_status`, while `fetchShipmentsForOrder()` selected them without a fallback → `42703` → 500 on every order detail. Fix: schema-gap-only fallback (42703/42P01) in all readers of the new columns + ShopTracking error classification (401/403/404/5xx/network) with Retry. Tests pass. **BLOCKED:** apply `db/run-sqleditor.sql` to production Neon (owner action, project workflow); Render logs unavailable. Details: `.ai/history/2026-11-08-customer-tracking-500.md`, `.ai/reports/LATEST.md`.
- **Multi-carrier tracking (integrated)** — **implemented, NOT pushed** (no commit made — task rule forbids commit/push without permission). New `backend/lib/tracking/` (adapter contract + J&T/Flash/SPX/TNT adapters + normalizer + safe-fetch + repo + service with cache/dedup/cooldown), `backend/routes/tracking.ts` (customer/seller/admin), additive DB columns on `shipments` + `tracking_events` (schema.sql + run-sqleditor.sql in sync, reconciler tests pass), frontends extended (ShopTracking refresh UI, seller ship dialog carrier select + refresh, VelCenter Tracking tab), i18n th/en/my at parity. Carrier status: J&T BLOCKED (captcha), Flash BLOCKED (anti-bot), SPX UNSUPPORTED (internal portal API), TNT PARTIAL (public API verified working). Report: `.ai/reports/LATEST.md`. Full docs: `.ai/context/tracking.md`.
- **Phase 2 UI/UX Overhaul** — **Group 1 complete** (shared components + VelShop homepage/products) ✅ VERIFIED
  - **Group 2 in progress**: Created shared `ProductGrid` component (server-paginated, reusable) ✅
    - Integrated into `ShopProducts.tsx` — replaces manual grid + pagination logic
    - Typecheck + build PASS
  - Next: GalleryLightbox for Product Detail; integrate ProductGrid into ShopHome rails
- **Icon library + category details (2026-11-08)** ✅ — full offline Iconify library wired into
  VelCenter: 5 collections (lucide 2109 · mdi 7638 · tabler 6305 · ph 9161 · fa6-solid 1407 primary
  icons) via `packages/shared/src/lib/icons/` (scaffolded at `7d06455`, now typecheck-fixed and
  connected). CategoryIcon resolves `prefix:name` lazily (code-split chunks, offline); curated
  Lucide fast-path + URLs preserved. Slug preview/copy/refresh removed. Product count badge moved
  from the tree into a right-side details panel (Sheet; full width on mobile) showing published-
  product count, status, dates, breadcrumb, children navigation and quick actions.
  **Update (same day): icon picker is now a responsive modal** (was an overflowing dropdown) —
  `IconifyIconPicker.tsx` rewritten on Radix Dialog: header title/desc/close/expand, search+clear,
  collection chips, icon grid with dedicated preview container (no text overlap; `flex-shrink-0`,
  fixed 48px box, name on its own line), temporary selection applied only on Confirm (cancel/ESC/
  close discards), expand/collapse preserves query/collection/scroll/temp, pagination kept.
  UNCOMMITTED (task forbids commit/push without permission). Report: `.ai/reports/LATEST.md`.
  Browser E2E still BLOCKED (no local DB/R2; expired saved cookies).
- Seller roadmap Part 2 (Orders / Order Detail re-verification) — **not started**.
- Shipping P0 (fee + quote) — **implemented and committed**; production schema reconciled
  2026-11-05 (money table + shop columns now exist in Neon).
- **35.00 THB flat default per shop** is the owner-approved placeholder until a carrier
  API exists (`PLATFORM_DEFAULT_FLAT_FEE`); per-shop `shops.shipping_fee` still wins.
  Browser E2E of the checkout screen and the 15 DB-gated shipping tests are BLOCKED
  (no disposable PostgreSQL on this device).

### Important Unresolved Issues
1. **No local PostgreSQL** — `initdb` hangs at "selecting default max_connections"
[showing lines 1..25 of 120]
   (Android), so every `TEST_DATABASE_URL`-gated suite skips here, including the new
   `checkout-shipping-integrity.test.ts` and any local end-to-end purchase journey.
2. **Responsive verification BLOCKED** — CDP cannot install on android/arm64.
3. **Production DB access is indirect** — no `psql` connection string for agents, but
   production can be READ through the Neon MCP (`wandering-glitter-94857012`) and
   WRITTEN only through the manual `production-db-migrate.yml` reconcile workflow.
4. **Stripe live payments are NOT enabled** — the connected Stripe account is a
   sandbox; production has test keys only. Real money needs live keys +
   `STRIPE_MODE=live` + `STRIPE_ALLOW_LIVE=true` in Render (see
   `.ai/context/payment.md` and `.ai/reports/LATEST.md` §10).
4. **Impeccable engine BLOCKED** — `impeccable --version` fails with
   `unexpected e_type: 2`; UI review falls back to `VELNOX_DESIGN_THEME.md` + craft-floor.

### Important Recent Decisions
- **AI Office Sequential Stabilization (Phases 1-2) — 2026-11-05** — **PASS** ✅
  - Phase 1: Fixed CI blocker in `backend/routes/seller-intelligence.ts` — added missing imports for `computePurchaseStats`, `estimatedNextPurchase`, `reorderConfidence` from `seller-stats.ts`. All typechecks pass.
  - Phase 2: Repaired scheduler lifecycle in `.ai/office/scheduler/request-scheduler.ts`:
    * Store `AbortController` reference (not just `AbortSignal`) for proper cancellation
    * Added `_slotReleased` flag to prevent double-release of active slot
    * Added `_retryPending` flag for proper retry handling
    * Fixed `cancel()` and `cancelActive()` to use `abortController.abort()`
    * Fixed `releaseSlot()` to check `_slotReleased` before releasing
    * Fixed `handleError()` to properly re-queue with `_slotReleased=false` for retries
    * Fixed `fromJSON()` to restore `AbortController` and new flags
  - All 14 scheduler tests pass (concurrency=1, FIFO, cancellation, retry/backoff, persistence)
  - Database sync: Added missing `status` and `commission_rate` columns to `shops` table in `db/run-sqleditor.sql` to match `db/schema.sql`
  - Commit `48b8f34` pushed to origin/main; local HEAD == remote HEAD verified
- **Stripe live mode is now an explicit opt-in (2026-11-05).** Production runs
  Stripe **test mode** (`/api/stripe/configured` → `mode:"test"`), so real cards /
  real PromptPay cannot complete — that was the reported “cannot pay”. A live key is
  used only with `STRIPE_ALLOW_LIVE=true` (or `1`) **and** `STRIPE_MODE=live` plus a
  webhook secret (`backend/lib/payment-config.ts`). Storefront shows
  `checkout.testModeNotice` while mode is `test`. A production test-mode round trip
  (quote ฿35 → order ฿384.30 → `cs_test_…` session) was executed and the test order
  cancelled; the hosted card form could not be completed here (hidden browser).
- **Shipping is server-priced (2026-11-05).** One flat fee per shop shipment
  (`shops.shipping_fee`; NULL = platform default `SHIPPING_FLAT_FEE_THB` or 35.00,
  0 = free; optional `free_shipping_threshold`). Quotes live in `shipping_quotes`
  (15 min TTL, cart + address fingerprint, single use). Checkout refuses every
  client money field and persists `subtotal − discount + shipping_fee`; a supplied
  quote is rejected when stale/expired/foreign, and a missing one is minted server-side.
  Production was missing the whole shipping schema until the 2026-11-05 reconcile
  (`pg_constraint.constraint_schema` guards aborted every earlier run); that is the
  cause of the reported checkout error "Could not calculate shipping for this cart".
- **Seller Part 1 shipped (2026-11-04).** My Shop split into `components/shop/*`
  (`ShopOnboarding`, `ShopIdentityCard`, `ShopVerificationDialog`); all seller-shop
  copy lives in `sellerDash.shop.*` (0 inline Thai left); `PATCH /api/seller/shop`
  now has a UI for name/description/phone. Report: `.ai/reports/LATEST.md`.
- **AI Office fast-start (2026-11-04).** Startup is one page: `.ai/office/QUICK_START.md`. Task routing T1/T2/T3 is auto-selected; T1 skips AI 02 planning.
- **Essential safety rules are always loaded** from `.ai/office/ESSENTIAL_RULES.md` at every level — including T1. T1 skips the full rulebook, never the safety rules.
- **One canonical report:** `.ai/reports/LATEST.md`, overwritten per task. No dated report archive; git history is the durable record.
- **Compact handoff** (this file). The pre-compaction 105 KB handoff is preserved verbatim at `.ai/history/archive/AI_HANDOFF_2026-11-02_FULL.md`.
- Announcement carousel: active slide loads `eager` (was `lazy`), which fixed the invisible banner image.
- VelCenter mobile nav offset fixed; drawer root cause resolved.

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
- `bun run lint` now runs real ESLint (`eslint .`) and `bun run format` runs `prettier --check .`
  (wired 2026-11-09, commit `6a2543e`). Both report the repo's pre-existing style debt
  (1061 eslint problems, many prettier-formattable files) — they are tools, not a clean bill of health.

---

## 5. Next Agent Should

1. `git fetch origin`; compare `HEAD` with `origin/main`. Behind → `git pull --ff-only`. Diverged → STOP.
2. Read `.ai/office/QUICK_START.md`, then only the subsystem doc the task touches.
3. Classify T1/T2/T3 and follow the matching workflow — do not read the full history.
4. Update `.ai/reports/LATEST.md` (overwrite) and this handoff when state changes.
