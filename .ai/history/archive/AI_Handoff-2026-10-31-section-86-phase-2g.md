# §86. Phase 2G — Production Readiness Audit (2026-10-30)

> Archived verbatim from `.ai/AI_HANDOFF.md` on 2026-10-31 to keep the live handoff
> under this environment's ~55 KB edit-tool ceiling. Nothing was discarded.

## §86. Phase 2G — Production Readiness Audit (2026-10-30) — COMPLETE (AUDIT ONLY)

**Audited SHA:** `9c38ae35019d1a4b4ace7127327e85db22bb30cf` (`HEAD == origin/main`, clean tree at start
and end). **Report:**
[`.ai/history/2026-10-30-phase-2g-production-readiness-audit.md`](../2026-10-30-phase-2g-production-readiness-audit.md).
**Source changed:** **NONE** — documentation only (this section + the report). No SQL, env, dependency,
CI or hosting configuration touched.

**Readiness:** staging-capable; **not ready for a public production launch**. 164 backend routes, 20
VelShop pages, 8 VelSeller pages, 1 VelCenter page and 4 corporate pages inspected.

**High:** OAuth `state` is only `base64url({returnTo})` — never stored/compared/expired, so any valid
Google `code` is accepted (login CSRF / session swapping). `backend/routes/auth.ts:432-433, 451-465, 483-485`.

**Medium highlights:** production DB Verify permanently `BLOCKED` (missing canonical secret; latest
run `40986922337`); no browser/E2E suite; boot-time DDL `ensureVariantTables()`
(`server.ts:127-196`); in-memory chat send dedupe (`chat.ts:288-313`); no outbox dispatcher
(`lib/order-events.ts:32-33`); WS revocation in-memory + 30 s role sweep (`realtime/index.ts:117,164-179`);
revocation fail-open on DB error (`middleware/auth.ts:45-68`); seller unread badge fetches the full
conversation list (`use-chat-unread.ts:84-95`); same-ms pagination loss (`chat.ts:142-150`); in-memory
rate limiter (`rate-limit.ts:5-13`); `SITE_URLS.velcenter` typo `center.velnx.com` (`sites.ts:21`).
All six known Phase 2E/2F risks remain unresolved (details in report §11).

**Verified:** root typecheck 4/4 · backend `tsc --noEmit` · `build:apps` 4/4 · i18n 1257/1257/1257 ·
backend suite on disposable PG14 **1359 pass / 6 skip / 0 fail** (1365 tests, 67 files) · `git diff --check`
clean · CI test workflow green (`40986922370`, `40987344815`). Read-only live API: `/api/health` ok;
Stripe `mode:test`, webhook configured, self-test verified; COD disabled. No production DB access, no
real payment. No committed live secrets (pattern scan matched only test fixtures).

**Not tested / blocked:** all rendered browser journeys (no browser tool, preview `running:false`,
deployed frontends DNS-unresolvable from the sandbox); production DB verification; real Stripe E2E.
These are **not** passes.

**Next:** Phase 2H — OAuth state hardening + restore production DB Verify + staging Playwright E2E,
then schema-authority cleanup and durable chat/outbox/rate-limit work (report §13).
