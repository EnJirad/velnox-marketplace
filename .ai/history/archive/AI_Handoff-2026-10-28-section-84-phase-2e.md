# Handoff §84 — Phase 2E CI/E2E Verification + Responsive/Visual Audit (2026-10-28)

Moved **verbatim** from `.ai/AI_HANDOFF.md` on 2026-10-30 (edit-headroom
housekeeping while appending §87; the current-state file was 54.6 KB against the
~55 KB edit-tool limit). Nothing was discarded. The condensed current-state
pointer lives in [`.ai/AI_HANDOFF.md` §84](../../AI_HANDOFF.md).

---

## §84. Phase 2E — CI/E2E Verification + Responsive/Visual Audit (2026-10-28) — **COMPLETE**

**Base SHA:** `d7c7eefaee7d389e153ee956d51c116352cb72aa` (`main` == `origin/main`, 0/0, clean tree).
**Resulting commits (code):** `ca66c4cb1094a74602a77a7934e4e26d84c9e793` (`test(chat): verify phase 2d
realtime and unread behavior`), `b2c6ef790390a0835370226e5e93848ce4dfd424` (`fix(chat): apply the read
bound at its real millisecond precision`), `06806685c8f95381d1cbd06f1b22de4cc59b6235` (`test(chat):
probe the unusable read bound with wire-valid values`) — only `backend/routes/chat.ts` and
`backend/tests/chat-support-phase2d.test.ts`.
**Report:** [`.ai/history/2026-10-28-phase-2e-verification.md`](history/2026-10-28-phase-2e-verification.md).
**SOURCE CODE MODIFIED: YES · DATABASE MODIFIED: NO · SQL MODIFIED: NO · PRODUCTION DB CONNECTED: NO ·
STRIPE MODIFIED: NO · VELREPEAT MODIFIED: NO**

**CI VERIFICATION: RUN** (the Phase 2D suite had never executed — it skips without `TEST_DATABASE_URL`).
Real runs on the workflow's disposable `postgres:16`: `40546404703` (`d7c7eef`) 1338 pass / **15 fail** /
2 skip → `40600703186` (`ca66c4c`) 1339/14/2 → `40601550666` (`b2c6ef7`) 1341/12/2 → **`40601957381`
(`0680668`) 1342 pass / 11 fail / 2 skip**. The whole delta is the Phase 2D file: all 4 of its failures
now pass, and it has **zero failures**. The 11 remaining failures are IDENTICAL to the pre-2D baseline
`40533019916` (`1a4cce0`: 1315/11/2) — pre-existing, see the follow-up below.

**What 2E fixed (all in the Phase 2D file, plus one SHIPPED defect):**
- **Shipped defect — the `upTo` read bound used the wrong precision.** `createdAt` reaches clients as
  epoch MILLISECONDS (`mapMessage` → `new Date(...).getTime()`) while `created_at` is a microsecond
  `TIMESTAMPTZ DEFAULT NOW()`: the strict `created_at <= to_timestamp(upTo/1000)` EXCLUDED the very
  message the reader derived the bound from (`…:123456` is not `<= …:123000`), so a bounded read
  marked 0 and a thread could never be cleared (both chat pages send exactly that value). Fixed with
  ONE documented, sargable `READ_BOUND_SQL` in both read routes
  (`created_at < to_timestamp(…) + interval '1 millisecond'`): the whole named millisecond is covered,
  a later message stays unread, residual race ≤1 ms instead of the previous unbounded mark-all.
- The harness mounted only `setupChatRoutes`, so the badge endpoint `GET /api/customer/account-summary`
  (routes/index.ts) answered 404 — it now mounts the REAL `setupRoutes` too.
- The addressed-frame assertion expected `channel: "chat:message"`; the real contract is the
  recipient's private channel `user:<id>` (consumers dispatch on event TYPE).
- Two test expectations: a seller's OWN message is never unread for the seller (the isolation test now
  sends one message each way); the "unusable bound → 400" probe sent `NaN`, which `JSON.stringify`
  turns into `null` — the ABSENT legacy case answered 200 (now a negative number + a non-numeric string).

**Verified in CI (final run, Phase 2D file):** authentication (all 7 chat/unread endpoints), customer +
 seller ownership isolation, session sender identity (forged `senderId`/`senderRole` ignored),
empty/whitespace rejection, duplicate send → one row + one push + one notification, unread lifecycle
incl. the stale-read race, unread isolation, addressed realtime delivery — **all PASS**; the 18
structural cases PASS in every run. Locally: 4 app typechecks PASS · backend typecheck PASS ·
`build:apps` PASS (4/4) · i18n `1257/1257/1257` · `bun test tests` 1033 pass / 332 skip / 0 fail ·
`git diff --check` clean.
**BROWSER/E2E: NOT RUN** — no browser/DOM capability here and NO frontend test tooling in the repo
(no vitest/jsdom/testing-library/playwright; preview has no configured command). The responsive audit
(seller header chat entries at both breakpoints incl. `99+`, hidden-at-0, loading renders nothing,
error keeps last-known-good, a11y labels; customer profile `/chat` row with `shrink-0` badge beside
`truncate`d text; UX cases 1–9) is **source-based only** — rendered-pixels verification is the owner's.

**Still open / FOLLOW-UP (owner decisions):**
- **The 11 CI failures are pre-existing, not 2D/2E.** They drive `POST /api/customer/checkout` with
  `paymentMethod: "CARD"` (6 `buy-now-checkout` + 5 `realtime-commerce-phase2c`) and every one is a
  **503 `STRIPE_NOT_CONFIGURED`** from `assertPaymentMethodUsable`
  (`backend/lib/payment-config.ts:159–181, 405–412`, refused at `routes/cart.ts:782–788` before any
  stock/idempotency logic). `test.yml` references no secret BY DESIGN and `COD_ENABLED` is unset, so no
  rail is usable in CI. Needs a CI-only payment rail, a COD-enabled job, or an explicit
  environment-gated skip. Payment/checkout/Stripe were NOT touched (out of Phase 2E scope).
- Flake observed once in five runs: `order-number.test.ts:122` (`> 1800` distinct draws → 1797).
- Phase 2B `loadMessages` passes the same ms-truncated value with a strict `<` to `before` (rare skip
  when two messages share a millisecond); Phase 2D residual ≤1 ms read window; the §83 open items
  (in-process send dedupe, outbox drain worker, seller badge per-mount fetch).
**Housekeeping this pass:** §82 moved verbatim →
[`history/archive/AI_Handoff-2026-10-27-section-82-phase-2c.md`](history/archive/AI_Handoff-2026-10-27-section-82-phase-2c.md)
with an index row.
