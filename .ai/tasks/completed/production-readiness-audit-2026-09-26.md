# Task — Production-readiness audit, risk-ordered (13 gates)

Status: completed — **PRODUCTION: NOT READY.** Two gates have real release blockers
(Stripe TEST E2E `BLOCKED`, Production Browser E2E `BLOCKED`); two real defects were
found and **fixed** (unbounded seller list + dashboard downloading whole queues to
measure a badge).
Assigned: 2026-09-26 · Recorded: 2026-09-26T03:35:13Z
Base commit: `b18b5649e6e00d36ed44312a1d5b356ff7e9aa93` (= `origin/main`, verified after
`git fetch origin`; the sandbox was synchronized per `.ai/AI_RULES.md` §0 before
inspection, working tree clean, no other agent's work in progress)

## Objective

Walk the release gates high-risk → low-risk, fix only what does not pass, and report
BLOCKED/FAIL honestly instead of claiming PASS. No payment architecture change, no
duplicate tables, no mock substituted for a real E2E, no live Stripe key, no
production database.

## Allowed Scope (as executed)

Fixes were limited to admin-queue boundlessness (the two endpoints the VelCenter
dashboard uses as counters). **Zero lines changed** in `backend/routes/stripe.ts`,
`backend/lib/payment-config.ts`, `db/migrations/`, `db/*.sql`. No schema change, no
COD enablement, no auth/CORS/cookie/validation weakening, no endpoint removed.

---

## Gate table

| Gate | Status | Evidence | Remaining |
|---|---|---|---|
| 1. Stripe TEST E2E | **BLOCKED** | workspace `freebuff-env list` = `{"files":{}}`; **production** `GET /api/stripe/configured` → `{configured:false,mode:null,webhookConfigured:false,reason:"STRIPE_NOT_CONFIGURED"}`; `/api/payments/methods` → CARD/PROMPTPAY/COD all `enabled:false` | owner must add `sk_test_…` + `whsec_…` (see §1) |
| 2. Production Browser E2E | **BLOCKED** | no browser/automation in workspace. HTTP-level smoke of the four live frontends passed (below) | an authorized test account + a browser |
| 3. Google OAuth E2E | **BLOCKED** | no authorized Google test account; no browser | one dedicated test account |
| 4. R2 authenticated E2E | **BLOCKED** | `/api/health/r2` → `{configured:true,bucket:true,verify:true}` (config proven); presign→PUT→confirm still needs a signed-in session | production test account |
| 5. Production DB audit | **PARTIAL** | read-only ledger + constraint evidence already recorded (`AI_HANDOFF` §9) | §9.4's 4 low-severity catalog reads (`diag-neon-schema.yml` cannot be dispatched from a workspace: 403) |
| 6. Security boundary | **PASS (anonymous + bundle) / BLOCKED (role-crossing on production)** | 9 protected endpoints → **401 `UNAUTHORIZED`**, public reads → 200; 4 deployed bundles → **0** secret patterns; local DB-backed 401/403 test added | cross-role/cross-user on production needs accounts |
| 7. Product moderation pagination | **BLOCKED (tooling)** — dashboard side fixed | handler is `backend/routes/products.ts:3458` at byte **162,487**; the edit tool cannot match past ~55 KB (probe: 54.7 KB applied, 68.2/128.2/162.5 KB not) | a checkout without the size limit |
| 8. Seller pagination | **PASS** | `GET /api/admin/sellers` now bounded (default 25 / max 100, `pagination.total` exact); 9 static + **8 real DB/HTTP** tests pass | — |
| 9. Verification i18n | **BLOCKED (tooling)** | `review:` block offsets: `index.ts` 70,035 · `th.ts` 55,934 · `my.ts` 57,528 (all past the window); `en.ts` 30,478 is reachable | a checkout without the size limit |
| 10. Realtime | **PASS (audit)** | `CART_UPDATED`/`ORDER_CREATED`/`INVENTORY_UPDATED` → **0** publisher sites; `ORDER_UPDATED` 14, `PRODUCT_UPDATED` 1, `SELLER_UPDATED` 1 | dead channels documented, not deleted |
| 11. Full regression | **PASS** | see §11 — 577 pass / 2 skip / 0 fail with a disposable DB; 533 / 46 / 0 without | — |
| 12. Production smoke | **PARTIAL** | backend + R2 health 200, 4 frontends 200 on their real domains, SPA deep routes 200, public reads 200, checkout configuration exposed correctly | login/cart/order/seller/center authed reads need an account |
| 13. Release integrity | **PASS** | schema.sql ≡ run-sqleditor.sql, no `db/run-update.sql`, `diff --check` clean, only task files staged | — |

---

## 1. Stripe TEST E2E — BLOCKED

`BLOCKED — Stripe TEST credentials unavailable`. No Stripe API call, PaymentIntent,
PromptPay QR, webhook delivery or refund was executed — here or anywhere. No mock,
stub or recorded response was substituted, and none of the eight briefed flows
(Card / PromptPay / failed payment / duplicate checkout / concurrent checkout /
duplicate webhook / refund / duplicate refund) is reported as passing.

Two independent gates both say "not configured": the workspace defines no environment
keys at all, and **production itself** answers `STRIPE_NOT_CONFIGURED` with every
payment method disabled. So the Stripe flows could not be run even from production.

- Blocker: no Stripe TEST credential exists in this workspace or in production config.
- Needs: `STRIPE_SECRET_KEY` (`sk_test_…`), `STRIPE_PUBLISHABLE_KEY` (`pk_test_…`),
  `STRIPE_WEBHOOK_SECRET` (`whsec_…`), optionally `STRIPE_MODE=test`.
- Who: repository owner, in Settings → Environment (and the Render service env).
- Forbidden workaround: mocks/stubs presented as E2E, a live key, or a real card.

## 2. Production Browser E2E — BLOCKED (HTTP smoke PASSES)

No browser or automation exists in this workspace, so no screenshot, video or
viewport check was produced — none is fabricated. What *was* executed is read-only
HTTP against the real deployments:

| Surface | Result |
|---|---|
| `https://velshop.vercel.app` | **200** · `Velnox — VelShop · Commerce that remembers you` |
| `https://velseller.vercel.app` | **200** · `VelSeller — Merchant Management` |
| `https://velcenter.vercel.app` | **200** · `VelCenter — Admin Management` |
| `https://velnox-theta.vercel.app` | **200** · (corporate target named by the shipped VelShop bundle) |
| SPA deep routes (`/products`, `/dashboard`, `/center`) | **200** (the `vercel.json` rewrite works) |
| `https://velnox-api.onrender.com/api/health` | **200** `{"status":"ok"}` |
| `…/api/health/r2` | **200** `{configured:true,bucket:true,verify:true}` |

### Finding 2a — the documented custom domains do not resolve (owner action)

`packages/shared/src/lib/sites.ts` defaults four production hosts. As of this run the
`velnox.com` zone is **unresolvable from public DNS**: Google DoH answers `Status: 2`
(SERVFAIL) with `Name servers refused query (lame delegation?) [64.99.97.38,
64.98.148.18]` — i.e. the registrar's NS delegation is broken, so `velnox.com`,
`shop.velnox.com`, `seller.velnox.com` and `center.velnox.com` all fail to resolve.
`center.velnx.com` is differently wrong: `Status: 3` (NXDOMAIN) while `velnx.com` is
delegated to Cloudflare — that host name has no record.

**Severity: latent, not currently breaking production.** The four deployed bundles were
downloaded and searched: they contain **no** `*.velnox.com` / `*.velnx.com` reference
at all — each Vercel project sets `VITE_API_URL` / `VITE_VELSHOP_URL` /
`VITE_VELSELLER_URL` / `VITE_VELCENTER_URL` / `VITE_CORPORATE_URL`, so production
navigation points at live `*.vercel.app` hosts. The risk is the *defaults*: any
deployment built without those overrides links to dead hosts, and
`backend/routes/stripe.ts:872` falls back to `https://velshop.vercel.app` when
`VITE_VELSHOP_URL` is unset.

- Needs: fix the `velnox.com` NS delegation (or stop treating the `sites.ts` defaults
  as production domains). Not changed here — DNS/registrar is an owner action and the
  defaults are documented as overridable.

## 3–4. Google OAuth + R2 authenticated E2E — BLOCKED

Both require an authorized signed-in account and a browser; neither exists here.
R2 *configuration* is independently proven (health endpoint above); the
presign → PUT → confirm → media-row chain is **not** executed and is not reported as
working.

## 5. Production DB audit — PARTIAL

Already-recorded read-only production evidence stands (`AI_HANDOFF` §9: 49 migrations,
ledger matches `main` exactly, 041–046 applied). No SELECT can be run from this
workspace by design, and `diag-neon-schema.yml` still cannot be dispatched
(`403 Resource not accessible by integration`). The four remaining low-severity
catalog reads are §9.4 items 1–4 — unchanged, not newly failed.

## 6. Security boundary — PASS where provable

Executed against **production** (read-only GETs, no credentials):

- Anonymous → **401 `UNAUTHORIZED`**: `/api/admin/sellers`,
  `/api/admin/products/moderation`, `/api/admin/dashboard/counts`,
  `/api/admin/verifications`, `/api/customer/cart`, `/api/customer/orders`,
  `/api/seller/products`, `/api/seller/status`, `/api/customer/profile`.
- Public reads still open: `/api/shops`, `/api/categories`, `/api/products/catalog` → 200.
- Frontend bundle secret scan (all four deployed bundles, 1.27 MB total):
  `sk_live_` 0 · `sk_test_` 0 · `whsec_` 0 · `R2_SECRET` 0 · `BEGIN PRIVATE KEY` 0 ·
  `postgres://|postgresql://` 0 · `JWT_SECRET` 0 · `CLIENT_SECRET` 0.
- Log/credential handling in this pass: no secret value was read, printed or logged;
  only env-var **names** were inspected (`freebuff-env list`).

**Not verified:** wrong-role → 403 and cross-user/cross-seller ownership on
production (needs sessions). Those are covered by the DB-backed suite
(`center-rbac`, `security-hardening`, and the new 403 case) which passes, but that is
test-tier, not production-tier evidence.

## 7. Product moderation pagination — BLOCKED (tooling), dashboard half FIXED

`GET /api/admin/products/moderation` (`backend/routes/products.ts:3458`) still has
**no LIMIT** and returns every matching product with images.

The handler sits at **byte 162,487** of a 181 KB file. The edit tool's match window was
measured, not assumed — using throwaway copies of the real files:

| Probe offset | File | Result |
|---|---|---|
| 19,586 B | `Center.tsx` copy | **applied** |
| 29,105 B | `seller.ts` copy | **applied** |
| 54,710 B | `seller.ts` copy | **applied** |
| 68,200 B | `Center.tsx` copy | not found |
| 128,261 B | `Center.tsx` copy | not found |
| 162,487 B | `products.ts` copy | not found |

So the window ends between ~54.8 KB and 68.2 KB — consistent with the documented
~55 KB. The handler cannot be edited here, and a route-level "duplicate endpoint"
override would violate the no-duplicate-API rule, so the endpoint is left **exactly as
it was** and reported BLOCKED.

What *was* fixed: the VelCenter **dashboard** used to call this endpoint on every load
and every realtime event purely to count `pending_review` rows — downloading the whole
product list into the browser to render one badge. It now reads the exact count from
the existing `GET /api/admin/dashboard/counts` mapping (one `COUNT(*)`), so the
unbounded endpoint's only production caller is the moderation queue UI itself, which
still needs the rows. Still open: the endpoint's missing LIMIT and the queue's
client-side rendering of the full result.

## 8. Seller pagination — PASS (fixed + executed)

`GET /api/admin/sellers` returned **every** seller with the `users` / `shops` /
`seller_settings` joins and two correlated `seller_verifications` subqueries, with no
LIMIT, on every VelCenter load and every realtime refetch.

Root cause + fix: the endpoint was unbounded *because* its only consumer measured the
badge with `(sellerRows ?? []).filter(s => s.status === "pending").length`. The list is
now bounded and the counter reads an exact count — the same shape the sibling
verification queue already uses.

- `backend/routes/seller.ts` — `parseLimit`/`parsePage`/`pageOffset`/`pageMeta`,
  `COUNT(*) OVER() AS total_count`, `ORDER BY s.created_at DESC, s.id DESC`,
  `LIMIT … OFFSET …`, a fallback count query for a page past the end, and
  `data: { sellers, pagination }`.
- `packages/shared/src/lib/api-routes.ts` — `api.centerAdmin.sellerList` forwards
  `page`/`limit`.
- `apps/velcenter/src/pages/Center.tsx` — `pendingSellers` ←
  `sellerListAction({status:"pending",limit:1})` + `pagination.total`;
  `pendingProducts` ← `dashboardCountsAction()`; the two full-queue downloads are gone.

Executed evidence (real route, real session cookies, disposable PostgreSQL):

```
backend/tests/admin-sellers-pagination.test.ts     8 pass / 0 fail
  no cookie → 401 UNAUTHORIZED
  customer (no sellers.manage) → 403 FORBIDDEN
  limit=1 → sellers.length 1, pagination.total 30   ← the badge's exactness
  limit absent → 25 rows, total 30, totalPages 2, hasMore true
  limit=100000 → pagination.limit clamped to 100
  page 1 vs page 2 (limit 10) → 10 + 10 rows, no id overlap
  page=99&limit=1 → 0 rows, pagination.total still 30  ← fallback count query
  payload contains no `total_count`
```

Static contract guards were added to `backend/tests/admin-queue-pagination.test.ts`
(+9 cases) so the unbounded pattern cannot return: the old
`` ORDER BY s.created_at DESC`,` `` tail, a missing count, a leaked window column, and
both counters reverting to `Array.filter(...).length` all now fail the suite.

## 9. Verification i18n — BLOCKED (tooling)

`apps/velcenter/src/components/SellerVerificationQueue.tsx` (16.5 KB, editable) carries
hardcoded Thai UI text (toasts and error copy) while the adjacent
`VerificationReviewDialog.tsx` is localized. Migrating it needs new `review.*` keys,
and the locale files' `review:` blocks sit past the edit window:

| File | Size | `review:` at |
|---|---|---|
| `locales/index.ts` | 71,904 B | **70,035 B** |
| `locales/th.ts` | 104,394 B | **55,934 B** |
| `locales/en.ts` | 56,339 B | 30,478 B (reachable) |
| `locales/my.ts` | 97,759 B | **57,528 B** |

Three of the four files cannot be edited here, and `i18n:check` enforces th=en=my
parity, so a partial migration would break the build. Nothing was changed; no second
translation system was created.

**Finding 9a — one corrupted user-facing string** (not fixed: the correct wording is a
copy decision, not a code decision):
`SellerVerificationQueue.tsx:177` → `toast.success("ระงับและลบrêtailer แล้ว")` — the
only occurrence of `ê` in the repository. The action beside it is `revokeShop`, so the
likely intended text is `ระงับและลบร้านค้าแล้ว`. Owner should confirm the wording.

## 10. Realtime — PASS (audit only)

Channels are signals, never payloads: consumers refetch from the API. Publisher audit
(`CHANNELS.*` outside tests):

| Channel | Publishers | Verdict |
|---|---|---|
| `order:updated` | 14 | live |
| `product:updated` | 1 | live |
| `seller:updated` | 1 | live |
| **`cart:updated`** | **0** | dead — subscribe-only |
| **`order:created`** | **0** | dead — subscribe-only |
| **`inventory:updated`** | **0** | dead — subscribe-only |

Each dead channel exists only in `CHANNELS` (`backend/realtime/index.ts:222–226`) and in
the subscribe allowlist (`:127–131`); nothing broadcasts them and no frontend
subscribes. Documented as legacy/dead — **not deleted**, because removal is not what the
brief asked for and a dependency check is a separate change. The WebSocket upgrade
boundary could not be probed from here (a plain HTTP request to `/ws` returns the
Express 404, and no WS client exists in this workspace) → not claimed.

## 11. Automated regression suite

| Run | Result |
|---|---|
| `bun test backend/tests` **with** disposable PostgreSQL + `JWT_SECRET` | **577 pass / 2 skip / 0 fail** (579 tests, 25 files) |
| `bun test backend/tests` **without** a database (skip path must stay green) | **533 pass / 46 skip / 0 fail** |
| `backend/tests/admin-sellers-pagination.test.ts` (with DB) | 8 pass / 0 fail |
| `backend/tests/admin-queue-pagination.test.ts` | 30 pass / 0 fail |
| backend `bunx tsc --noEmit` | exit 0 |
| `bun run typecheck` (4 apps) | 4/4 exit 0 |
| `bun run i18n:check` | th=1295 en=1295 my=1295, parity |
| `db/schema.sql` vs `db/run-sqleditor.sql` | identical |
| `db/run-update.sql` | absent |
| `git diff --check` | clean |

The 2 skips are the pre-existing R2-credential upload cases. The database used was a
**disposable local PostgreSQL 14** (`velnox_test`, 59 tables from
`db/run-sqleditor.sql`) reached through `TEST_DATABASE_URL`; the production-looking
`DATABASE_URL` is refused by `backend/db/test-database.ts`, so no production row could
be read or written.

## 12. Production smoke — PARTIAL

Executed (read-only): backend health 200, R2 health 200 (configured/bucket/verify),
4 frontends 200, SPA deep routes 200, `/api/shops` 200, `/api/products/catalog` 200,
`/api/stripe/configured` 200 with `reason=STRIPE_NOT_CONFIGURED`,
`/api/payments/methods` 200 showing CARD/PROMPTPAY/COD **all disabled** and
`cod:{enabled:false,customerSelectable:false}`.

BLOCKED (needs an authorized account): login, cart, checkout execution, order read,
seller read, VelCenter permissions, realtime signal→refetch, mobile viewport. **No
real-money payment was attempted** — Stripe is not configured, so none is possible.

## 13. Release integrity

`git status` showed only the five task files; `git diff --check` clean; no secret in the
diff; no `db/run-update.sql`; canonical schema files identical; no production database
or live key touched. Commit scope: admin-queue bounding + its tests + docs.

---

## What is NOT proven (do not read BLOCKED as PASS)

- Any Stripe round trip (Card, PromptPay, refund, real webhook delivery, checkout
  idempotency replay, single-active-session race) — **BLOCKED**, no credential exists.
- Any browser/UI behaviour: responsive 320–430 px, the object-URL preview, the R2
  presign→PUT→confirm round trip, WebSocket signal→refetch, Google OAuth
  (first/repeat login, logout, cookie flags, expired session).
- Production cross-role authorization (wrong role → 403, cross-user ownership) and the
  production data itself (SELECT-only audit is not possible from a workspace).
- `GET /api/admin/products/moderation` remains unbounded (handler uneditable here).
- VelCenter's verification-queue copy remains hardcoded Thai (locale files uneditable
  here), and the `velnox.com` delegation is still broken.

**PRODUCTION PAYMENT READINESS: NOT CLAIMED.**
