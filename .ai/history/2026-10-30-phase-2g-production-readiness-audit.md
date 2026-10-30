# Phase 2G — Production Readiness & Real Browser Verification (Audit Only)

**Date:** 2026-10-30
**Repository:** `EnJirad/velnox-marketplace` · **Branch:** `main`
**Audited commit SHA:** `9c38ae35019d1a4b4ace7127327e85db22bb30cf`
**Audit type:** read-only inspection + existing automated checks. **No application, backend, SQL, env, dependency, CI or hosting configuration was changed.**

---

## 1. Preflight and audited revision

| Check | Result |
|---|---|
| `git fetch origin` | run; remote `main` = `9c38ae35019d1a4b4ace7127327e85db22bb30cf` |
| Local branch | `main` |
| `git rev-parse HEAD` | `9c38ae35019d1a4b4ace7127327e85db22bb30cf` |
| `HEAD` vs `origin/main` | **identical** (0 ahead / 0 behind) |
| Working tree at audit start | **clean** (`git status --porcelain` empty) |
| Existing user changes | none present; nothing reset, stashed or discarded |

**Confirmed by test:** preflight commands exited 0 and the two SHAs matched exactly.

Rules and context read before inspection: `AGENTS.md`, `.ai/AI_RULES.md`, `.ai/README.md`, `.ai/AI_HANDOFF.md` (through §85), the `.ai/context/` subsystem docs relevant to the scope, and the Phase 2E / 2F reports. Phase 2F's closing state was used as the baseline.

---

## 2. Audit scope

Inspected without modification:

- **VelShop** — home/discovery, catalog search & category navigation, product detail/variants, cart, checkout, Stripe test-mode configuration, order creation/history, wishlist, profile/addresses, Google auth, loading/empty/error states.
- **VelSeller** — authentication/authorization, onboarding/verification, product create/edit, R2 image intents/confirm, inventory & variants, order management, shipping/fulfilment, dashboard metrics.
- **VelCenter** — admin auth/role enforcement, seller approval/verification, product/order administration, user management, metrics, ownership/permission boundaries.
- **Corporate app** — available features, auth posture, cross-app navigation.
- **Backend/shared** — route inventory, validation/error handling, authN/authZ, ownership, CORS/cookies, DB access/transactions, WebSocket, chat/notifications, logging, env requirements.
- **Security** — committed secrets, authorization assumptions, IDOR, server-side validation, sensitive responses/logs, uploads, payment configuration, production/test separation.

Inventory: **164 backend route registrations** across 14 modules; **20 VelShop pages / 22 paths**, **8 VelSeller pages / 11 paths**, **1 VelCenter page / 3 paths**, **4 corporate pages / 12 paths**.

---

## 3. Overall readiness summary

**Verdict: staging-capable; NOT ready for a public production launch.**

The core money and ownership paths are unusually well defended for this stage: server-derived payment amounts, signature-verified/idempotent Stripe webhooks, deny-by-default center permissions resolved from the database, seller-approval gates on every seller module, parameterized SQL, and a green automated battery (1359 pass / 6 pre-existing skip / 0 fail). The blockers are concentrated in **identity hardening, verification coverage, and a few single-process assumptions**:

1. OAuth `state` is user-controlled data, not a CSRF nonce → **login CSRF** (High).
2. **Production DB verification cannot run** (canonical secret absent) and **no real-browser/E2E verification exists** in the repo or CI.
3. Reliability constructs that are per-process (chat send dedupe, rate limiting, WS revocation cache) and a boot-time DDL path (`ensureVariantTables`) undermine the "Neon is the source of truth / startup is read-only" rules.
4. No outbox dispatcher, same-millisecond pagination loss, and an O(n) seller unread badge remain from earlier phases.

There were **no Critical findings**, no committed live secrets, and no confirmed IDOR/auth-bypass path.

| Severity | Count |
|---|---|
| Critical | **0** |
| High | **1** |
| Medium | **12** |
| Low | **8** |
| Informational | **7** |

---

## 4. Findings — Critical

**None.** No confirmed authentication bypass, payment-total manipulation, cross-tenant data leak, or committed credential was found.

---

## 5. Findings — High

### H-1 · OAuth `state` is not a validated CSRF nonce (login CSRF)

- **Location:** `backend/routes/auth.ts:432-433` (creation), `:451-465` (callback decode), `:483-485` (session issued + redirect).
- **Expected:** a cryptographically random, single-use `state` bound to the initiating browser (short-lived httpOnly cookie), compared before exchanging the code; `returnTo` validated separately.
- **Actual:** `state = base64url(JSON.stringify({ returnTo }))`. The callback merely base64-decodes it to recover `returnTo`; it is never stored, signed, compared, or expired. Any valid Google authorization `code` is accepted with any (or no) `state`.
- **Evidence / reproduction:** `GET /auth/google` returns a `state` that decodes to plain JSON, e.g. `{"returnTo":"/"}`. An attacker can complete consent for their own Google account, then make a victim's browser open `/auth/google/callback?code=…&state=…`; the victim receives a valid `velnox_session` for the **attacker's** account. (Full browser proof not run — see §9.)
- **Impact:** login CSRF / session swapping. A victim may enter a delivery address, phone, or saved payment context inside the attacker's account, which the attacker can later read; order and chat actions are attributed to the attacker's identity. Google OAuth is the only customer login, so this is the primary identity boundary.
- **Label:** **Confirmed by source inspection.** Not tested end-to-end (no browser tooling / test accounts).

---

## 6. Findings — Medium

### Security & identity

| ID | Location | Expected → actual | Impact | Label |
|---|---|---|---|---|
| M-1 | `backend/middleware/auth.ts:45-68` | DB failure during revocation check → deny/retry. **Actual:** the `catch` returns "not revoked" (fail-open); only the local in-memory cache can still revoke. | During a DB incident, a revoked-but-unexpired JWT is accepted by `requireAuth` until expiry (7 d). Availability-coupled. | Confirmed by source inspection; not tested |
| M-2 | `backend/realtime/index.ts:117, 164-179`; `:78-89` | Revocation/role changes reflected immediately for live sockets. **Actual:** handshake and the 30 s sweep call `isTokenRevokedSync` (in-memory only); roles refresh every 30 s and failed lookups keep the previous role. | Demoted/suspended center staff can keep private channels for up to 30 s; a logout performed on another instance does not close the socket until its JWT is rejected on reconnect. Known risk #3. | Confirmed by source inspection; not tested |
| M-3 | `backend/routes/auth.ts:509-524` | `/api/auth/me` honours revocation. **Actual:** a 30 s profile cache is answered before the `revoked_tokens` check (comment explicitly accepts the window). | Up to 30 s of stale identity/role in the UI after logout/role change; mutation endpoints still check revocation. | Confirmed by source inspection |

### Reliability & operations

| ID | Location | Expected → actual | Impact | Label |
|---|---|---|---|---|
| M-4 | `backend/server.ts:127-196` | Startup performs no DDL; schema arrives via `db/schema.sql` + `db/run-sqleditor.sql`. **Actual:** `ensureVariantTables()` executes `CREATE TABLE IF NOT EXISTS …` on every boot and logs but continues on failure. | Runtime role needs DDL privileges; a missing migration is silently papered over (or fails silently); schema authority is split. The variant tables already exist in both SQL sources (`db/schema.sql:282`, `db/run-sqleditor.sql:305`), so the boot path is redundant. | Confirmed by source inspection |
| M-5 | `backend/routes/chat.ts:288-313`, key at `:557-577` | Send idempotency survives restart and multiple instances. **Actual:** dedupe uses an in-process `Map`; no DB unique constraint on the message key. | Duplicate messages after a restart/redeploy or when two instances serve the same conversation. Known risk #1. | Confirmed by source inspection |
| M-6 | `backend/lib/order-events.ts:32-33`; `db/schema.sql:1135-1163` | Outbox rows are drained and retried. **Actual:** events are inserted, but no dispatcher/worker exists; no retention policy is visible. | `outbox_events` grows without bound; consumers cannot replay; delivery depends on synchronous code paths. Known risk #2. | Confirmed by source inspection |
| M-7 | `backend/routes/chat.ts:142-150` | Stable pagination. **Actual:** cursor filter is `created_at < $n` with millisecond timestamps; rows sharing the cursor millisecond are skipped. | Message loss at page boundaries during bursts. Known risk #5. | Confirmed by source inspection |
| M-8 | `packages/shared/src/hooks/use-chat-unread.ts:84-95` | Dedicated unread-count endpoint. **Actual:** seller badge downloads `GET /api/seller/conversations` (full list) and sums `unreadCount` in the browser on each refresh. | Payload/latency grows with conversation count; noisy on mobile. Known risk #4. | Confirmed by source inspection |
| M-9 | `backend/middleware/rate-limit.ts:5-13` | Shared-store limiting for a horizontally scaled API. **Actual:** bounded in-memory fixed window, explicitly documented as per-process. | Limits multiply by instance count; a distributed attacker gets N× the allowance. | Confirmed by source inspection |
| M-10 | `packages/shared/src/lib/sites.ts:21` | `velcenter` default is `https://center.velnox.com`. **Actual:** fallback is `https://center.velnx.com` (typo; the type comment says `center.velnox.com`). | When `VITE_VELCENTER_URL` is unset, staff signing in on VelShop/VelSeller are sent to a non-resolving domain (DNS probe from this sandbox failed; deployment env not inspectable). | Potential risk — deployment-dependent |
| M-11 | CI workflow `production-db-verify` (latest run `40986922337`) | Production schema/data verification runs on schedule. **Actual:** every recent run fails with `BLOCKED: NEON_PRODUCTION_DATABASE_URL is not configured.` | Production drift, missing tables, or data-integrity regressions cannot be detected by CI. **This is a blocked verification, not a bypass.** Owner must add the canonical secret. | Confirmed by CI logs; production DB not accessed |
| M-12 | repo-wide (no Playwright/Cypress config or spec; preview `running:false`) | A repeatable real-browser journey suite exists for checkout, seller onboarding, and admin. **Actual:** none exists; only source-level and API-level tests. | Regressions in rendered UI, routing, and cross-app auth can reach production undetected. See §9. | Not tested / blocked |

---

## 7. Findings — Low

| ID | Location | Finding | Impact | Label |
|---|---|---|---|---|
| L-1 | `backend/routes/chat.ts:276-283` | Read bound uses `… + interval '1 millisecond'`; a residual race at the boundary remains (explicitly documented in code). | A read receipt can be recorded marginally late/early relative to a message. Known risk #6. | Confirmed by source inspection |
| L-2 | `backend/server.ts:61-73` | `http://localhost:5173-5176` are always merged into the production CORS/origin allowlist. | Only exploitable if a victim runs an attacker-controlled site on the victim's own localhost; low practical risk, but production should not trust dev origins. | Confirmed by source inspection |
| L-3 | `backend/routes/admin.ts:106-107` | Comment says "Timing-safe comparison"; code uses plain `bootstrapCode === BOOTSTRAP_SECRET`. | Remote timing attack is impractical (single-shot, owner-only, rate-limited), but the comment is false and the primitive is wrong. | Confirmed by source inspection |
| L-4 | `backend/routes/upload.ts:97-99` | `isStoredContentTypeAllowed` returns `true` when R2 reports no content type. | A presigned upload whose stored object lacks a MIME type passes confirmation; the presign step still validates the declared type. | Confirmed by source inspection |
| L-5 | `backend/routes/auth.ts:169-200` | Google identity is linked to an existing account by lowercased email; `email_verified` is never checked. | Requires Google to assert an unverified address that also matches an existing account — narrow, but the check is standard defense-in-depth. | Potential risk / requires verification |
| L-6 | `apps/velshop/src/pages/ShopHome.tsx:120-135, 328-334` | Catalog fetch errors are converted to `data = null`, which renders the same "no products" empty state as an empty catalog. | A backend outage looks like an empty marketplace to buyers; no retry affordance. | Confirmed by source inspection |
| L-7 | `backend/routes/products.ts:2127-2132` | Search is `name ILIKE '%q%' OR description ILIKE '%q%'` with no trigram index. | Full scan per search as the catalog grows; acceptable now, degrades later. | Potential risk / requires verification |
| L-8 | backend-wide (route `catch` blocks, `backend/server.ts` startup logs) | Operational logging is `console.*` only — no request IDs, structured fields, metrics, or alert hooks. | Incident triage depends on Render log search; no SLO/latency visibility. | Confirmed by source inspection |

---

## 8. Findings — Informational

| ID | Finding | Label |
|---|---|---|
| I-1 | **No committed live secrets.** A repo-wide pattern scan for `sk_live_`, `rk_live_`, AWS keys, and private-key headers matched only two test files (`backend/tests/checkout-test-payment-rail.test.ts`, `backend/tests/payment-foundation.test.ts`) containing dummy refusal fixtures. No values are reproduced here. | Confirmed by source inspection (filenames only) |
| I-2 | **All existing automated checks pass** — see §10. | Confirmed by test |
| I-3 | **Payments are in test mode by design.** Live read-only probe: `/api/stripe/configured?selfTest=1` → `configured:true, mode:"test", webhookConfigured:true, shapeUsable:true, selfTest.verified:true`; `/api/payments/methods` → CARD + PROMPTPAY enabled, COD disabled. No secret or publishable key is reproduced. | Confirmed by read-only HTTP probe |
| I-4 | **Corporate app is unauthenticated marketing by design** (no accounts, no server form); contact uses `mailto:`. No broken authenticated flow exists to test. | Confirmed by source inspection |
| I-5 | **Env documentation gap:** `GOOGLE_REDIRECT_URI` is required at startup (`backend/server.ts:459`) and documented in `README.md` / `INSTALLATION.md`, but is absent from `docs/ENVIRONMENT.md`. | Confirmed by source inspection |
| I-6 | **Schema duplication is real but contained:** both canonical SQL files already create `product_variant_images` and the other variant tables; the boot-time DDL (M-4) is therefore redundant. | Confirmed by source inspection |
| I-7 | **Single-instance assumptions are documented in code** (rate limiter, WS sweep, chat dedupe), which is good engineering hygiene but does not remove the scaling risks. | Confirmed by source inspection |

---

## 9. Browser / E2E verification status

**BROWSER/E2E: NOT RUN — BLOCKED.**

- No browser-automation tool, driver, or MCP browser is available in this environment.
- `freebuff-preview status` → `running:false`, `previewCommand:null`; no preview server is configured for this monorepo.
- Deployed frontend hostnames (`velnox.com`, `shop.velnox.com`, `seller.velnox.com`, `center.velnox.com`, `center.velnx.com`) **do not resolve from this sandbox**. This is a sandbox-network limitation, not evidence that the sites are down.
- No test/staging accounts were available; no real customer account was used; no payment was initiated.

**What remains blocked:** rendered landing/catalog pages, product-detail variants, cart/checkout UI, Google sign-in redirect, seller onboarding wizard, R2 image upload UI, seller order actions, VelCenter tab permission rendering, responsive layouts, console/runtime errors, and cross-app redirects.

**What was verified instead:** source-level rendering logic and state handling, plus read-only HTTP probes of the deployed API (`/api/health` → `{"status":"ok"}`; Stripe test-mode self-test as in I-3). These are **not** browser tests.

**Setup needed for a real run:** a Playwright (or equivalent) harness against a staging deployment, seeded test users (customer, approved seller, staff with partial permissions, owner), Stripe test-mode keys, and a disposable database. Do not point it at production.

---

## 10. Automated verification results

All commands were run at the audited SHA, non-destructively.

| Check | Command | Result |
|---|---|---|
| Root typecheck | `bun run typecheck` | **PASS** — 4/4 workspaces, exit 0 |
| Backend typecheck | `cd backend && bunx tsc --noEmit` | **PASS** — exit 0 |
| App builds | `bun run build:apps` | **PASS** — 4/4, exit 0 |
| i18n parity | `bun run i18n:check` | **PASS** — th/en/my = 1257 / 1257 / 1257 |
| Backend suite (disposable PG14) | `cd backend && TEST_DATABASE_URL="postgresql://velnox_test:…@127.0.0.1:5432/velnox_test?sslmode=disable" bun test tests` | **PASS** — **1359 pass / 6 skip / 0 fail** (1365 tests, 67 files, 14,158 expectations) |
| Whitespace/conflict check | `git diff --check` | **PASS** — no output |
| CI test workflow | runs `40986922370` (code `fe7927b`) and `40987344815` (audited docs SHA) | **success** — 1363 pass / 2 skip / 0 fail in CI |
| CI production DB verify | latest `40986922337` | **FAIL / BLOCKED** — missing `NEON_PRODUCTION_DATABASE_URL` |

**Notes:** the 6 local skips are pre-existing (live/external-credential cases) and were neither added nor removed. The local database is a disposable PostgreSQL 14 instance created for Phase 2F; **no production database was contacted**. No test was weakened, skipped, or rewritten.

---

## 11. Known risks from earlier phases — current status

| # | Risk | Status | Evidence |
|---|---|---|---|
| 1 | Chat send dedupe is in-process and lost on restart | **Still present** | `backend/routes/chat.ts:288-313`, key `:557-577`; no DB unique constraint |
| 2 | Chat/order outbox drain worker not implemented | **Still present** | `backend/lib/order-events.ts:32-33`; table `db/schema.sql:1135-1163` |
| 3 | Private role refresh delayed ~30 s | **Still present** | `backend/realtime/index.ts:78-89` (sweep), `:164-179` |
| 4 | Seller unread badge refetches the full conversation list | **Still present** | `packages/shared/src/hooks/use-chat-unread.ts:84-95` |
| 5 | Same-millisecond pagination can skip messages | **Still present** | `backend/routes/chat.ts:142-150` |
| 6 | Read-bound residual race at 1 ms | **Still present (documented)** | `backend/routes/chat.ts:276-283` |

---

## 12. Production database verification status

**BLOCKED — not attempted, not bypassed.**

- Latest scheduled `production-db-verify` run `40986922337` logs `BLOCKED: NEON_PRODUCTION_DATABASE_URL is not configured.`
- The secret requirement was **not** worked around, no credential was invented or requested, and **no connection to the production database was made** in this phase.
- Consequence: production schema drift and data-integrity state are **unverified** (see M-11). This must be resolved by the owner in repository/CI secrets before production sign-off.

---

## 13. Recommended next phase (priority order)

1. **Phase 2H — Authentication hardening + staging browser E2E (highest priority).**
   - Fix H-1: random single-use `state` in an httpOnly cookie, constant-time compare, then separate `returnTo` validation; add unit/integration coverage for replayed/absent/mismatched state.
   - Restore M-11 by adding `NEON_PRODUCTION_DATABASE_URL` to CI secrets (owner action) and making a blocked run fail loudly.
   - Stand up Playwright against staging with seeded customer/seller/staff/owner accounts; cover sign-in, catalog, product variants, cart→checkout (test mode), seller onboarding, product publish, order status, and center permissions. Record traces/screenshots as evidence.
2. **Schema authority** — replace boot-time `ensureVariantTables()` with a migration check (fail fast instead of silent DDL); add a documented migration runner. Fix M-4.
3. **Durability & scale** — DB-backed chat send dedupe (M-5); outbox dispatcher + retention (M-6); composite pagination cursor (M-7); server-side unread count endpoint (M-8); shared rate-limit/revocation store (M-9, M-1).
4. **Hardening cleanup** — fix `SITE_URLS.velcenter` (M-10), timing-safe bootstrap compare (L-3), missing-content-type rejection (L-4), `email_verified` check (L-5), error-vs-empty UI on home (L-6), structured logging/request IDs (L-8).
5. **Docs** — add `GOOGLE_REDIRECT_URI` to `docs/ENVIRONMENT.md` (I-5); document the production-readiness gates and remaining known risks.

**Do not start Phase 2H in this pass.** Phase 2G stops here.

---

## Appendix — Boundaries honoured

- No application/backend source change; no SQL/schema change; no env/secret change; no dependency install/upgrade; no CI/CD or Vercel/Render configuration change.
- No production DB access, no destructive SQL, no real payment, no VelRepeat reintroduction.
- Only documentation files changed after the audit: this report and `.ai/AI_HANDOFF.md` §86.
