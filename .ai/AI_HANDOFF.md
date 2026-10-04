# Velnox AI Handoff — current state

**Last updated:** 2026-09-30 · **Branch:** `main` · **Latest pass:** VelRepeat **V2 Phase 1 — domain + schema implemented** (**§53**) — additive only; payment linkage (Q13) + decisions **A–I** still BLOCKED; no migration file (auto-apply hazard)
**Canonical location:** `.ai/AI_HANDOFF.md` — the root `AI_Handoff.md` is a pointer. **Workspace:** `.ai/README.md`

> **Keep this file small.** This environment's file-edit tools stop matching past
> roughly **55 KB** in a file, so a handoff that grows past that can no longer be
> edited in place. New work is appended at the bottom; if this file approaches
> ~40 KB, move the oldest dated section to the archive instead of growing it.
>
> - History index → [`.ai/history/AI_Handoff_Archive.md`](./history/AI_Handoff_Archive.md)
> - Full verbatim records → [`.ai/history/archive/`](./history/archive/)

---

## 1. What Velnox is

Multi-vendor marketplace. Four Vercel frontends → one Render backend (Express +
WebSocket) → Neon PostgreSQL (source of truth) + Cloudflare R2 (file storage).

| Piece | Path | Role |
|---|---|---|
| velShop | `apps/velshop` | customer storefront, cart, checkout, VelRepeat |
| velSeller | `apps/velseller` | seller workspace (products, orders, income, goals) |
| velCenter | `apps/velcenter` | staff / company operations console |
| velNox | `apps/velnox` | corporate site |
| API | `backend` | Express + `ws`; the only thing that talks to Neon |
| Shared | `packages/shared` | UI kit, i18n, api client, `api-routes.ts` |
| DB | `db/schema.sql`, `db/run-sqleditor.sql` | canonical, must stay structurally byte-identical |

- **Auth:** Google OAuth + JWT in the `velnox_session` httpOnly cookie, plus
  member-ID/password login for VelCenter staff (scrypt, `backend/lib/password.ts`).
- **Languages:** `th` (source of truth for the key shape), `en`, `my`. Parity is
  enforced by `bun run i18n:check`.
- **Source of truth chain:** Neon → backend API → frontend. Frontends never touch
  Neon and never hold server secrets.
- `db/run-update.sql` is **deprecated** — never create, edit or reference it.
- Schema changes update **both** `db/schema.sql` and `db/run-sqleditor.sql`.

## 2. Verification — exactly ONE system

**Live content moved to [`.ai/context/verification.md`](context/verification.md)**
(2026-09-26, TASK 007) to keep this file under the ~55 KB edit limit. Velnox has ONE
verification system — SELLER/SHOP identity verification, no product verification:
`seller.verification_status = 'verified'` is what gives every product of that seller
the single green V badge. The context doc carries the V rule, the `sellers.status`
state machine, the transactional submission rule (`NO SUCCESSFUL EVIDENCE
PERSISTENCE = NO PENDING VERIFICATION`), structured review reasons, review history,
evidence-URL security, the self-approval guard, and the verification API surface.
Pre-move text (verbatim):
[`history/archive/AI_Handoff-2026-09-25-verification-system.md`](history/archive/AI_Handoff-2026-09-25-verification-system.md).

## 3. Realtime

One WebSocket per client at `/ws`. **Events are signals, never data** — every
consumer refetches from the API. No `setTimeout` fake-realtime anywhere.

Socket rules: authenticated by the session cookie at upgrade; revoked tokens are
swept every 30 s and closed with `4001`; a client may subscribe only to its own
`user:{id}` channel or to the public allowlist; frames >4 KB close the socket, and
>120 frames / 10 s closes with `1008`.

| Channel | Published by | Consumed by |
|---|---|---|
| `product:updated` | `products.ts` (`product:moderated`) | moderation queue · audit |
| `seller:updated` | `verification.ts` (`seller:status-changed`) | verification queue · seller list · audit |
| `order:updated` | `center.ts` · `cart.ts` · `seller-orders.ts` · `stripe.ts` | orders tab (via `orders` event) |
| `audit:created` | `lib/audit-log.ts` — the single choke point every audit writer goes through | audit tab |
| `config:updated` | `server.ts` — one scoped choke point for `/api/admin/categories[/…]` and `PATCH /api/admin/settings`, 2xx only | categories tree · settings form |
| `notification:created` | `center.ts` (employee create/update) · `verification.ts` / `chat.ts` (via `sendToUser`) | roster · directory · the user's own bell |

VelCenter fans one socket message out through
`apps/velcenter/src/lib/center-events.ts` (`products` · `sellers` · `orders` ·
`staff` · `audit` · `config`); each tab then re-reads from the API.

## 4. VelCenter authorization

One catalog, `backend/lib/permissions.ts` — `owner`/`admin` implicitly hold every
code, `staff` hold exactly `employees.permissions`, anyone else holds none.
`resolvePermissions()` is **deny-by-default** (missing row, malformed JSON or a DB
error returns `[]`, never throws).

| Code | Surface |
|---|---|
| `orders.view` | orders list |
| `orders.manage` | order status |
| `products.moderate` | product moderation — list · detail · decision |
| `sellers.manage` | seller administration + verification decisions |
| `users.manage` | customer / staff directory |
| `staff.manage` | employee roster (read-only for non-owners) |
| `audit.view` | audit logs |
| `settings.manage` | company / system settings (read + write) |

A code belongs in the catalog **only while an endpoint checks it** —
`center-rbac.test.ts` asserts that. Role / permission / employee mutations stay
owner-only. Hiding a tab is UX only; every endpoint re-checks.

## 5. Latest passes — archived (moved 2026-09-29, edit-headroom housekeeping)

The chronological "Latest passes" narratives moved **verbatim** to
[`history/archive/AI_Handoff-2026-09-29-latest-passes.md`](history/archive/AI_Handoff-2026-09-29-latest-passes.md)
(index row: [`history/AI_Handoff_Archive.md`](history/AI_Handoff_Archive.md)) so the current
records could be appended. It describes **completed** work only — the live list of what is
still open is **§6 below**, which stayed inline, and the current work is **§43–§46**.

## 6. Remaining gaps / open items

### Open, actionable

- **Stripe TEST round trips still unproven — the gate is the EXECUTION SURFACE, not configuration**
  (§64, §18). Runtime config re-verified live on the traffic host 2026-10-03: `{configured:true,
  mode:"test", webhookConfigured:true}`, CARD + PROMPTPAY (COD off), webhook refusing forgeries
  (400). Unproven: the checkout round trip itself (no PaymentIntent, PromptPay QR, webhook delivery
  or refund ever executed) — no `velnox_session` cookie can be minted from this workspace (no
  browser, no test account) and Checkout is Stripe-hosted. **CODE VERIFIED, never PASS.**
  `STRIPE_CONNECT_MISSING`: no Connect, no payout (checkout ≠ payout readiness). Variables:
  `INSTALLATION.md` §4 + `docs/ENVIRONMENT.md`; `.env.example` is owner-edit only.
- ~~**The DB-gated tests have never been executed in this workspace.**~~ **CLOSED** — they run
  against a disposable Postgres, including the two self-approval HTTP cases. **Production Neon is
  verified read-only (§9):** ledger matches `main`, 041–046 repairs applied. Remaining: a fresh
  catalog read of four low-severity details (§9.4); `diag-neon-schema.yml` still cannot be
  dispatched from a workspace (403).
- **`backend/tsconfig.json` excludes `tests`**, so `tsc` never validates test files — a syntax
  error or bad import surfaces only when `bun test` parses it. After editing a test, run that file.

- ~~**Closed gap records moved out of this file.**~~ **ARCHIVED 2026-09-29** →
  [`history/archive/AI_Handoff-closed-gaps-2026-09-29.md`](history/archive/AI_Handoff-closed-gaps-2026-09-29.md)
  (self-action guard, unbounded admin lists, unpaginated verification queue, DB constraint
  repairs, non-idempotent fixtures, corrupted revoke string). Closed items are not gaps.
- **`shops.seller_id` is not UNIQUE** (`idx_shops_seller` is a plain index), so a two-shop
  seller would make the verification queue list one verification twice (`COUNT(*) OVER()`
  counts it twice too). The app upserts one shop per seller, so it is latent, not observed.
  Fix if multi-shop sellers ever exist: `COUNT(DISTINCT sv.id)` + de-duplicated listing.
- ~~**VelCenter's verification queue labels are hardcoded Thai**~~ **CLOSED (2026-09-26, §20)** —
  every string renders through the existing `review.*` namespace. `ProductModerationQueue.tsx`'s copy
  is still hardcoded Thai (pre-existing).
- **Migration numbering has duplicates** (029, 030, 034, 035). A prefix-keyed runner applied only
  one file per number, which is how the V0035 repair was skipped. New migrations must use an unused
  number; consider renumbering.
- **Channels with no publisher.** `cart:updated`, `order:created` and
  `inventory:updated` are in the subscribe allowlist but nothing broadcasts them
  (**measured 2026-09-26, §19:** 0 `CHANNELS.*` publisher sites each; `order:updated` 14,
  `product:updated` 1, `seller:updated` 1). Harmless today (no consumer subscribes),
  but they are dead entries.
- **The `velnox.com` zone does not resolve** (Google DoH `Status: 2`, "Name servers
  refused query (lame delegation?)"; `center.velnx.com` is NXDOMAIN). Production is unaffected —
  every Vercel project sets `VITE_*` overrides and no deployed bundle references `*.velnox.com` —
  but the `sites.ts` defaults point at dead hosts.
  Owner action: fix the NS delegation or stop treating those defaults as live.
  See §19 finding 1.
### Known-accepted (deliberate, not to "fix" casually)

- **Legacy DB objects retained on purpose:** `product_verifications`,
  `products.verification_status`, `products.verified_at`. Deprecated and
  unwritten; drop only after confirming no historical rows matter.
- **Legacy i18n strings remain:** unused `productVerification*` keys in
  `th.ts`/`en.ts`/`my.ts`. Removing them from only some locales would break
  `i18n:check` parity, so leave them until those large files can be rewritten
  wholesale.
- **Evidence signed URLs expire after 5 minutes.** A reviewer who leaves the dialog
  open longer must reopen it; the dialog says so.

### Verification gaps (not defects)

- **No live browser E2E has ever been run from this environment.** Responsive
  behaviour at 320–430 px, the object-URL image preview, the R2
  presign→PUT→confirm round trip and the WebSocket round trips rest on source
  inspection plus contract tests.
- **The presign → PUT → confirm round trip is still not executed against
  production** (no safe production test account exists in this workspace).
  What IS now production-verified (TASK 002, 2026-09-23 — archived under
  `history/archive/AI_Handoff-2026-09-23-r2-media-verification.md`): R2 configured + bucket
  reachable via `GET /api/health/r2`, `R2_PUBLIC_DOMAIN` serving real objects
  (200 `image/jpeg`, missing key → 404), and the 401 auth boundary on all four
  upload endpoints. What remains source-only: the authenticated upload, the
  media row it would create, the failed-upload path, the 10 MB boundary,
  replace/delete, and the browser-side preview.

### Environment constraints (tooling, not product bugs)

- **Files above ~55 KB cannot be edited in place.** Matching stops past that
  offset, so `backend/routes/products.ts` (3,856 lines) cannot be changed by the
  edit tools at all — a change there currently has to be made another way (that is
  why the `config:updated` publish lives in `server.ts` rather than in each
  category handler). **Working recipe (2026-09-26, §20):** a small `bun` script that
  asserts each anchor occurs exactly once, rewrites the file, and is deleted right
  after `git diff` + the tests confirm the result.
- **Very large docs are read-only in practice.**
  `.ai/history/archive/AI_Handoff-2026-09-14.md` (~335 KB) and
  `…-2026-09-22-full.md` (~97 KB) are verbatim records — read with windows, never whole-file.

## 7. Where to look next

```
AGENTS.md → .ai/AI_RULES.md → .ai/context/project-map.md → .ai/context/<subsystem>.md → source
```

Subsystem docs (all under `.ai/context/`): `architecture`, `database`, `backend`,
`frontend`, `realtime`, `security`, `products`, `categories`, `seller`,
`customer`, `checkout`, `media`, `project-map`, `testing`, `workflow`,
`troubleshooting`. The repository is always authoritative over any document,
including this one.

## 8. Agent workspace moved to `.ai/` (2026-09-23)

**Archived** (closed structural record) →
[`history/archive/AI_Handoff-2026-09-23-ai-workspace-move.md`](history/archive/AI_Handoff-2026-09-23-ai-workspace-move.md).
Moved 2026-09-25. The layout it describes **is** the current state; the live
conventions are in `AGENTS.md` and `.ai/README.md`.

---

## 9. Production Neon — read-only verification (TASK 001, 2026-09-23)

**READ-ONLY.** No source, schema, migration, workflow or data change; nothing
was connected to from this workspace (no database credentials are readable here,
by platform design). Every fact below is the **production database's own
response**, captured from the production migration runner (`migrate-neon.yml`,
secret `NEON_DATABASE_URL` — documented as the production DB in
`context/database.md`) — not a filename check, not a local/test database.

**Closed evidence (method, migration ledger, verified-object table) archived** →
[`history/archive/AI_Handoff-2026-09-23-neon-readonly-verification.md`](history/archive/AI_Handoff-2026-09-23-neon-readonly-verification.md).
Moved 2026-09-25 to keep this file small. Headline result: the production
`schema_migrations` ledger matched `db/migrations/*.sql` **exactly** (49 rows /
49 files, none missing or orphaned), captured from `migrate-neon.yml` logs — no
credential was ever read or printed, and nothing was written.

### 9.4 Still NOT VERIFIED (needs a fresh catalog read)

1. `notifications.user_id` nullability — canonical is `NOT NULL`, no migration
   loosens it, and all four writers pass a recipient.
2. The canonical index **names** `idx_notifications_user` / `idx_notifications_read`
   — no migration creates them (only the bootstrap files do); the proven
   functional equivalents are `idx_notifications_user_id` + `idx_notifications_unread`.
3. `shops.idx_shops_seller` — present only in the bootstrap files and absent from
   every run log. Low/latent: a plain index, relevant only if a seller ever gets
   two shops.
4. The full `audit_logs` column list and its FK to `users` — the app writes 6 of
   the 7 canonical columns and has been served in production.

### 9.5 Next action

Run `.github/workflows/diag-neon-schema.yml` from **Actions → Velnox Neon Schema
Diagnostic → Run workflow**. It has **never** been dispatched
(`gh run list --workflow=diag-neon-schema.yml` is empty) and cannot be dispatched
from a workspace (`403 Resource not accessible by integration`); granting the
GitHub App **Actions: read/write** would allow it. Extend the probe with the two
notification index names if item 2 above is to be closed.

### 9.6 Safety notes from this pass

Never run `bun test backend/tests` where `DATABASE_URL` could point at production:
the DB-gated fixtures **delete** rows (`backend/tests/helpers/purge.ts`). No
credential, URL, password, token or hash was printed — the workflow references the
secret only as `psql "$NEON_DATABASE_URL"` and never echoes it.

---

## 10. Production R2 / media — read-only verification (TASK 002, 2026-09-23)

**Archived** → [`history/archive/AI_Handoff-2026-09-23-r2-media-verification.md`](history/archive/AI_Handoff-2026-09-23-r2-media-verification.md).
Moved 2026-09-25 to keep this file small. Its findings were all fixed in §11
except #7; #7's **root cause** is now closed by §13, and only its production
*data* cleanup (an owner action needing no code) remains open there.

---

## 11. Media security fixes (TASK 003, 2026-09-24) — archived

**Archived** (full table + validation) →
[`history/archive/AI_Handoff-2026-09-29-media-security-t003.md`](history/archive/AI_Handoff-2026-09-29-media-security-t003.md).
Closed: the `profile-image` route deleted, the presign `purpose` allowlist, server-derived
reference targets, WebP enforcement, `IMAGE_SAVE_FAILED` before any write, and the two
un-awaited `deleteR2Object` calls. **Still OPEN: finding #7 — production data cleanup**
(a data task, not a code path; its root cause is closed by §13). No DB change.

---

## 12. Startup-sync rule + root AI files removed (2026-09-25)

**Archived** (closed docs record) →
[`history/archive/AI_Handoff-2026-09-25-docs-consolidation.md`](history/archive/AI_Handoff-2026-09-25-docs-consolidation.md).
Moved 2026-09-25. The rules are live in `.ai/AI_RULES.md` §0, `AGENTS.md` rule 0.

---

## 13. Test database isolation (TASK 004A, 2026-09-25)

**Archived** (closed structural record) →
[`history/archive/AI_Handoff-2026-09-25-test-database-isolation.md`](history/archive/AI_Handoff-2026-09-25-test-database-isolation.md).
Moved 2026-09-26 (§20) to stay under the ~55 KB edit limit. The live rules are
[`.ai/context/testing.md`](context/testing.md) and `.github/workflows/test.yml`; the
guard is `backend/db/test-database.ts`. Still-open items stayed in §6. The variable names
are now documented in `INSTALLATION.md` §4 + its *Backend (ALL secrets)* table and
`docs/ENVIRONMENT.md` (§27); `.env.example` still lacks them — that path is in the agent
tooling's protected set, so it stays an owner edit.

---

## 14. Production R2 authenticated round-trip (TASK 004B, 2026-09-25) — **BLOCKED**

**Overall: BLOCKED at the account hard gate.** Every read-only / unauthenticated /
code-level check passed; the authenticated production chain (presign → R2 PUT →
confirm/save → media row → API read → UI → replace → delete → cleanup) **was not
executed at all** and must not be reported as PASS. **Zero production writes**,
no production DB touched, no credential read.

**Why BLOCKED.** No safe authorized production test account exists; this
workspace holds **no** `DATABASE_URL`, `TEST_DATABASE_URL`, `JWT_SECRET` or R2
credential, and the only login is Google OAuth in a browser. Minting a production
user by SQL, reusing a real account, or fabricating a JWT are forbidden → steps
9–23 are **BLOCKED / NOT TESTED**, not failed. **UI/browser E2E has still never
been run from this environment** → `UI NOT VERIFIED`.

**Still-live observation:** a ~4-minute window on 2026-09-25 where every
POST/PATCH with a JSON body returned 500 (even on a non-existent route) while
GETs stayed 200 — never reproduced, **no root cause proven**, likely a Render
cold-start. Production logs are unreachable from this workspace.

**Verified (read-only):** `/api/health` 200, `/api/health/r2`
`{configured:true,bucket:true,verify:true}`, `/api/shops` 200; removed
`PATCH /api/customer/profile-image` → 404; six canonical media endpoints → 401
without a cookie; untrusted `Origin` → 403.

**Provision to unblock:** an owner-provisioned production test account (a
dedicated customer, no real orders/payments) plus a live browser.

**Full evidence narrative (both passes) archived** →
[`history/archive/AI_Handoff-2026-09-25-t004b-r2-authenticated.md`](history/archive/AI_Handoff-2026-09-25-t004b-r2-authenticated.md)
— moved 2026-09-25 to stay under the ~55 KB edit limit.

---

## 15. Payment foundation — Stripe test mode, Card + PromptPay, COD OFF (TASK 005, 2026-09-25)

**Archived** (full text) → [`history/archive/AI_Handoff-2026-09-25-payment-foundation.md`](history/archive/AI_Handoff-2026-09-25-payment-foundation.md).
Live reference: [`.ai/context/payment.md`](context/payment.md) — read that, not this line.

Built ON the existing Stripe code (V0023) — no second payment system, no duplicate table.
**Stripe: TEST MODE ONLY; COD stays disabled.** The audit found the pre-existing code unsafe
(no PromptPay, no idempotency, sync `constructEvent`, any key accepted, `payment_events` marked
seen before processing, COD as the checkout DEFAULT, `refunds` a table with no code) and
`backend/lib/payment-config.ts` became the ONE decision point: test-mode-only key classification,
fail-closed COD flags, Card + PromptPay checkout, `constructEventAsync`, DATABASE-BACKED
idempotency (`checkout_requests` + `idx_payments_one_active_stripe` + atomic `payment_events`
claim/re-arm), separate order↔payment lifecycles, and refunds capped at the paid amount
(`orders.manage`). Schema: migration 047 + both canonical files; `run-update.sql` **not** created.

---

## 16. Stripe TEST-mode E2E verification (TASK 006, 2026-09-25) — **BLOCKED**

**Status: BLOCKED — Stripe TEST credentials unavailable** (unchanged). `freebuff-env
list` → `{"files":{}}`; no Stripe API call, PaymentIntent, PromptPay QR, webhook
delivery or refund has ever been executed. Pre-move evidence (probe table, tier
table, secret audit, unblock steps) is archived:
[`history/archive/AI_Handoff-2026-09-25-payment-foundation.md`](history/archive/AI_Handoff-2026-09-25-payment-foundation.md).
**Correction:** its claim that this sandbox has no `postgres`/`psql` binary was
wrong — PostgreSQL 14 IS installed there, and §18 records the DB-gated payment
tests executing (**560 pass / 2 skip / 0 fail**). Only the credential half stands.

---

## 17. CI guard fix — "Verify the guard refuses production" (2026-09-25)

**Archived** (closed record, pushed at the time) →
[`history/archive/AI_Handoff-2026-09-25-ci-guard-fix.md`](history/archive/AI_Handoff-2026-09-25-ci-guard-fix.md).
Moved 2026-09-27 to make room for §22. The fix is live in
`.github/workflows/test.yml` (`env -u TEST_DATABASE_URL` plus the
accepted-target assertion) and CI has been green on every push since, including
`c2d3639` (run 36283775266). Live rules: [`.ai/context/testing.md`](context/testing.md).

## 18. Stripe TEST-mode E2E — independent re-verification (TASK 007, 2026-09-26)

**Archived** (BLOCKED record; its statements are mirrored into
[`.ai/context/payment.md`](context/payment.md)) →
[`history/archive/AI_Handoff-2026-09-26-stripe-e2e-tasks.md`](history/archive/AI_Handoff-2026-09-26-stripe-e2e-tasks.md).
Moved 2026-09-27 to make room for §23. **Stripe TEST E2E stays BLOCKED** (§6, §22):
credential gate unchanged, no PaymentIntent / PromptPay QR / webhook delivery / refund
ever executed, production payment readiness **NOT claimed**.

## 19. Production-readiness audit — risk-ordered (TASK 009, 2026-09-26)

**Archived** (closed record) →
[`history/archive/AI_Handoff-2026-09-26-production-readiness-audit.md`](history/archive/AI_Handoff-2026-09-26-production-readiness-audit.md).
Moved 2026-09-27 to make room for §22. **PRODUCTION: NOT READY** and **PRODUCTION
PAYMENT READINESS: NOT CLAIMED** still stand; per-gate evidence is in
[`.ai/tasks/completed/production-readiness-audit-2026-09-26.md`](tasks/completed/production-readiness-audit-2026-09-26.md);
Stripe TEST E2E and production Browser / Google-OAuth / R2-authenticated E2E stay
**BLOCKED** (§6, §18).

## 20. Moderation-queue pagination + verification-queue i18n (2026-09-26) — archived

Full narrative: [`history/archive/AI_Handoff-2026-09-26-moderation-pagination-i18n.md`](history/archive/AI_Handoff-2026-09-26-moderation-pagination-i18n.md)
(this was the documented NEXT SPLIT; moved out on 2026-09-27). What stays live:

- `GET /api/admin/products/moderation` is bounded and returns `{products, pagination}`;
  `ProductModerationQueue.tsx` pages it (25) and its badge reads `pagination.total`.
- `SellerVerificationQueue.tsx` renders through the `review.*` namespace (24 keys added in
  th/en/my); the corrupted `ระงับและลบrêtailer แล้ว` string is fixed.
- Tooling note: both edits sat past the ~55 KB match window and were applied with a single-use
  `bun` anchor-asserting script.
- Still open / unchanged: §19's release blockers (Stripe TEST E2E, browser/OAuth/R2 E2E,
  `velnox.com` NS delegation, §9.4 catalog reads, dead realtime channels);
  `ProductModerationQueue.tsx`'s other copy is still hardcoded Thai (pre-existing).

## 21–22. PostgreSQL 53000 — first pass + provider-quota classification (2026-09-27) — archived

Both are **archived** (closed records; conclusions unchanged) →
[`history/archive/AI_Handoff-2026-09-27-postgres-53000.md`](history/archive/AI_Handoff-2026-09-27-postgres-53000.md)
and [`…-postgres-53000-classified.md`](history/archive/AI_Handoff-2026-09-27-postgres-53000-classified.md).
What stays live: production threw `53000` on **connect AND query** (a provider consumption quota, not a
connection or storage limit) and is **reachable again** (verified read-only 2026-09-27 08:09Z — `/api/shops`
200 with real rows); the VelRepeat 60 s poll (≈182 CU-h/month vs the 100 CU-hour Free-plan allowance) is
still an **owner cadence decision**, and the plan's Usage figures are still unreadable from a workspace.
One unrelated fix from that pass is kept: `POST /api/admin/sellers/:id/revoke` leaked one pool connection
per call (the only unreleased lease in the backend) and now releases it in `finally`
(`backend/routes/seller.ts`, guarded by `backend/tests/db-client-release.test.ts`). `backend/db/index.ts`
logs failed queries/connects with `operation` + PG `code`/`severity`/`message` only — never credentials or
parameters. Pool: exactly one `pg.Pool` (`max: 20`) shared by HTTP + WS + scheduler.

**Housekeeping (do not grow this file).** Superseded records live in [`history/archive/`](history/archive/)
with a dated index at [`.ai/history/AI_Handoff_Archive.md`](history/AI_Handoff_Archive.md) — §5, §8, §10, §11,
§12, §14's TASK 004B narrative, §15–§19 (incl. §2's verification system → `.ai/context/verification.md` and
§15–§16 → `.ai/context/payment.md`), §20–§36, §37–§41, **§42.1–§42.5** and **§5 "Latest passes"** (pointers above). The file-edit
tools stop matching past ~55 KB (measured 2026-09-26: ≤54.8 KB edits, ≥68.2 KB does not), so when appending
a record, move a superseded one to `history/archive/` and point at it. **Done 2026-09-29:** §42.1–§42.5 →
`AI_Handoff-2026-09-29-audit-findings-detail.md` (made room for §44/§45), §5 →
`AI_Handoff-2026-09-29-latest-passes.md` (§46), and §11 → `AI_Handoff-2026-09-29-media-security-t003.md`
plus a compressed §15 (made room for §48). Keep §6 (gaps), §9.4/§9.5, the §14 stub,
§18's BLOCKED statements and §42's verdicts.

**§27–§36 pointer (2026-09-27 → 2026-09-28).** Stripe sandbox audit; the velShop order-status contract +
cart selection; one-press checkout; the PromptPay settlement diagnostic; the webhook stall + signature
boundary; DB pool latency; customer order cancellation (its two owner-side items still open); the
superseded risk-based reservation v1. Each is recorded in full in `history/archive/` per the index above
(the per-file list was replaced by this pointer on 2026-09-29).

---

## 37–48. Archived (moved 2026-09-30, edit-headroom housekeeping)

§37–§48 (migration 048 read path, the Stripe TEST-mode E2E attempts and their BLOCKED verdicts,
the CI guard fix, the §42 full-system audit, §43 inventory CRITICAL #1/#2, §44 the paid-order
cancellation guard, §46 HIGH #4 payment attempt identity, §47 HIGH #5 late-payment operator
flow, §48 MEDIUM #9 `orders.status` CHECK) moved **verbatim** to
[`history/archive/AI_Handoff-2026-09-30-payments-and-audit-record.md`](history/archive/AI_Handoff-2026-09-30-payments-and-audit-record.md)
(index row: [`history/AI_Handoff_Archive.md`](history/AI_Handoff_Archive.md)).

**Still live from them:** the reservation is a **CONSTANT 30 minutes** · **migrations 048, 049 and
050 are still NOT applied in production** (Neon quota, §14/§16/§21–22) · real Stripe TEST E2E and
browser E2E have **never** run · the current status of every audit finding is the compact index in
**§51**, with MEDIUM #10 / #11, LOW #13/#14 and HIGH #4/#5 still **open**.

---

## 51. VelRepeat — Prepaid Repeat Commerce (2026-09-30) — CONTRACT COMPLETE, IMPLEMENTATION STOPPED — **ARCHIVED**

The audit-finding index and the three structural facts that stopped the prepaid implementation at
this point are archived verbatim in
`.ai/history/archive/AI_Handoff-2026-09-30-velrepeat-prepaid-contract-stopped.md`.

**Superseded, do not read as current:** all three blockers listed there were closed by §52–§58
(contract), Phase 3 (plan creation + pricing snapshot), Phase 4 (prepaid Stripe settlement) and
§62 (production migration). Its "migrations 048/049/050 still unapplied" line is **stale** —
production is at 051 (§62). Its MEDIUM #10 lifecycle blocker is now Phase 5, which is the next
safe phase.

---

## 52–63. VelRepeat V2 design sheets + phases 1–5 (2026-09-30/10-02) — ARCHIVED

All COMPLETE and closed. Moved verbatim to
[`history/archive/AI_Handoff-2026-10-04-sections-52-63.md`](history/archive/AI_Handoff-2026-10-04-sections-52-63.md)
(2026-10-04, edit-headroom housekeeping). Current state: §64–§66.

**Their "production applied + verified" claims are unproven** — §66 shows the Actions
ledger describes a different database from the one Render serves.

## 64. VelRepeat **V2 Phase 5 — migration 053 applied** (2026-10-03) — ⚠️ "verified" RETRACTED

> **Retracted 2026-10-04 (§66).** This section originally read "APPLIED + verified". The
> verification rested entirely on the Actions `schema_migrations` ledger, which §66 proves
> describes **a different database from the one Render serves**. 053 was applied to that
> other database. Nothing here was ever verified against production, and the same retraction
> applies to the "production migration 053" record in §62 (now archived).

**Migration 053 is IN PRODUCTION and verified** — applied by the Phase 5 push (`Migrate Neon Database` run
`37026940189`), so §62's "the cycle tables were never created" is **superseded**. Ledger row `69 | 053_… |
2026-10-02 15:26:29+00`; 001–053 applied, none pending. Verified read-only (`Velnox Neon Schema Diagnostic` run
`37082364439`): `velrepeat_cycles` + 12 columns + `UNIQUE (plan_id, cycle_number)` + both CHECKs + both indexes;
`orders.velrepeat_cycle_id uuid NULLABLE` + FK `ON DELETE SET NULL`; `idx_orders_velrepeat_cycle_seller_unique` =
UNIQUE `(velrepeat_cycle_id, shop_id)` partial (the exactly-once `(cycle, shop)` key). Rowcount 0 → additive.
**No local Neon credential** — production is reachable only through those workflows. Full detail:
`.ai/tasks/audits/velrepeat-v2-production-migration-053-2026-10-03.md`.

**Real Stripe TEST E2E: the CONFIGURATION blocker is GONE — the earlier "credentials missing" was a
measurement error.** Six prior checks measured the **Freebuff sandbox** (`freebuff-env list` /
`freebuff-deploy env list` describe Freebuff hosting, NOT Render). On the real runtime,
`GET /api/stripe/configured` → **`configured: true, mode: "test", reason: null`**, `?selfTest=1` →
`attempted: true, verified: true` (proving `getStripe()` built a non-null **test** client in the Render
process). `/api/payments/methods` → CARD + PROMPTPAY enabled, COD off. Webhook live, refusing forgeries (400).
Env names matched the code exactly (`payment-config.ts:160-163`). **RULE: verify runtime config against the host
that serves traffic (`velnox-api.onrender.com`), never the build sandbox.** Docs-only fix: `INSTALLATION.md`'s
Render env block had omitted all four Stripe vars.
**Still NOT production ready — the blocker is now the EXECUTION SURFACE, not credentials** (E2E attempt
2026-10-03T16:14–16:26Z at HEAD `8ef8c0b`, config re-confirmed live PASS). Both V2 money routes need the
`velnox_session` cookie (`requireAuth` reads only that cookie — no header/internal/cron path); minting it needs a
browser Google OAuth round trip, and this workspace has **no browser, no Playwright/Puppeteer, no provisioned test
account**. Payment is a Stripe **hosted** Checkout Session (no `confirm`/`pm_card_*` path exists in the repo), so
only a human in a browser can complete it — and only then can Stripe deliver the webhook. No staging backend
(`velnox-api-staging`/`-test` → 404). `runDueCycleTick()` has no HTTP/operator trigger (in-process job,
`server.ts:546`). **8 refusal paths WERE executed live** (forged/missing webhook signature → 400; V2
plan/payment/package + forged cookie → 401; `_diag` → 401), all stopping before any DB write. Regression re-run:
**1882/2/0** (`bun test` and `pnpm test`), tsc 0, backend typecheck 0, typecheck 4/4, build 4/4, schema identical,
diff clean. (`pnpm exec tsc -b` / `pnpm build` are not this repo's commands — bun workspace, no root tsconfig.)
Full detail: §18 of `.ai/tasks/audits/velrepeat-v2-real-stripe-test-e2e-2026-10-03.md`.

---

## §65. Multi-shop checkout, numeric order numbers, VelRepeat V2 customer UI (2026-10-04)

Three headline goals delivered end to end.

### 54.1 Public order numbers are DIGITS ONLY

`generateOrderNumber()` (`backend/lib/order-number.ts`) now returns **18 decimal digits**
(`^[0-9]{18}$`): 14-digit ms timestamp + 4 digits from `crypto.randomInt()`. No prefix, no letters,
no separator. The value is a **string everywhere** (18 digits > `Number.MAX_SAFE_INTEGER`); the
column stays `TEXT`. Legacy `VNX-YYYYMMDD-XXXXXX` rows keep their value — the column is nullable and
`idx_orders_number_unique` is partial — and `isLegacyOrderNumber()` recognises them.
VelRepeat cycle orders now carry a public number too (savepoint retry `cycle_order_number_attempt`).

### 54.2 One purchase, N fulfillment orders

- New `checkout_groups` table; `orders.checkout_group_id`; migration
  `db/migrations/054_checkout_groups_numeric_order_number.sql` (additive, idempotent).
  **Corrected 2026-10-04 (§66): the earlier "not yet applied — Neon quota blocker" note here was
  wrong.** 054 *was* applied (Actions run `37170858966`, 2026-10-04T02:22:59Z) and the table is
  fully present — on the **wrong database**. See §66.
- `payments.checkout_group_id` is a third payment parent.
  `payments_exactly_one_parent_check` → `payments_at_least_one_parent_check` +
  `payments_single_domain_check`; `idx_payments_one_active_stripe_group` enforces one active
  session per purchase. Both canonical SQL files updated identically.
- **`POST /api/stripe/checkout` accepts `checkoutGroupId` OR `orderId`.** The group path reads the
  group through the OWNER scope, re-derives the amount from the member ORDER rows, and requires every
  member to still be payable. **The previous bug** — reconciling against ONE order's `total_amount`,
  so a 3-shop cart charged only shop A — is fixed.
- Settlement: `settleCheckoutGroup()` locks every member row FIRST
  (`lockCheckoutGroupOrderRows`, one statement, `id ASC`), writes the group payment row, then claims
  each order with the same guarded UPDATE + `commitOrderInventory` a single-order payment uses. One
  charge, N orders, one transaction. The webhook routes via `checkoutGroupIdForAttempt()`, OUTSIDE
  any transaction, so the lock-order invariant (`backend/tests/payment-cancellation-race.test.ts`)
  still holds — `settleCheckoutGroup` is now a case in that suite.
- `markPaymentSucceeded` was restored to its original single-order shape; the dispatcher is at the
  webhook call sites. This is why `late-payment-incidents.test.ts` and
  `payment-attempt-identity.test.ts` pass **unmodified**.

### 54.3 VelRepeat V2 customer UI (`/velrepeat/v2`)

New read endpoints (`backend/routes/velrepeat-v2-status.ts`): `GET /api/velrepeat/v2/packages`,
`GET /api/velrepeat/v2/plans`, `GET /api/velrepeat/v2/plans/:planId` (owner-scoped; pricing from the
FROZEN snapshot; cycles from `readPlanCycles`; per-cycle orders with shop, shipping status and
tracking). Stripe success/cancel now return to `/velrepeat/v2?velrepeat_v2_payment=…&plan=<id>`.

`apps/velshop/src/pages/VelRepeatV2Page.tsx`: package → commitment → frequency → review → draft plan →
Stripe TEST Checkout → return → server-decided status → cycles → per-shop orders (each openable, each
with its own tracking). It **never** computes an authoritative price (renders the server's frozen
figures), **never** treats the Stripe redirect as proof of payment (polls the server while it says
`draft`), and sends only `packageId` / `commitmentCycles` / `frequencyType` / `intervalValue`.
Commitment options and frequencies mirror the backend's own vocabulary.

### 54.4 Order history grouped by purchase

`checkoutGroupId` is exposed on the customer, seller and center order lists. VelShop groups the
history by it so one purchase reads as one thing with N per-shop orders underneath. VelCenter can see
the whole purchase tree; seller ownership is unchanged (`WHERE sh.seller_id = $1` still scopes it).
Tracking stays per ORDER / per SHIPMENT — never per group.

### 54.5 Tests

`backend/tests/multi-shop-checkout.test.ts` (17) covers split cases 1–4, group totals, ownership in
both directions, cross-customer refusal, one-charge/no-duplicate settlement via the real signed
webhook, stock committed once, group invisibility, and concurrent number generation.
Suite: **1908 pass / 2 skip / 0 fail** (baseline 1882/2/0).

## §66. Production `checkout_groups` 42P01 — ROOT CAUSE: migrations reach the WRONG database (2026-10-04)

**Symptom.** Real production checkout fails:
`[checkout] error: relation "checkout_groups" does not exist` / `PostgreSQL code: 42P01` /
`backend/routes/cart.ts:919`. (The route is `POST /api/customer/checkout`; the log names the
failing statement, not the path.) Line 919 of `cart.ts` at HEAD is exactly the
`INSERT INTO checkout_groups` — so Render **is** running current code.

**The migration was never missing.** Read-only probes against the Actions `NEON_DATABASE_URL`
(run `37173839460`) prove the whole 054 substrate is present there:

```
checkout_groups            | present
checkout_groups.columns    | created_at:…! currency:text! id:uuid! item_count:integer!
                            shop_count:integer! total_amount:numeric! user_id:uuid!
checkout_groups.pk         | id
checkout_groups.fk_to_users| FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
checkout_groups.indexes    | checkout_groups_pkey, idx_checkout_groups_user
orders.checkout_group_fk   | FOREIGN KEY (checkout_group_id) REFERENCES checkout_groups(id) ON DELETE SET NULL
payments.checkout_group_fk | FOREIGN KEY (checkout_group_id) REFERENCES checkout_groups(id) ON DELETE SET NULL
payments.order_id nullable | YES
payments.parent CHECKs     | payments_at_least_one_parent_check, payments_single_domain_check
schema_migrations.count    | 57   (ends … > 053 > 054_checkout_groups_numeric_order_number)
```

**Root cause — proven by data, not inferred.** That database is **not** the one Render connects
to. Identity probes (run `37174025731`) vs. the live host:

| | Actions `NEON_DATABASE_URL` | production `velnox-api.onrender.com` |
|---|---|---|
| `current_database` | `neondb` | not exposed |
| shops | **1** — `5d56f6f8…/eloop` | **2** — `26d65318…/home-tech`, `91f4b9bf…/velnox-support` |
| users/products/sellers | 3 / 1 / 1 | — |
| orders/payments | 0 / 0 | real purchases |

Disjoint sets. So **`054` was applied successfully to a database that checkout never touches**,
and every prior conclusion drawn from the Actions ledger about "production schema" is suspect.
This finally identifies the §22/§31 anomaly recorded in `payment.md`: it was never a quota
error, it was the wrong target.

**Fix — owner action, cannot be done from the agent workspace.** Re-point the Actions secret
`NEON_DATABASE_URL` at the Neon project/branch Render's `DATABASE_URL` uses (Settings → Secrets
and variables → Actions), then dispatch `migrate-neon.yml` once; its `schema_migrations` ledger is
per-database, so it will apply the genuinely-pending migrations (054 and any earlier ones) to
production. The repo token gets `403` on both `secrets` and `workflow_dispatch`, and the
production URL exists only in Render. **Do not** hand-apply `054` through any other route, and do
not delete `checkout_groups` usage to silence the error — the table is correct, its target is not.

**Not verified: the live smoke test.** `POST /api/customer/checkout` returns `401` without a
`velnox_session` cookie, and no authorized test account is available here, so checkout has NOT
been observed progressing past the `checkout_groups` query in production. Verdict for this item is
**BLOCKED**, not PASS. After re-pointing the secret, verify by logging in and checking out for
real: no 42P01, one `checkout_groups` row, N orders by shop, one Stripe TEST payment, one
settlement, stock committed once per order. The full local proof is
`backend/tests/multi-shop-checkout.test.ts` (17) + `payment-cancellation-race.test.ts` +
`payment-attempt-identity.test.ts` — 1908 pass / 2 skip / 0 fail.

**Rule this leaves behind:** a green migration run is not evidence about production until the
probes show *which* database it ran against. `diag-neon-schema.yml` now answers that directly
(`rowcount.shops`, `shops.ids (first 5)`, `current_database`); compare against the live host
before concluding anything.

---

## `db/run-sqleditor.sql` is now a rerunnable additive reconciler (2026-10-04)

The Neon SQL Editor file was a copy of `db/schema.sql`, so it could only ever describe an
EMPTY database. Production already has tables and rows, so "run it again" was never safe and
"run it once on production" could not bring production up to the current schema.

It is now generated from `db/schema.sql` (the only source of truth) in seven ordered passes:

| Pass | What it does |
|---|---|
| 1 | `CREATE TABLE IF NOT EXISTS` — the snapshot |
| 2 | `ALTER TABLE … ADD COLUMN IF NOT EXISTS` for all 652 columns, then `SET NOT NULL` only where no row is NULL |
| 2c | `DROP NOT NULL` where the schema no longer requires it (this is what makes `payments.order_id` work on an old database) |
| 3 | indexes — **after** the column pass |
| 4 | foreign keys, guarded on `pg_constraint` |
| 5 / 5c | unique + check constraints; checks `schema.sql` deliberately re-declares, re-applied only when the stored definition differs |
| 6 | the trigger, guarded on `pg_trigger` |
| 7 | read-only verification `SELECT`s |

Never `DROP TABLE`, `DROP COLUMN`, `TRUNCATE` or `DELETE`; never an `EXCEPTION` handler, so
an unfixable problem stops the run instead of reporting a false success.

**Three latent defects fixed on the way, all of which had bitten or would have bitten production:**

1. `orders_checkout_group_id_fkey` was declared in `db/schema.sql` **before**
   `CREATE TABLE checkout_groups`, so a fresh database aborted with `42P01`. `db/schema.sql`
   itself now bootstraps cleanly — it previously did not.
2. Indexes were created in the table section. On a database that has `orders` but not yet
   `orders.checkout_group_id`, `CREATE INDEX … idx_orders_checkout_group` aborted the entire
   run. Indexes now follow the column pass.
3. Six CHECK constraints (`orders_status_check`, `sellers_status_check`, the two velrepeat
   status checks, the two pricing-snapshot checks) were `DROP`+`ADD` re-declarations in
   `schema.sql` because their definition changed over history. A name-only guard silently
   keeps the OLD definition on an older database and rejects a value the canonical schema
   allows. They are now compared against the canonical definition and re-applied only when
   they differ.

`payments_exactly_one_parent_check` is retired by the one `DROP CONSTRAINT` the file carries
(migration 054 superseded it; left in place it rejects every multi-shop payment). It removes a
rule, not data, and is commented in place.

**Verified** (local PostgreSQL 14, three disposable databases): fresh DB ×3 runs, all exit 0
with `tables|indexes|constraints|columns|triggers = 66|243|255|652|1` and the trigger present
exactly once; a pre-054 database with seeded `users/shops/products/orders/payments` upgraded
in place with every row byte-identical and `checkout_groups`, both `checkout_group_id`
columns, four group indexes and two group FKs created; and a database built from
`db/schema.sql` compared against one built from `db/run-sqleditor.sql` — **1267 objects,
identical**. `pnpm test` 1909 pass / 2 skip / 0 fail; typecheck 4/4; `build:apps` 4/4.

**The two canonical files are no longer byte-identical, on purpose.** The contract between
them is declaration parity, asserted by `backend/tests/helpers/canonical-schema.ts`, and the
11 tests that pinned byte-identity now pin that instead. `db/run-update.sql` remains absent.
