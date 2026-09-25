# Archived — Production R2 authenticated round-trip (TASK 004B) — BLOCKED

**Reference only.** Moved verbatim out of `.ai/AI_HANDOFF.md` §14 on 2026-09-25
because the live handoff was approaching this environment's ~55 KB file-edit limit.

**The live state did not change.** TASK 004B is still **BLOCKED** at the account
hard gate and the authenticated chain was never executed. The short version stays
live in `.ai/AI_HANDOFF.md` §14; this file holds the full evidence narrative for
both passes (2026-09-25).

Nothing here is guaranteed to describe the current code. The repository is always
authoritative. Index row: `.ai/history/AI_Handoff_Archive.md`.

---

## 14. Production R2 authenticated round-trip (TASK 004B, 2026-09-25) — **BLOCKED**

**Overall: BLOCKED at the account hard gate.** Every read-only / unauthenticated /
code-level check passed; the authenticated production chain (presign → R2 PUT →
confirm/save → media row → API read → UI → replace → delete → cleanup) **was not
executed at all** and must not be reported as PASS. No production write of any
kind was made. No production DB was touched. No credential was read.

**Environment + auth/CSRF boundary (verified, read-only).** API
`https://velnox-api.onrender.com` (`docs/DEPLOYMENT.md:16`) — `/api/health` 200,
`/api/health/r2` `{configured:true,bucket:true,verify:true}` (a real
`ListObjectsV2`), `/api/shops` 200; responses carry `server: cloudflare` +
`rndr-id`, so the host is the Render service. **TASK 003 is live:** removed
`PATCH /api/customer/profile-image` → **404**. All six canonical media endpoints
→ **401** without a cookie; untrusted `Origin` → **403**; unknown route → 404.
Re-probed 14× at two cadences: identical. Nothing was written.

**Transient production anomaly (observed, unreproducible, NOT attributable to
TASK 003).** For a ~4-minute window (from ~16:21Z), **every** POST/PATCH with a
JSON body returned `500 INTERNAL_ERROR` *including a non-existent route*, while
GETs on the same host stayed 200. Identical requests returned the correct
401/404 minutes later, and 8 rapid + 6 spaced repetitions afterwards were all
correct. A 500 on an unmatched route means an exception in the pre-routing
middleware chain, not a media-code fault; the likely window is a Render
cold-start / rollout. Recorded as an **open observation, no root cause proven**
— production logs are not reachable from this workspace.

**Why BLOCKED.** Stop condition #1/#2/#3 of the task brief: no safe authorized
production test account exists and none was supplied. This workspace holds **no**
`DATABASE_URL`, `TEST_DATABASE_URL`, `JWT_SECRET` or R2 credential (verified),
and the system's only login is Google OAuth in a browser. Minting a production
user by SQL, reusing a real customer/seller/admin, or fabricating a JWT are all
forbidden — so steps 9–23 (synthetic image, purpose allowlist *at the endpoint*,
presign, R2 PUT, confirm/save, media row, API read, UI, replace, delete, cleanup,
ownership boundary, failure path) are **BLOCKED / NOT TESTED**, not failed.

**Provision to unblock:** an owner-provisioned production test account (a
dedicated customer, no real orders/payments, no real seller data) plus a live
browser for the UI half. UI/browser E2E has still **never** been run from this
environment → `UI NOT VERIFIED`.

**TASK 004A isolation — PASS (re-proved, not assumed).** Fail-closed against the
real suite: `NODE_ENV=test DATABASE_URL=postgresql://…@*.neon.tech/…`
`bun test backend/tests` → `REFUSING TEST AGAINST PRODUCTION DATABASE`,
`code: TEST_DATABASE_REFUSED`, **0 pass / 23 fail**, no test body executed
(23 files errored at import; Bun exits 2 here — the §13 note says 1). Normal run
with nothing configured: **451 pass / 42 skip / 0 fail** (493 tests, 23 files).

**Validation actually run (no code change — docs only).** Backend `bunx tsc
--noEmit` → clean; `bun run typecheck` → 4/4 apps exit 0; `git diff --check` →
clean; no DB change (`db/` untouched).

**Step 24 regression search — PASS (source).** No `PATCH … profile-image` route
and no `patchUserImage` caller anywhere; the only hits are the removal NOTE in
`backend/routes/upload.ts:658`, the guard test, and two comment references. No
caller sends a `purpose=` that presign does not allowlist. The canonical chain
stays presign → R2 PUT → confirm/save; no `client image → user.avatar` path.

**10 MB boundary: CODE-ONLY** — never exercised against production, and this
pass did not change that. **Every other checklist item that says PASS above is
read-only or code-level; no production E2E claim is made anywhere.**

**Completion pass (2026-09-25, second pass) — re-verified, still BLOCKED.**
Committed `c7e545f`; tree clean, no app/backend/db change since (only `.ai/`
docs). Hard gate unchanged (no `DATABASE_URL`, `TEST_DATABASE_URL`, `JWT_SECRET`
or R2 credential here; the only login is Google OAuth in a browser) → the
authenticated chain remains **BLOCKED / NOT TESTED**, **zero production writes**.
Re-probed live and still correct (all of the paragraph above) with **no 500s**
this pass; `/api/health` took **32 s**, consistent with the transient-500 window
being a Render cold start (still not proven). Isolation re-check fail-closed
(0 pass / 23 fail, no test body executed); normal suite **451 pass / 42 skip / 0
fail**; backend + 4-app typecheck clean; `git diff --check` clean.
