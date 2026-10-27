# Phase 2E — CI/E2E Verification + Responsive/Visual Audit — Change Report

| Field | Value |
|---|---|
| Date / time | 2026-10-28 (report name, per task); CI runs executed 2026-10-27 23:14–23:27 UTC |
| Agent | Buffy (Codebuff), Freebuff workspace |
| Branch | `main` |
| Commit SHA before (base) | `d7c7eefaee7d389e153ee956d51c116352cb72aa` (= `origin/main` at `git fetch` before editing; 0/0, clean tree) |
| Commit SHA after (code) | `06806685c8f95381d1cbd06f1b22de4cc59b6235` — three commits: `ca66c4c` (harness + channel contract), `b2c6ef7` (read-bound precision), `0680668` (wire-valid bound probe) |
| Commit SHA after (docs) | the `docs(ai)` commit carrying this file and `AI_HANDOFF.md` §84 — it is the final `HEAD` of this task (a commit cannot contain its own SHA; reported in the task's final answer instead) |
| Purpose | Close the Phase 2D verification gap: read the REAL CI results, make the Phase 2D DB-gated suite execute and pass in CI, and audit the Phase 2D surfaces responsively/visually and against the security regression list. No new feature, no schema/SQL/Stripe/unrelated change. |

> **SOURCE CODE MODIFIED: YES** — `backend/routes/chat.ts` (one Phase 2D defect fixed) and
> `backend/tests/chat-support-phase2d.test.ts` (three Phase 2D defects fixed).
> **DATABASE MODIFIED: NO**
> **SQL MODIFIED: NO**
> **PRODUCTION DB CONNECTED: NO**
> **STRIPE MODIFIED: NO**
> **VELREPEAT MODIFIED: NO**

---

## 1. Preflight (before any edit)

- `git fetch origin main` → `HEAD == origin/main == d7c7eefaee7d389e153ee956d51c116352cb72aa`,
  `git status --short` empty (no user changes to preserve), 0/0 ahead/behind, branch `main`.
- Read `AGENTS.md`, `.ai/AI_RULES.md`, `.ai/README.md`, `.ai/AI_HANDOFF.md`,
  `.ai/context/{project-map,frontend,realtime,testing,workflow}.md`,
  `.ai/history/2026-10-27-chat-support-phase-2d.md`.
- Verified no Phase 2E work existed (no CI-verification report, no fixes on top of `4aed084`).

## 2. CI verification — the workflow and the REAL runs

`.github/workflows/test.yml` (unchanged, audited):

- Disposable `postgres:16` **service container**, created empty and destroyed with the runner.
- Bootstrapped with the canonical `db/run-sqleditor.sql` (`psql -v ON_ERROR_STOP=1`), then
  `SELECT 1` health probe.
- `TEST_DATABASE_URL` is the only database variable; **no repository secret is referenced**, and the
  job pins the guard in `backend/db/test-database.ts` in both directions (a production-looking
  `DATABASE_URL` is refused; the disposable one is accepted). Production Neon is unreachable from CI
  by construction.
- `bun test backend/tests` discovers `backend/tests/chat-support-phase2d.test.ts` (verified in the logs:
  the file's group appears with 29 result lines per run).
- `JWT_SECRET` is a CI-only literal, marked public by construction.

Real runs read with `gh run view --log` (job *Typecheck + tests (disposable PostgreSQL)*):

| Run | Commit | Meaning | pass | fail | skip |
|---|---|---|---|---|---|
| `40533019916` | `1a4cce0` | **pre-Phase-2D baseline** (no chat tests yet) | 1315 | **11** | 2 |
| `40546404703` | `d7c7eef` | Phase 2D HEAD, before any 2E change | 1338 | **15** | 2 |
| `40600703186` | `ca66c4c` | + harness/contract fix | 1339 | **14** | 2 |
| `40601550666` | `b2c6ef7` | + read-bound precision fix | 1341 | **12** | 2 |
| `40601957381` | `0680668` | + wire-valid bound probe (**final**) | **1342** | **11** | **2** |

Reading: the whole delta from `1338/15` to `1342/11` is the Phase 2D suite — all 4 failures were in
`backend/tests/chat-support-phase2d.test.ts`, and all 4 now pass. **The 11 remaining failures are
exactly the 11 that already failed at the pre-Phase-2D baseline `1a4cce0`** (6 `buy-now-checkout` +
5 `order and shipment events` = the Phase 2C suite), i.e. they are pre-existing and out of Phase 2E
scope — see §5.

**CI VERIFICATION: RUN** (IDs above). Do not read the workflow's overall `failure` status as a Phase 2D
result: the Phase 2D file has **zero failures** in the final run.

## 3. Phase 2D defects found by CI and fixed in 2E

Phase 2D reported these DB-gated tests as *skipped* locally (no disposable database in the sandbox).
CI executes them, and four failed. Root causes, one by one:

### D1 — the badge endpoint was not mounted in the test harness (`ca66c4c`)

The harness called only `setupChatRoutes(app)`, while the badge's real endpoint
`GET /api/customer/account-summary` lives in `backend/routes/index.ts` (`setupRoutes`). Three
assertions therefore saw **404** instead of 200/401. Fix: the harness now mounts the **real** main
router (`setupRoutes(app)`) in addition to the chat router — the shipped endpoint and its
`requireAuth` gate are what runs, never a stand-in. (The route itself was correct all along; only the
test's server was incomplete.)

### D2 — the addressed-delivery assertion pinned the wrong channel (`ca66c4c`)

The test expected `frame.channel === "chat:message"`, but the server's addressed path is
`sendToUser(userId, "", CHANNELS.CHAT_MESSAGE, …)`, and `sendToUser` falls back to the recipient's
private channel — so the frame carries `channel: "user:<recipientId>"`. Consumers dispatch on event
**type** (`chat-socket.ts` → `emit(msg.type, …)`); no code reads `meta.channel` for chat events
(verified by grep). The assertion now pins the **actual** contract, which is the stronger claim:
the frame arrives on the *recipient's own private channel*, never a broadcast one.

### D3 — the `upTo` read bound was applied at the wrong precision (`b2c6ef7`) — **production defect**

`mapMessage` serializes `createdAt` with `new Date(r.created_at).getTime()` — epoch **milliseconds** —
while `chat_messages.created_at` is a microsecond-precision `TIMESTAMPTZ DEFAULT NOW()`. The read
route compared strictly (`created_at <= to_timestamp(upTo/1000)`), so a message stamped `…:123456`
was **not** `<= …:123000`: a bounded read marked **0** messages and a thread could never be cleared
(CI: `marked` expected 1, received 0). Both clients derive `upTo` from that same ms value
(`ShopChat.tsx`/`SellerChat.tsx`: newest loaded message, and a live message's own `createdAt`), so
this was a real end-to-end defect, not a test artifact.

Fix: one documented, sargable fragment used by **both** read routes —

```
const READ_BOUND_SQL = ` AND created_at < to_timestamp($3::double precision / 1000) + interval '1 millisecond'`;
```

i.e. the bound now covers the whole millisecond it names. Every message the reader could have loaded
is included; a message that lands later stays unread, with the residual race bounded by 1 ms instead
of the previous unbounded mark-all. The structural test that had pinned the old expression was
updated to pin the corrected one (and to assert there is exactly ONE fragment, so the two routes
cannot drift apart).

### D4 — two test-side expectation bugs (`b2c6ef7`, `0680668`)

- The isolation test asserted a seller has `1` unread **from their own outgoing message** — the server
  (correctly) never counts a sender's own message (`sender_id <> viewer`). Rewritten to put one
  message each way in pair A, which proves the same isolation claim more strongly (A has 1/1, B has
  0/0 on both sides).
- The "unusable bound is a 400" probe sent `Number.NaN`, which `JSON.stringify` turns into `null` —
  the **absent** legacy case, answered 200 with a mark-all (it would have marked messages the reader
  never loaded). The probe now sends values the wire really carries (a negative number and a
  non-numeric string) and asserts the unread count is untouched by the refusal.

## 4. Phase 2D E2E results (final run `40601957381`, disposable PostgreSQL)

| Requirement | Test | Result |
|---|---|---|
| authentication | every chat endpoint refuses an unauthenticated caller (7 endpoints incl. account-summary) | **PASS** |
| customer + seller ownership isolation | customer B and seller B cannot reach customer A's conversation | **PASS** |
| sender identity | sender identity comes from the session even when the body lies (forged `senderId`/`senderRole`) | **PASS** |
| empty/whitespace validation | empty and whitespace-only messages are rejected, never persisted | **PASS** |
| duplicate send | a retried send creates one message, one push and one notification | **PASS** |
| unread lifecycle | unread counts are correct, and a stale read never swallows a new message | **PASS** |
| stale-read race | same test — stale bound marks 0, unread stays 1; NaN-free unusable bound → 400 | **PASS** |
| unread isolation | unread counts never leak across customers or shops | **PASS** |
| addressed realtime delivery | an incoming message and a read receipt reach only the counterparty | **PASS** |
| conversation identity | repeated get-or-create returns the same conversation | **PASS** |

Structural (no-DB) half of the same file: 18 tests, **all PASS** in every run above. Local
(non-CI) run of the file: `18 pass / 11 skip / 0 fail` (the DB half skips without
`TEST_DATABASE_URL`, as designed).

**Phase 2D E2E: PASS** (all required claims verified against a real disposable database in CI).

## 5. Pre-existing CI failures (NOT Phase 2D — FOLLOW-UP, not touched)

All 11 remaining failures are DB-gated tests that drive card checkout and receive **503**:

- `buy-now-checkout.test.ts` (line 332 ×3, 372, 407, 448) and `realtime-commerce-phase2c.test.ts`
  (641, 685, 713, 734, 784) — every failure is `Expected: 200/400, Received: 503`.
- Root cause, verified in source: `POST /api/customer/checkout` defaults/tests `paymentMethod: "CARD"`
  → `assertPaymentMethodUsable("CARD")` → `stripeStatus()` requires `STRIPE_SECRET_KEY`
  (`backend/lib/payment-config.ts:159–181, 405–412`) → with no Stripe env the endpoint answers
  **503 `STRIPE_NOT_CONFIGURED`** *before* any stock/idempotency logic runs
  (`backend/routes/cart.ts:782–788`).
- `test.yml` deliberately references **no secret**, and `COD_ENABLED` is unset (COD rail off), so no
  rail is usable in CI. These tests cannot pass there today — an owner decision (CI-only dummy Stripe
  test values, a COD-enabled job, or marking them environment-dependent) is required. Reviewed,
  documented, **not modified**: Stripe/payment/checkout are outside Phase 2E scope.
- Flake observed once: `order-number.test.ts:122` (`> 1800` distinct of 2000 random-suffix draws;
  1797 observed in run `40600703186`) — passed in the four other observed runs. Order domain, not
  Phase 2D; left untouched.

## 6. Responsive / visual audit (source inspection only — see §8 for the browser status)

Seller (`packages/shared/src/components/AppHeader.tsx`, badge from `use-chat-unread.ts`):

- **Desktop** entry: badge is an inline flex item inside the nav `Link` (`ml-0.5 … min-w-4 px-1`),
  so it pushes the label instead of overlapping it; no absolute positioning at this breakpoint.
- **Tablet/phone** entry (`<lg` icon): badge is `absolute right-0 top-0` inside a `size-10` box with a
  centered `size-5` icon — standard corner badge, does not cover the glyph.
- `99+` cap; hidden at `0`; **loading renders nothing** (`count === null` ⇒ no element — no fake
  number); **error keeps last-known-good** (`setState({ count: state.count, status: "error" })`), and
  a first-load failure stays `null` rather than becoming a fake `0`.
- a11y: the icon entry carries `aria-label="แชท (N)"` when a count exists and `aria-current="page"`
  when active; the desktop entry exposes the number as text inside the link.
- Long translated labels: labels and badge are separate flex items (`gap-1.5`), so a long label wraps
  rather than colliding. No layout change at 375/768/1024+.

Customer (`apps/velshop/src/pages/ShopProfile.tsx`, Communication section, `/chat` row):

- Badge renders only when `showBadge > 0`; `chatUnread ?? 0` therefore renders nothing while unknown.
- The badge is a `shrink-0` flex item between a `min-w-0 flex-1` + `truncate` text block and the
  chevron: long Thai/English/Burmese copy truncates, never overlaps the badge.
- `99+` uses the same already-shipped token as the notifications badge (`size-5`, `text-[11px]`).
- One-column list (`max-w-3xl px-4 sm:px-6`) — no width-specific behaviour to differ from.

UX cases 1–9 (from the task): verified in source + tests — **1** `0` → no badge; **2** `1` → `1`;
**3** `>99` → `99+` (existing convention); **4** `null` → no badge, never `0`; **5** error after a
known count keeps last-known-good; **6** `chat:message` refreshes through the existing shared socket
(no polling introduced); **7** reconnect refetches authoritatively (no duplicate subscription — one
effect per `(active, userId, viewer)`); **8** a successful read calls `notifyChatUnreadChanged`, the
count then comes from the server; **9** an account switch drops the previous number immediately
(`ownerUserId/ownerViewer` guard ⇒ `null`, never the old count).

## 7. Chat-send regression, realtime and security audits

- **Send failure → draft + clientId** (`ShopChat.tsx`, `SellerChat.tsx`): both keep a
  `retryRef { clientId, body }`; the clientId is reused only when the retyped text matches, the draft
  is restored on failure, and the server replays the stored message for a repeated
  `(conversation, user, clientId)` — pinned by the CI-passing "a retried send creates one message, one
  push and one notification". **No DB unique constraint was added** (as required).
- **Realtime invariants**: one WebSocket (`chat-socket.ts`) owned by `RealtimeProvider`; the unread
  hook subscribes to the existing `chat:message` + reconnect signals only; no polling, no second
  client, no duplicate provider. Verified structurally and by the passing realtime test.
- **Security**: unauthenticated callers rejected (401) on all chat endpoints; cross-customer and
  cross-seller reads are 404 and cannot be widened by the client; sender identity/role come from the
  session (forged body fields pinned by test); unread counts are SQL-scoped per viewer. All PASS in
  the final CI run. No authorization was loosened anywhere in this phase.

## 8. Browser / E2E status

**BROWSER/E2E: NOT RUN.** No browser, screenshot or DOM-driving capability exists in this environment
and the repository ships no frontend test tooling (no vitest/jsdom/testing-library/playwright in any
`package.json`); the host preview has no configured command (`freebuff-preview status` →
`previewCommand: null`). Responsive/visual statements above rest on **source inspection** plus the
passing build/typecheck of the four apps — they are not a rendered-pixels verification. A visual pass
over the seller header (both breakpoints) and the profile `/chat` row remains the owner's to run.

## 9. Local verification battery (final tree, `0680668`)

| Command | Result |
|---|---|
| `bun run typecheck` | PASS — 4/4 apps, exit 0 |
| `cd backend && bun run typecheck` | PASS — exit 0 |
| `bun run build:apps` | PASS — 4/4 built, exit 0 |
| `bun run i18n:check` | PASS — th=1257 en=1257 my=1257 at parity |
| `cd backend && bun test tests/chat-support-phase2d.test.ts` | `18 pass / 11 skip / 0 fail` (117 assertions) |
| `cd backend && bun test tests` | `1033 pass / 332 skip / 0 fail` (1365 tests, 66 files) |
| `git diff --check` | clean |

None of the local runs executed the DB-gated half — **CI is the only executor** of those, which is
precisely what this phase was for.

## 10. Boundaries confirmed from the real diff

`git diff --name-only d7c7eef..0680668` → **only** `backend/routes/chat.ts` and
`backend/tests/chat-support-phase2d.test.ts`. No `db/*.sql`, no schema, no migration, no Stripe or
payment file, no VelRepeat, no `apps/**` UI file (so the audit surfaces are byte-identical to Phase
2D's). No production database was contacted at any point.

## 11. Unresolved risks and next steps

1. **CI payment rail (FOLLOW-UP, owner decision):** 11 DB-gated checkout tests stay red on every push
   until CI has a usable payment rail (CI-only dummy Stripe test config, a COD-enabled job, or an
   explicit environment-gated skip). Root cause above; not a Phase 2D or 2E defect.
2. **Flaky statistical test (FOLLOW-UP):** `order-number.test.ts:122` (`> 1800`) failed once in five
   observed runs (1797). Order domain — untouched here.
3. **Load-older pagination precision (FOLLOW-UP, Phase 2B code):** `loadMessages` passes the same
   ms-truncated value with a strict `created_at <` to `before`; a message sharing the anchor's
   millisecond but microseconds older could be skipped when paging. Rare, and outside 2D/2E scope.
4. **Residual ≤1 ms window** on the read bound (documented in `READ_BOUND_SQL`): a message landing in
   the same millisecond as the reader's bound can still be marked read. The badge itself re-reads the
   server, so the count remains authoritative.
5. **Unchanged from 2D/2C:** in-process send dedupe (restart forgets it), outbox drain worker, 30 s
   role staleness on private channels, seller badge refetch per page mount.

**NEXT (owner):** approve the CI payment-rail decision (1), then Phase 2F/next scope. The Phase 2D
feature set itself is now verified end-to-end in CI.
