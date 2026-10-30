# Phase 2H — OAuth State Hardening + Verification Preparation

**Date / time:** 2026-10-30 (UTC; sandbox clock 06:12 UTC at final verification)
**Agent:** Buffy (Codebuff)
**Repository:** `EnJirad/velnox-marketplace` · **Branch:** `main`
**Report type:** implementation + verification (Workstreams A/B/C). Phase 2G finding **H-1** only.

---

## 1. Starting SHA

`5039f94b730c10effb4f53aaf39bbc9ae09d1e04`

Preflight at the start of the phase:

| Check | Result |
|---|---|
| `git fetch origin --prune` | run successfully |
| `git rev-parse origin/main` | `5039f94b730c10effb4f53aaf39bbc9ae09d1e04` |
| `git rev-parse HEAD` | `5039f94b730c10effb4f53aaf39bbc9ae09d1e04` |
| Branch | `main` |
| `git rev-list --left-right --count HEAD...origin/main` | `0	0` (in sync) |
| Working tree | **clean** (`git status --porcelain` empty) |
| User changes at risk | none present; nothing reset, stashed, discarded or force-pushed |

## 2. Final SHA

**Code commit:** `1e41ebc964f48de8ff6ea8f6804b9d3b5f3f3033` — `fix(auth): harden oauth state validation`
(5 files: the new state module, the route wiring, and 3 test files).

**Final docs SHA:** the `docs(ai): record phase 2h oauth hardening` commit that contains this file.
Because a file cannot contain its own commit hash, find it with:

```bash
git log -1 --format=%H -- .ai/history/2026-10-30-phase-2h-oauth-state-hardening.md
```

The phase response reports both SHAs and the verified remote SHA.

## 3. Original vulnerability (Phase 2G H-1)

`backend/routes/auth.ts` built the OAuth `state` parameter as:

```ts
const state = Buffer.from(JSON.stringify({ returnTo })).toString("base64url");
```

and the callback merely base64-decoded it to recover `returnTo`. The value was never stored, signed,
compared or expired, so **any valid Google authorization `code` was accepted with any (or no)
`state`**.

Attack: complete consent for the attacker's own Google account, then make a victim's browser open
`/auth/google/callback?code=…&state=…`. The victim receives a valid `velnox_session` for the
**attacker's** account (login CSRF / session swapping). Data the victim then enters — delivery
address, phone, saved payment context — becomes readable by the attacker, and orders/chat are
attributed to the attacker's identity. Google OAuth is the only customer login, so this is the
primary identity boundary.

Label in Phase 2G: **confirmed by source inspection**; no browser proof existed then.

## 4. Root cause

The parameter was treated as a *transport envelope for `returnTo`* rather than as a *CSRF token*.
Three design errors followed from that:

1. The value was **self-describing and user-controlled** — an attacker could mint any value.
2. The callback **never had an expected value to compare against** — there was no server-side or
   browser-bound record of the flow that was started.
3. Because nothing was stored, there was **nothing to expire and nothing to consume**.

`returnTo` being inside `state` is what made the shortcut attractive; separating the two concerns
removes the reason to encode data into the CSRF token at all.

## 5. Implementation

### New module — `backend/lib/oauth-state.ts`

- **State generation** — `crypto.randomBytes(32).toString("base64url")`: 43 characters, 256 bits
  from the platform CSPRNG. No `Math.random`, no timestamp, no user id, no email, no `returnTo`, no
  hash of user data.
- **Browser binding** — the nonce is written into a signed envelope
  `{ n: nonce, r: sanitized returnTo, e: expiry }`, base64url-encoded and HMAC-SHA256 signed.
  The envelope is stored in a temporary cookie `velnox_oauth_state`:
  `httpOnly`, `Secure` when `NODE_ENV=production`, `SameSite=Lax`, `Path=/auth`, `Max-Age=600`
  (10 minutes). `SameSite=Lax` is appropriate because the callback is a top-level GET navigation;
  it is stricter than the `None` required by the session cookie.
- **Signing key** — `OAUTH_STATE_SECRET` when set, otherwise `JWT_SECRET` (no new required env var).
  Missing key **fails closed**: generation throws and verification rejects.
- **Validation** — signature first, then envelope shape, then expiry, then a
  `crypto.timingSafeEqual` comparison (SHA-256 digests, so length is not leaked) between the returned
  `state` and the cookie nonce.
- **Rejection taxonomy** — `missing_state`, `missing_cookie`, `malformed_cookie`, `bad_signature`,
  `expired`, `mismatch`. Only the reason is ever logged.
- **`returnTo`** — `sanitizeReturnTo()` accepts only an internal absolute path: must start with `/`,
  must not start with `//`, must not contain `\` or control characters, must not exceed 512 chars,
  and is re-parsed against an internal origin so normalization (`/..//host`, `%2e%2e`) cannot escape.
  Absolute URLs, `javascript:`/`data:` payloads and non-strings collapse to `/`.

### Route changes — `backend/routes/auth.ts`

`GET /auth/google`:

```ts
const start = createOAuthState(req.query.returnTo);   // opaque nonce + signed cookie value
res.cookie(OAUTH_STATE_COOKIE, start.cookieValue, oauthStateCookieOptions(...));
// state = start.state  → sent to Google; returnTo is NOT in it
```

`GET /auth/google/callback`:

1. Treats repeated/array query params as absent.
2. **Consumes** the state cookie (`res.clearCookie`, same path/attributes) before validating — so a
   second callback in the same browser has no cookie, even when Google returned an error.
3. Rejects without a `code` (existing 400).
4. Calls `validateOAuthState({ returnedState, cookieValue })`. On failure it redirects to
   `/auth?error=google_state_invalid` and **returns before `exchangeCode`** — no Google call, no
   session, no user row.
5. On success, takes the sanitized `returnTo` from the signed cookie and continues the existing
   exchange / identity-resolution / session-creation / redirect flow unchanged.

Nothing else in the route changed: no provider configuration, session lifetime, authorization rule,
account-linking behaviour or frontend architecture was touched.

## 6. Security properties

| Requirement | Status | Evidence |
|---|---|---|
| State is cryptographically random | **PASS** | `crypto.randomBytes(32)` → 43-char base64url; 500/500 unique in tests |
| State contains no user data | **PASS** | It is literally the random nonce; `returnTo` lives in the cookie |
| State is bound to the initiating browser | **PASS** | Signed httpOnly `velnox_oauth_state` cookie, `Path=/auth` |
| State expires | **PASS** | Signed `e` claim, 10 min; exact boundary tested |
| Callback requires state | **PASS** | `missing_state` / `missing_cookie` rejections tested |
| Callback compares state safely | **PASS** | HMAC signature + SHA-256 digest + `crypto.timingSafeEqual` |
| State is consumed | **PASS** | Cookie cleared on every callback; replay-without-cookie rejected in tests |
| Valid code + invalid state creates no session | **PASS** | Route test proves 0 token-exchange calls and no `velnox_session` |
| `returnTo` independently validated | **PASS** | Sanitized in and out; 12 hostile inputs tested |
| No open redirect introduced | **PASS** | Only internal absolute paths survive; external/protocol-relative/scheme → `/` |
| No secret / state / cookie / authorization code logged | **PASS** | Log scan: only the rejection *reason* and a config boolean-style message |
| Old insecure pattern removed from active paths | **PASS** | Repo scan finds `base64url(JSON.stringify({returnTo}))` only in comments/tests |

## 7. Tests added / changed

Three new files, **36 cases** — no existing test was modified, weakened or skipped.

### `backend/tests/oauth-state.test.ts` — 24 cases (always run)

Positive: opaque 256-bit nonce; not the legacy payload; `returnTo` carried only by the signed cookie;
two flows differ; 500 unique high-entropy states; matching state accepted; internal paths preserved
(`/`, `/cart`, `/checkout`, `/seller/goals`, query + fragment); boundary expiry accepted.

Negative: missing state; missing cookie (another browser); state from one flow with another flow's
cookie (mismatch); tampered payload; tampered signature; malformed envelope; cookie signed with a
different secret; expired state (and exact `exp` boundary); consumed-state replay; hostile input never
throws; external/protocol-relative/backslash/`%2e%2e`/`javascript:`/`data:`/control-char/oversized
`returnTo` all normalize to `/`; non-string input; no signing secret fails closed; static assertion
that the route no longer derives state from `returnTo` and that the module uses `crypto.randomBytes`,
not `Math.random`.

### `backend/tests/oauth-route.test.ts` — 11 cases (always run, no DB)

Mounts the **real** `setupGoogleAuth` Express handlers and talks HTTP to `127.0.0.1` on an ephemeral
port; the Google token endpoint is stubbed (no network, no credential).

- `/auth/google` sets `HttpOnly; SameSite=Lax; Path=/auth; Max-Age=600` and an opaque state; two
  starts differ; the state does not contain `returnTo` or `/seller/goals`.
- Missing state → `google_state_invalid`, **0** token exchanges, no session cookie, state cookie cleared.
- Mismatched state (state B with cookie A) → rejected, 0 exchanges.
- State with no cookie (different browser) → rejected, 0 exchanges.
- Expired state → rejected, 0 exchanges.
- Forged cookie → rejected, 0 exchanges.
- Repeated `code` params → 400, 0 exchanges, cookie cleared.
- Valid state → exactly **1** exchange (stubbed failure), still no session, cookie cleared.
- Replay of the callback after the cookie was consumed → rejected with 0 exchanges.

### `backend/tests/oauth-callback-session.test.ts` — 1 case (DB-gated)

Positive path against a disposable PostgreSQL with stubbed Google: valid state + matching cookie →
real `velnox_session` JWT (verified signature, `jti`, email), `302` to
`https://seller.velnox.test/seller/goals` (internal `returnTo` preserved), state cookie cleared, user
row `role=customer`, `auth_identities` row `provider=google`. The fixture user is deleted afterwards.
Without `TEST_DATABASE_URL` the case **skips**, and it can never target production
(`backend/db/test-database.ts` refuses that).

## 8. Test results (exact commands)

Environment: disposable PostgreSQL 14 at `127.0.0.1:5432/velnox_test`, bootstrapped once from
`db/run-sqleditor.sql` (63 tables). No production database was contacted.

| Check | Command | Result |
|---|---|---|
| New OAuth tests (3 files) | `TEST_DATABASE_URL=… bun test backend/tests/oauth-callback-session.test.ts backend/tests/oauth-route.test.ts backend/tests/oauth-state.test.ts` | **PASS — 36 pass / 0 fail** (1,167 expectations) |
| Full backend suite (disposable PG14) | `TEST_DATABASE_URL=… bun test backend/tests` | **PASS — 1399 pass / 2 skip / 0 fail** (1,401 tests, 70 files, 17.4 s) |
| Backend typecheck | `cd backend && bun tsc --noEmit` | **PASS — exit 0** |
| Root typecheck (4 apps) | `bun run typecheck` | **PASS — 4/4 workspaces, exit 0** |
| App builds | `bun run build:apps` | **PASS — 4/4, exit 0** |
| i18n parity | `bun run i18n:check` | **PASS — th=1257 en=1257 my=1257** |
| Whitespace/conflict check | `git diff --check` | **PASS — no output** |
| Old insecure pattern scan | `grep -rn "base64url(JSON.stringify…" backend packages apps` | **PASS — comments/tests only, no active path** |

The 2 skips are pre-existing external-credential/gated cases; the new OAuth suite has **zero skips
when a test database is configured**. No test was removed or weakened to make anything green.

## 9. Production DB Verify status

**UNCHANGED and still BLOCKED — correctly.**

- Latest known run `40986922337` (`main`, push) was re-checked read-only via `gh`:
  - `Validate schema and workflow contracts`: **success** (the workflow's own credential/fallback guards pass)
  - `Typecheck, build and database tests (disposable PostgreSQL)`: **success**
  - `Verify production schema and identity`: **failure** — `::error::BLOCKED: NEON_PRODUCTION_DATABASE_URL is not configured.`
  - `Production database verdict`: **failure** (it cannot be masked)
- The workflow already enforces every property Workstream B asked about:
  - the canonical secret only (`secrets.NEON_PRODUCTION_DATABASE_URL`); the retired
    `NEON_DATABASE_URL` is rejected by the repository job;
  - no fallback (`${NEON_PRODUCTION_DATABASE_URL:-…}` scan), no hard-coded remote URL;
  - `test.yml` may not reference the production secret at all;
  - every production statement is a `SELECT`; a missing object FAILs and is not repaired;
  - the secret value is never printed (database name/schema/version only).
- **No workflow file was modified.** The only blocker is the owner-provided repository secret. The
  owner must add `NEON_PRODUCTION_DATABASE_URL` in *Settings → Secrets and variables → Actions*
  pointing at the same Neon project/branch as Render's `DATABASE_URL`. An agent must not obtain,
  print or ask for the value, and no production connection was made in this phase.

## 10. Browser E2E status

**BROWSER/E2E: NOT RUN — BLOCKED. No browser test has occurred.**

Inspected infrastructure:

| Capability | Finding |
|---|---|
| Playwright / Cypress / Puppeteer / Webdriver / Selenium | **absent** — repo-wide scan (dependencies, config, specs, CI) returned nothing |
| E2E directory / browser test helpers | **absent** (`e2e/`, `tests-e2e/`, `playwright.config.*` do not exist) |
| App scripts | each app has only `dev`, `build`, `preview`, `typecheck`; no `test:e2e` |
| Test environment configuration | none for browsers; only `TEST_DATABASE_URL` for the backend suite |
| CI browser step | **absent** in every workflow |
| Preview | `freebuff-preview status` → `running:false`, `previewCommand:null`; the monorepo has 4 separate Vite apps, so one preview command cannot serve the product |
| Existing coverage | `bun:test` backend/API and source-level assertions only |

Missing infrastructure, in dependency order:

1. Playwright + a browser download, a config with one project per app origin, and trace/screenshot
   retention.
2. A runnable staging stack: backend + 4 Vite apps on known origins (or a single gateway), with
   `VITE_API_URL`/`VITE_*_URL`/`GOOGLE_REDIRECT_URI`/`CORS_ORIGINS` pointed at it.
3. Seeded test identities: customer, approved seller, `staff` with a partial permission set, `owner`.
   Never production customer accounts.
4. A deterministic reset between runs (the existing DB fixture/purge helpers can be reused).
5. Real object storage for image-upload journeys (an R2 test bucket or a local S3-compatible stub).
6. A CI job with the disposable PostgreSQL service and a backend started on a fixed port.
7. Stripe **TEST** credentials only when the payment journey is added; no real charge, ever.

Minimal safe future suite (smallest useful coverage):

- **Buyer:** homepage renders; catalog search; product detail (variants); add to cart; checkout page;
  order result. Payment via COD or a stubbed rail first; real Stripe TEST checkout only when safe test
  credentials/environment exist.
- **Seller:** login; onboarding submission; product creation; product image upload; order management.
- **Center:** admin login; role/permission-dependent rendering (staff partial permissions vs owner);
  seller approval.
- **Cross-app:** OAuth redirect round-trip; VelShop → VelSeller; VelShop/VelSeller → VelCenter.

No package was installed and no browser was launched in this phase.

## 11. Remaining known risks

1. **State single-use is browser-bound, not server-recorded.** The cookie is cleared on every
   callback, so a normal replay (state without the cookie) is rejected. An attacker who somehow
   *possesses* the httpOnly cookie value and the state could replay within the 10-minute window; that
   attacker already controls the browser. Google's authorization code is itself single-use. This is
   the standard cookie-bound OAuth design; a server-side nonce ledger would require storage (schema
   change) and was deliberately out of scope.
2. **Signing key fallback.** Without `OAUTH_STATE_SECRET`, state signing uses `JWT_SECRET`; rotating
   `JWT_SECRET` invalidates in-flight OAuth flows (≤10 min). Set `OAUTH_STATE_SECRET` to rotate
   independently.
3. **Error UX.** The frontend does not render `?error=google_state_invalid` (it did not render the
   pre-existing `google_failed` either). A rejected callback lands on the auth page without a
   specific message. Not a security gap; UI copy was out of scope.
4. **`getFrontendUrl()` request-origin fallback** still exists for a backend with no `VITE_*_URL` /
   `CORS_ORIGINS`; it is pre-existing, unreachable in a correctly configured deployment, and was not
   introduced or changed by this phase.
5. **Production schema/data remain unverified** while the canonical secret is absent.
6. **No rendered-browser verification exists** for any journey, including this OAuth change.

## 12. Files changed

Code commit `1e41ebc`:

| File | Change |
|---|---|
| `backend/lib/oauth-state.ts` | **new** — CSPRNG nonce, signed envelope, timing-safe validation, `returnTo` sanitizer, cookie options |
| `backend/routes/auth.ts` | `/auth/google` mints + binds state; callback consumes + validates it **before** the code exchange; `returnTo` taken from the signed cookie |
| `backend/tests/oauth-state.test.ts` | **new** — 24 unit cases |
| `backend/tests/oauth-route.test.ts` | **new** — 11 route-level cases, stubbed Google |
| `backend/tests/oauth-callback-session.test.ts` | **new** — 1 DB-gated positive case |

Docs commit:

| File | Change |
|---|---|
| `.ai/history/2026-10-30-phase-2h-oauth-state-hardening.md` | **new** — this report |
| `.ai/AI_HANDOFF.md` | §87 added; §84 + §85 condensed to pointers (archive housekeeping) |
| `.ai/history/AI_Handoff_Archive.md` | §84/§85 archive index rows + §87 note |
| `.ai/history/archive/AI_Handoff-2026-10-28-section-84-phase-2e.md` | **new** — §84 verbatim |
| `.ai/history/archive/AI_Handoff-2026-10-30-section-85-phase-2f.md` | **new** — §85 verbatim |
| `.ai/context/security.md` | OAuth state mechanism added to the data flow and rules |

**Not changed:** any `.sql` file (`db/schema.sql`, `db/run-sqleditor.sql`), any workflow, `package.json`
/ `bun.lock`, any frontend app file, any Stripe/payment/chat/realtime/catalog code, any env file.

## 13. Explicit scope statement — unrelated Phase 2G findings were NOT fixed

This phase changed **only** the OAuth state mechanism (Phase 2G **H-1**) plus documentation and the
three Workstream B/C inspections. Every other Phase 2G finding is intentionally untouched:

in-memory chat dedupe · missing outbox dispatcher · WebSocket revocation cache · 30-second role
refresh · `/api/auth/me` cache · seller unread full-conversation fetch · same-millisecond chat
pagination · in-memory rate limiter · boot-time `ensureVariantTables()` · VelCenter fallback domain
typo · CORS localhost entries · timing-safe comparison cleanup · upload MIME fallback · Google
`email_verified` defense-in-depth · search indexing · structured logging.

Phase 2I was **not** started.

---

## Mandatory change record (AI_RULES §18)

| # | Field | Value |
|---|---|---|
| 1 | Date/time | 2026-10-30, UTC |
| 2 | Agent | Buffy (Codebuff) |
| 3 | Branch | `main` |
| 4 | Commit before | `5039f94b730c10effb4f53aaf39bbc9ae09d1e04` |
| 5 | Commit after | code `1e41ebc964f48de8ff6ea8f6804b9d3b5f3f3033`; docs commit = `git log -1 --format=%H -- .ai/history/2026-10-30-phase-2h-oauth-state-hardening.md` |
| 6 | Purpose | Close Phase 2G H-1 (OAuth login CSRF); prepare Production DB Verify and browser E2E honestly |
| 7 | Inspected before changing | `AGENTS.md`, `.ai/AI_RULES.md`, `.ai/README.md`, `.ai/AI_HANDOFF.md` (§86), Phase 2G report, `.ai/context/security.md`, `.ai/context/testing.md`, `.ai/context/workflow.md`, `backend/routes/auth.ts`, `backend/server.ts`, `backend/db/index.ts`, `backend/db/test-database.ts`, `frontend Auth.tsx`/`sites.ts`, existing auth tests, `.github/workflows/production-db-verify.yml`, CI run `40986922337` |
| 8 | Files/folders touched | `backend/lib/`, `backend/routes/auth.ts`, `backend/tests/`, `.ai/context/security.md`, `.ai/AI_HANDOFF.md`, `.ai/history/` (report + archive + index) |
| 9 | Added | OAuth state module; 3 test files (36 cases); report; archive file |
| 10 | Removed | the base64-url `returnTo` state construction and its callback decoder; §85 full text moved (not deleted) to archive |
| 11 | What changed | Opaque CSPRNG state bound to a signed expiring single-use cookie; state validated before code exchange; independent internal-only `returnTo` validation |
| 12 | Why it changed | Phase 2G H-1 login CSRF: any Google code was accepted with any/absent state |
| 13 | Systems affected | Backend Google OAuth start/callback; OAuth login redirect target |
| 14 | Confirmed unaffected | No SQL/schema diff (`git status`); no dependency diff (`bun.lock` unchanged); no CI diff; no frontend diff; no payment/chat/realtime diff. Session creation, member login, change-password, logout paths untouched. Full suite still green |
| 15 | Checks run | the exact commands in §8 |
| 16 | Results | PASS (all commands in §8); Production DB Verify **BLOCKED** (owner secret); Browser E2E **NOT RUN** |
| 17 | Problems found | (a) route tests initially failed because `node_modules` was not installed — installed from the frozen lockfile; (b) test stub matched `/tokeninfo` with the `/token` prefix — fixed the stub; (c) cross-file env restoration broke the audience check — test-only fix; (d) `.ai/AI_HANDOFF.md` was 53.2 KB against the ~55 KB ceiling — §85 then §84 archived verbatim (file now 50.1 KB) |
| 18 | Limitations | DB-gated positive case requires `TEST_DATABASE_URL` (ran locally on disposable PG14; skips otherwise); no real Google call; no browser/E2E; no production DB |
| 19 | Work still open | owner adds `NEON_PRODUCTION_DATABASE_URL`; Playwright staging suite; all other Phase 2G findings (see §13) |
| 20 | Next agent must know | OAuth state is now a random nonce in a signed httpOnly cookie — never re-introduce `returnTo` into `state`; the callback must keep validating **before** `exchangeCode`; `OAUTH_STATE_SECRET` is optional but preferred over the `JWT_SECRET` fallback |
