# AI Handoff archive — MVP scope correction and the 2026-10-19 verification pass

Moved out of `.ai/AI_HANDOFF.md` on 2026-10-22 (edit-headroom housekeeping, made room
for §90). Both sections are complete records of the pre-cutover parking decision and the
last full pre-MVP verification pass. Verbatim.

---

## §80. Scope correction: MVP = BUY + SELL + CONTROL — wholesale PARKED (2026-10-19)

**Owner re-scope (in-session, 2026-10-19):** the MVP is BUY + SELL + CONTROL only. Wholesale / B2B,
Store Accounts, VelRepeat, Customer Memory, behavioural tracking, recommendations, loyalty,
subscriptions, AI commerce and CRM are all **out of scope**. `Selling Unit / Set / Pack` is **CORE**
and stays on.

**What was parked (no deletion, no schema change):**

| Surface | Parked state |
|---|---|
| `backend/server.ts` | `setupStoreAccountRoutes(app)` runs only `if (WHOLESALE_ENABLED)` → `/api/customer/store-account` and `/api/admin/store-accounts*` are 404 |
| `backend/lib/store-accounts.ts` | `getWholesaleAccess()` returns not-approved while parked, so `isApprovedStore()` — and every cart/checkout/reorder gate that delegates to it — is false without touching those call sites |
| `backend/lib/selling-units.ts` | `loadSellingUnits()` = `WHOLESALE_ENABLED && includeWholesale`; `resolveSellingUnit()` requires the flag too; `countWholesaleUnits()` returns an empty map without querying |
| `backend/routes/product-selling-units.ts` | `isWholesale: true` is refused while parked (`false` is still accepted, so a mark can be cleared) |
| `backend/lib/permissions.ts` | `stores.manage` is omitted from the catalog (a code that guards nothing is not offered) |
| velShop | `/profile/store` not registered; the profile row and the product-page callout / `ขายส่ง` badges are hidden |
| velCenter | the "ร้านค้าส่ง" tab and queue are never offered (`canSee("stores")` is false) |
| velSeller | the wholesale checkbox / badge in `SellingUnitsManager` is hidden; set & pack authoring is untouched |

**Preserved (verified unchanged):** migrations 058/059 and every selling-unit column (`pieces`,
`selling_unit_id`, `selling_unit_pieces`, `selling_unit_name`), the base-unit invariant
(`quantity * selling_unit_pieces` is the only quantity inventory / variant stock / `sold_count` see),
the cart → checkout → Stripe → webhook → order path, auth/authz, order snapshots and the VelCenter
seller / product / order / payment surfaces. **No migration was written; `db/schema.sql` and
`db/run-sqleditor.sql` were not modified** (the parked objects were already canonical there).

**Verified this pass:** `bun run typecheck` 4/4 + `tsc -p backend` exit 0 · `bun run build:apps` 4/4 ·
`bun run i18n:check` `th=1535 en=1535 my=1535` · `bun test backend/tests` **1741 pass / 413 skip /
1 fail**, the failure being the **pre-existing** ungated DB describe in
`checkout-group-payment-visibility.test.ts` (`ECONNREFUSED 127.0.0.1:5432` — no PostgreSQL here).
`git diff --check` clean. Six parked-contract tests run in `backend/tests/store-accounts.test.ts`;
the 14 DB-gated wholesale tests skip (not deleted, not weakened).

**NOT verified — do not read as PASS:** no PostgreSQL in this workspace, so every DB-gated test
skipped (including the retail set/pack reserve/settle proofs that passed in §77/§78 with a disposable
DB) · no browser E2E · real Stripe TEST E2E and production Neon remain BLOCKED (owner credentials).

**Remaining decision:** `apps/velnox` corporate marketing copy still says "ปลีกและส่ง" / "ซื้อส่ง —
ร้านค้าชุมชน" (`pages/corporate/content.ts`). It is marketing, not a storefront flow, and rewriting
positioning is an owner decision — flagged, not changed.

---

## §81. MVP verification pass — BUY + SELL + CONTROL on a real database (2026-10-19)

**Scope:** audit + proof only, no new features. A disposable PostgreSQL 14 was started in this
workspace, bootstrapped from `db/run-sqleditor.sql`, and the whole suite was run against it.

| Check | Result |
|---|---|
| Fresh-DB bootstrap ×3 (idempotency) | 77 tables / 837 columns / 305 indexes, unchanged |
| `bash db/verify-reconciler.sh` | **ALL SCENARIOS PASSED** |
| `bun test backend/tests` (real DB) | **2147 pass / 16 skip / 0 fail** — 2163 tests, 75 files |
| `bun run typecheck` 4/4 + `tsc -p backend` | exit 0 |
| `bun run build:apps` | 4/4 exit 0 |
| Browser E2E | **none exists** in the repository |
| Real Stripe TEST round trip | **BLOCKED** — no keys, no provider access in this workspace |

The 16 skips are by design: 14 parked-wholesale tests (`WHOLESALE_ENABLED=false`) and 2 R2 upload
tests that need R2 credentials.

**ONE REAL BUG FOUND AND FIXED.** `backend/routes/products.ts#getSellerForUser`
resolved the seller row **without its status** — the only seller module that did (`chat.ts`,
`product-options.ts`, `product-selling-units.ts` all filter `status = 'approved'`). Because most of
its 19 handlers only test that a seller row exists, a **suspended / pending seller could still
re-price, restock, re-image or edit a product** with a raw request; the velseller UI hid the screens,
which made it a frontend-only guard — exactly what `.ai/context/seller.md` forbids. Fix: the lookup
now filters `status = 'approved'` (one query, no handler change). Regression test:
`seller-access-authorization.test.ts` → "a suspended seller cannot edit a product or its stock"
(approved seller = 200 control; suspended = 403, and neither `products.price` nor `inventory` was
written). Proven failing before the fix (200) and passing after.

**Still open:** the seller-status rule is now enforced in five modules by convention, not by one
shared helper; consolidating them into `requireApprovedSeller` would remove the class of bug, but
that is a refactor outside this task's "fix only real problems" scope.
