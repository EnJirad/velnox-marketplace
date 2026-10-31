# CI green: chat DB suites, unread preview, company read model (2026-11-02)

**Starting SHA:** `9150048` (`HEAD == origin/main`, clean tree).
**Final code SHA:** `f4c2f23` + `73cd999` (this record is committed after them; see handoff §101).

## CI failures found (inspected, not assumed)

| Workflow | Job | Result | Cause |
|---|---|---|---|
| Tests (#228, `9150048`) | Run the test suite | FAIL | `chat-support-phase2d` expected **1** `notifications` row of type `chat` after a retried send and got **0** |
| Production DB Verify (#56) | Typecheck, build and database tests | FAIL | same test (shared step) |
| Production DB Verify (#56) | Production database verdict | FAIL | dependency on the job above (it only coordinates) |
| Production DB Verify (#56) | Verify production schema and identity | **PASS** | production schema was healthy all along |

**Root cause:** `9150048` deliberately stopped chat from writing bell notifications and deleted the
helpers. One DB-gated test still encoded the old contract (title: "…one push and one notification"), so a
correct production change looked like a regression.

**Fix:** the assertion now pins the new contract — one message, one realtime push, **zero** `type='chat'`
notification rows, checked again after a genuinely new send. The test was renamed accordingly. No test was
deleted, no assertion weakened, no CI config touched.

## Second failure (introduced by this work, caught by CI)

The first version of the new company read-state test was appended to the typing block, which has its own
harness, so `openSupport`/`sendCustomer` were out of scope → `ReferenceError` at collection time. Fixed by
opening the support conversation and sending through the same public REST endpoints. Recorded because the
honest history includes the mistake.

## New coverage added (DB-gated, runs in CI)

1. **One conversation, one unread state** — four seller messages produce exactly one conversation row with
   `unreadCount = 4` and `lastMessage = "Message 4"`; reading what was loaded clears to `0` while the
   preview stays; two later messages count again (`2`) and preview `"Message 6"`; zero bell rows throughout.
2. **Support is classified, not guessed** — the customer list marks the support thread `isSupport: true`
   and a shop thread `isSupport: false` (the UI splits on that flag).
3. **Company read state = Model A (global per conversation)** — with two staff accounts: staff A sees
   `unreadCount = 3` and preview `"three"`; after staff A reads (`marked: 3`), staff B sees `0` unread for
   the same thread.

**Why Model A:** the schema stores exactly one `read_at` per `chat_messages` row and has no per-staff read
table; `POST /api/center/chat/conversations/:id/read` marks the message rows, and the company unread
queries read the same rows for every staff member. Per-staff state (Model B) would require a new table and
was not introduced — the smallest correct change was to assert and document the existing model.

## CI results after the fix

- **Tests #230** (`73cd999`) — **success** (typecheck, disposable PostgreSQL bootstrap, full suite,
  whitespace hygiene).
- **Production DB Verify #58** (`73cd999`) — **success**, all four jobs:
  canonical schema validation, production secret + identity + schema fingerprint, disposable-DB
  typecheck/build/tests, and the final verdict.
- Disposable-PostgreSQL suite: **1486 pass / 0 fail** across **1488 tests** (16.6 s), including the new
  unread-preview, support-classification and company-read cases and the existing WebSocket delivery,
  typing, idempotency and read-bound cases.

Local (this device, no database): `bun test backend/tests` → 1121 pass / 378 skip / **8 fail**, where all 8
are the documented Termux-only `test database guard` probes; `bun run typecheck` 4/4; backend `tsc` clean.

## Unchanged this round (previously verified, not re-verified)

- VelCenter image bubble fix (`9150048`): the render path, the shared DTO and the production object URL
  (HTTP 200) were verified before; **no browser screenshot exists** — see blockers.
- Bell: chat rows are filtered from `GET /api/customer/notifications`; the 8 historical rows stay in the
  database, deliberately not deleted.
- Support separation in VelShop/VelSeller: All/Unread exclude the support thread; VelCenter keeps its
  customer/seller/internal tabs.

## NOT RUN

- Browser/E2E for all three apps: no session on this device (Google OAuth only) and no local PostgreSQL
  (PG18 `initdb` hangs at its bootstrap probe in this sandbox). The DB-gated suites run in CI instead, which
  is real Postgres + real WebSocket, but it is not a visual check.
- Uploading a new image from the UI (R2 credentials are backend-only; the stored object was verified
  reachable earlier).

## Remaining work

1. Browser matrix (customer/seller/company, text + image + viewer + unread + bell) on a real deployment.
2. Decide whether per-staff company read state is a product requirement; if yes, design the smallest table
   and migrate with the guarded workflow.
3. Optional owner-approved cleanup of the 8 historical chat notification rows.
