# Velnox AI Handoff — Current State

**Last verified:** 2026-11-05 · **Branch:** `main` · **HEAD:** see `git rev-parse HEAD` (do not trust a SHA written here — it goes stale after every commit)

## 1. Current Project State

**WORKING** — 4/4 apps typecheck, i18n parity (1702 × 3), velShop + velseller production
builds green, `backend/tests` 1340 pass / 404 skip / 1 pre-existing flaky case
(`proxy-write-mode` `--check`, which passes when the file runs alone).

### Active Tasks
- Seller roadmap Part 2 (Orders / Order Detail re-verification) — **not started**.
- Shipping P0 (fee + quote) — **implemented and committed**; production schema reconciled
  2026-11-05 (money table + shop columns now exist in Neon).
- **35.00 THB flat default per shop** is the owner-approved placeholder until a carrier
  API exists (`PLATFORM_DEFAULT_FLAT_FEE`); per-shop `shops.shipping_fee` still wins.
  Browser E2E of the checkout screen and the 15 DB-gated shipping tests are BLOCKED
  (no disposable PostgreSQL on this device).

### Important Unresolved Issues
1. **No local PostgreSQL** — `initdb` hangs at "selecting default max_connections"
   (Android), so every `TEST_DATABASE_URL`-gated suite skips here, including the new
   `checkout-shipping-integrity.test.ts` and any local end-to-end purchase journey.
2. **Responsive verification BLOCKED** — CDP cannot install on android/arm64.
3. **Production DB access is indirect** — no `psql` connection string for agents, but
   production can be READ through the Neon MCP (`wandering-glitter-94857012`) and
   WRITTEN only through the manual `production-db-migrate.yml` reconcile workflow.
4. **Impeccable engine BLOCKED** — `impeccable --version` fails with
   `unexpected e_type: 2`; UI review falls back to `VELNOX_DESIGN_THEME.md` + craft-floor.

### Important Recent Decisions
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
- `bun run lint` / `bun run format` are placeholders; they prove nothing.

---

## 5. Next Agent Should

1. `git fetch origin`; compare `HEAD` with `origin/main`. Behind → `git pull --ff-only`. Diverged → STOP.
2. Read `.ai/office/QUICK_START.md`, then only the subsystem doc the task touches.
3. Classify T1/T2/T3 and follow the matching workflow — do not read the full history.
4. Update `.ai/reports/LATEST.md` (overwrite) and this handoff when state changes.
