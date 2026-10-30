# §87. Phase 2H — OAuth State Hardening (2026-10-30)

> Archived verbatim from `.ai/AI_HANDOFF.md` on 2026-10-31 to keep the live handoff
> under this environment's ~55 KB edit-tool ceiling. Nothing was discarded.

## §87. Phase 2H — OAuth State Hardening (2026-10-30) — COMPLETE

**Starting SHA:** `5039f94b730c10effb4f53aaf39bbc9ae09d1e04` (`HEAD == origin/main`, 0/0, clean tree).
**Code commit:** `fix(auth): harden oauth state validation` (find with
`git log -1 --format=%H -- backend/lib/oauth-state.ts`). **Docs commit:** `docs(ai): record phase 2h
oauth hardening` (find with `git log -1 --format=%H -- .ai/history/2026-10-30-phase-2h-oauth-state-hardening.md`).
**Report:** [`.ai/history/2026-10-30-phase-2h-oauth-state-hardening.md`](../2026-10-30-phase-2h-oauth-state-hardening.md).
**Fixes Phase 2G H-1 only.** No other 2G finding touched.

**Mechanism.** `/auth/google` mints `state = crypto.randomBytes(32).toString("base64url")` (opaque
256-bit nonce; no returnTo/timestamp/user data) and binds it to a short-lived `httpOnly`,
`SameSite=Lax`, `Path=/auth`, `Secure`-in-production cookie `velnox_oauth_state` (10 min). The cookie
carries `{nonce, sanitized returnTo, exp}`, HMAC-SHA256 signed with `OAUTH_STATE_SECRET` (falling back
to `JWT_SECRET`). The callback consumes (clears) the cookie, then compares the returned state to the
cookie nonce with `crypto.timingSafeEqual` over SHA-256 digests; missing / mismatched / forged /
expired / replayed state is rejected BEFORE `exchangeCode`, so no session is created. `returnTo` is
separate: internal paths only (no external/protocol-relative/scheme values), sanitized into the cookie
and again out of it.

**Tests.** 3 new files, 36 cases: `oauth-state.test.ts` (24, always run), `oauth-route.test.ts` (11,
real Express routes + stubbed Google — missing / mismatch / other-browser / expired / forged / replay,
valid state reaches the exchange exactly once), `oauth-callback-session.test.ts` (1, DB-gated
positive: real `velnox_session` + `/seller/goals` redirect + persisted Google identity).

**Verified.** New OAuth files **36 pass / 0 fail**; full backend suite on disposable PG14
**1399 pass / 2 skip / 0 fail** (1414 tests, 70 files); backend `tsc --noEmit` PASS; root typecheck 4/4
PASS; `build:apps` 4/4 PASS; `i18n:check` 1257/1257/1257; `git diff --check` clean; the old
`base64url(JSON.stringify({returnTo}))` pattern is absent from every active path (comments/tests only).

**Production DB Verify:** unchanged and still **BLOCKED** — run `40986922337`: repository job success,
disposable-PG gates success, production job `BLOCKED: NEON_PRODUCTION_DATABASE_URL is not configured.`,
verdict failure. Owner must add the canonical secret; no fallback exists and none was added.

**Browser E2E: NOT RUN** — no Playwright/Cypress/Puppeteer/webdriver anywhere, no e2e directory, no CI
browser step, preview `previewCommand:null`. The minimal future plan is in report §10. Nothing was
installed.

**Not fixed (deliberate):** every other Phase 2G finding (chat dedupe, outbox dispatcher, WS revocation
cache, 30 s role refresh, `/api/auth/me` cache, seller unread fetch, same-ms pagination, in-memory rate
limiter, boot DDL, VelCenter domain typo, CORS localhost, timing-safe cleanup, upload MIME fallback,
`email_verified`, search indexing, structured logging).
