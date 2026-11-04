# Velnox AI Handoff — current state

**Last updated:** 2026-11-02 · **Branch:** `main` · **Latest pass:** **§158 — Product upload guards + lifecycle verification** · previous: **§157 — Velseller product management E2E** · previous: **§156 — Velseller product editor image lifecycle** · previous: **§155 — Velseller localised nav + 44px actions** · previous: **§154 — Velseller audit + primary-action colour** · previous: **§153 — Payment/DB/responsive verification attempt** · previous: **§152 — Deployment recovery + real R2 image verification** · previous: **§151 — Full ecosystem regression audit** · previous: **§150 — Authenticated UI check: drawer root cause fixed** · previous: **§149 — Local authenticated UI harness** · previous: **§148 — VelCenter mobile nav under the header fixed** · previous: **§147 — VelCenter-managed announcement banner** · previous: **§146 — Announcement carousel + dropdown positioning** · previous: **§145 — Production visual audit + filter polish** · previous: **§144 — Home banner + density polish** · previous: **§143 — Home vs Marketplace IA** · previous: **§142 — VelShop header brand bar** · previous: **§141 — VelShop bottom nav (4 tabs)** · previous: **§140 — ThaiMart reference analysis** · previous: **§139 — Session summary report** · previous: **§138 — local-browser-testing skill** · previous: **§137 — Harness injection diagnosis** · previous: **§136 — /profile local validation (render blocked)** · previous: **§135 — Local UI testing workflow** · previous: **§134 — Local UI harness assessment** · previous: **§133 — Impeccable integration test** · previous: **§132 — Superpowers installed** · previous: **§131 — Profile external legal rows** · previous: **§130 — VelShop order tiles** · previous: **§129 — Impeccable skill installed** · previous: **§128 — Profile cookie row** · previous: **§127 — VelShop profile spec** · previous: **§126 — Status check (all green)** · previous: **§125 — VelShop footer removed** · previous: **§124 — VelCenter drawer fixed** · previous: **§123 — Drawer root cause (reverted fix)** · previous: **§122 — Local auth harness + measurement** · previous: **§121 — Dropdown repro BLOCKED** · previous: **§120 — VelCenter dropdown diagnostic** · previous: **§119 — VelCenter shell copy i18n** · previous: **§118 — VelCenter shell (drawer + collapse)** · previous: **§117 — VelCenter sidebar layout** · previous: **§116 — VelCenter language switcher** · previous: **§115 — LanguageProvider in VelCenter + VelSeller** · previous: **§114 — VelCenter/VelSeller UI audit** · previous: **§113 — Payment E2E with safe skips** · previous: **§112 — Refund/replay tests green** · previous: **§111 — Refund/replay harness BLOCKED** · previous: **§110 — Production marketplace audit** · previous: **§109 — Vercel deployment diagnosis** · previous: **§108 — Abandoned payment retirement** · previous: **§107 — Payment UX typed errors + resume** · previous: **§105 — Stripe PromptPay E2E PASS** · previous: **§104 — Payment rail switching recovery** · previous: **§103 — Stripe sandbox E2E (PARTIAL)** · previous: **§102 — VelCenter Support Inbox** · previous: **§101 — CI green + authoritative unread and company read model** · previous: **§100 — Chat parity: VelCenter images, bell-free chat, real unread** · previous: **§99 — Chat inbox + thread redesign with real presence** · previous: **§98 — Chat images in all three apps (VelCenter renders only)** · previous: **§97 — Chat image UI (VelShop only)** · previous: **§96 — Chat images (backend only)** · previous: **§95 — Development memory is now a rule** (§19 history mandate + template; docs only) · previous: **§94 — Commerce Messenger** (durable DB idempotency for every send; shared day separators + sender grouping in all three apps) · previous: **§93 — Checkout → Order → Payment verification** (335 pass / 168 skip / 0 fail locally, 21 files; production Stripe config probed read-only; **PARTIAL** — real Stripe E2E blocked on missing test keys) · previous: **§92 — Chat ownership + real-time proof** (one shared ownership rule for all three apps; system messages always LEFT; real-time path traced and covered by DB+WebSocket tests) · previous: **§91 — Production schema reconciled** (5 §89 chat objects applied to production; `production-db-verify` 10/10; PG18 probe cast fixed in `055c0ee`) · previous: **§89 — Messenger UX** (left/right already existed; ✓/✓✓, realtime read bound, daily Velnox Support acknowledgment, typing indicator). **Main is green again:** the 11 `oauth-route` failures present since §87 were fixed in §90 — the auth module read its Google config at import time, so any module that imported `invalidateCachedProfile` first froze an empty client id. **Production DB Verify remains BLOCKED** (missing `NEON_PRODUCTION_DATABASE_URL`); **browser/E2E NOT RUN**. i18n 1264/1264/1264.
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
| velShop | `apps/velshop` | customer storefront, cart, checkout |
| velSeller | `apps/velseller` | seller workspace (products, orders, income, goals) |
| velCenter | `apps/velcenter` | staff / company operations console |
| velNox | `apps/velnox` | corporate site |
| API | `backend` | Express + `ws`; the only thing that talks to Neon |
| Shared | `packages/shared` | UI kit, i18n, api client, `api-routes.ts` |
| DB | `db/schema.sql`, `db/run-sqleditor.sql` | canonical snapshot + additive reconciler (declaration parity); the ONLY two `.sql` files in the repo |

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

**READ-ONLY.** No source, schema, migration, workflow or data change; nothing was
connected to from this workspace (no database credentials are readable here, by
platform design). Method, migration ledger and verified-object table archived →
[`history/archive/AI_Handoff-2026-09-23-neon-readonly-verification.md`](history/archive/AI_Handoff-2026-09-23-neon-readonly-verification.md).

**⚠️ Its headline conclusion was wrong and is superseded by §66.** This pass reported the
ledger matching `db/migrations/*.sql` **exactly** (49 rows / 49 files, none missing or
orphaned) and was taken to be the production ledger. It was not: the secret it read
(`NEON_DATABASE_URL`) pointed at a *different* Neon than Render uses. "49/49, nothing
missing" was a true statement about the wrong database — which is exactly why the ledger
is no longer treated as evidence about production. Never draw a production conclusion
from a ledger read without proving the identity first.

### 9.4 Still NOT VERIFIED (needs a fresh catalog read, now against the right database)

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

Run `.github/workflows/production-db-verify.yml` from **Actions → Production DB Verify
→ Run workflow**; it prints the database identity and a row-count fingerprint first,
so a run against the wrong Neon is visible in the log rather than inferred later. Items
1–4 above still need `diag-neon-schema.yml`, whose probes cover them. Neither workflow
can be dispatched from a workspace (`403 Resource not accessible by integration`);
granting the GitHub App **Actions: read/write** would allow it.

### 9.6 Safety notes from this pass

Never run `bun test backend/tests` where `DATABASE_URL` could point at production:
the DB-gated fixtures **delete** rows (`backend/tests/helpers/purge.ts`). No
credential, URL, password, token or hash was printed — the workflows reference the
secret only as `psql "$NEON_PRODUCTION_DATABASE_URL"` and never echo it.

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

## 15–20. Payment foundation, Stripe E2E records, CI guard, readiness audit, moderation queue — ARCHIVED

**Moved verbatim on 2026-10-06** to
[`history/archive/AI_Handoff-2026-09-25-to-2026-09-26-payment-and-e2e-records.md`](history/archive/AI_Handoff-2026-09-25-to-2026-09-26-payment-and-e2e-records.md)
(handoff edit-ceiling housekeeping; made room for §70). **Still-live claims, unchanged:**

- **Stripe TEST E2E stays BLOCKED** — no `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`
  (`freebuff-env list` → `{"files":{}}`); no PaymentIntent, PromptPay QR, webhook delivery or
  refund has ever been executed. Production payment readiness **NOT claimed**.
- **PRODUCTION: NOT READY**; §19's per-gate evidence is in
  [`.ai/tasks/completed/production-readiness-audit-2026-09-26.md`](tasks/completed/production-readiness-audit-2026-09-26.md).
- The moderation queue is bounded/paginated and `SellerVerificationQueue.tsx` renders through
  `review.*` (th/en/my). Live rules: [`.ai/context/payment.md`](context/payment.md),
  [`.ai/context/testing.md`](context/testing.md), and the code.

---


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

## 37–48 + 51–64. Archived (verbatim)

§37–§48 → [`history/archive/AI_Handoff-2026-09-30-payments-and-audit-record.md`](history/archive/AI_Handoff-2026-09-30-payments-and-audit-record.md)
· §51 → `.ai/history/archive/AI_Handoff-2026-09-30-velrepeat-prepaid-contract-stopped.md` · §52–§63 →
[`history/archive/AI_Handoff-2026-10-04-sections-52-63.md`](history/archive/AI_Handoff-2026-10-04-sections-52-63.md) · §64 →
[`history/archive/AI_Handoff-2026-10-04-section-64-velrepeat-053.md`](history/archive/AI_Handoff-2026-10-04-section-64-velrepeat-053.md)
(index: [`history/AI_Handoff_Archive.md`](history/AI_Handoff_Archive.md)).

**Still live from them:** the reservation is a **CONSTANT 30 minutes** · **migrations 048/049/050 were never applied in
production** (Neon quota, §14/§16/§21–22) · real Stripe TEST E2E and browser E2E have **never** run · MEDIUM #10/#11,
LOW #13/#14 and HIGH #4/#5 audit findings remain open.

**Superseded, do not read as current:** §51's three blockers were closed by §52–§58, Phase 3, Phase 4 and §62, and its
"048/049/050 still unapplied" line is **stale**. §52–§64's "production applied + verified" claims are **RETRACTED** —
they rested on the Actions ledger, and §66 proves that ledger describes a different database from the one Render serves.
Current state: §65–§69.

---

## §65. Multi-shop checkout, numeric order numbers, VelRepeat V2 customer UI (2026-10-04) — **ARCHIVED**

**Moved verbatim on 2026-10-07** (edit-headroom housekeeping; made room for §72) →
[`history/archive/AI_Handoff-2026-10-04-sections-65-66-multi-shop-and-migration-routing.md`](history/archive/AI_Handoff-2026-10-04-sections-65-66-multi-shop-and-migration-routing.md).
**Still live from it:** public order numbers are 18 digits, digits only, and a string everywhere
(`generateOrderNumber()`) · one purchase = one `checkout_groups` row + N per-shop orders
(`orders.checkout_group_id`), one charge settled as ONE transaction with every member row locked
first · VelShop groups order history by the purchase, and the seller scope is unchanged.

## §66. Production `checkout_groups` 42P01 — ROOT CAUSE: migrations reach the WRONG database (2026-10-04) — **ARCHIVED**

**Moved verbatim on 2026-10-07** (same housekeeping) →
[`history/archive/AI_Handoff-2026-10-04-sections-65-66-multi-shop-and-migration-routing.md`](history/archive/AI_Handoff-2026-10-04-sections-65-66-multi-shop-and-migration-routing.md).
**Still live from it — the durable finding:** migrations were applied to the database named
by the Actions secret `NEON_DATABASE_URL`, which is **NOT** the database Render's `DATABASE_URL`
points at (disjoint shops/users/products), so every "production schema verified" claim resting on
that ledger is suspect. The owner action is to set `NEON_PRODUCTION_DATABASE_URL` and dispatch
`production-db-migrate.yml`; **do not** hand-apply 054 elsewhere and do not remove
`checkout_groups` usage. Verdict stays **BLOCKED**, never PASS, until a real logged-in checkout is
observed there. The general rule this produced is in [`context/database.md`](context/database.md):
the `42703` error text can never prove which database, or which build, you are on.

---

## `42703 checkout_group_id` — the retracted "stale build" verdict (2026-10-04) — **ARCHIVED**

**Archived 2026-10-05** → [`history/archive/AI_Handoff-2026-10-04-42703-correction.md`](history/archive/AI_Handoff-2026-10-04-42703-correction.md).
The durable rule is in [`context/database.md`](context/database.md) and applies to §66/§67/§68:
`ERROR: column "x" does not exist` is emitted both when no relation in scope owns `x` AND when the
relation in scope simply lacks `x` — byte-identically. **The error text can never prove a query is
unqualified or that a build is stale.** Ask the catalog, or ask which database you are on.

## Boot-time database identity + PART 8 shape assertions + the reproduced incident (2026-10-04) — **ARCHIVED**

**Archived** (all COMPLETE; the contracts live in [`.ai/context/database.md`](context/database.md)
— the boot-time `describeDatabaseIdentity()` probe, PART 7/8's type/index/FK-shape assertions,
and `db/verify-reconciler.sh` scenarios H and I) →
[`history/archive/AI_Handoff-2026-10-04-db-identity-and-part8.md`](history/archive/AI_Handoff-2026-10-04-db-identity-and-part8.md).
Moved 2026-10-04 to keep the current-state file small while adding the payment-integrity
section. The owner action it recorded (run `db/run-sqleditor.sql` against Render's actual
database) is restated there and in §6.

## Canonical production DB + GitHub Actions alignment (2026-10-04) — ARCHIVED

**Moved verbatim on 2026-10-06** (edit-ceiling housekeeping; made room for §70) →
[`history/archive/AI_Handoff-2026-10-04-canonical-production-db-and-actions.md`](history/archive/AI_Handoff-2026-10-04-canonical-production-db-and-actions.md).
**Still live from it:** `NEON_PRODUCTION_DATABASE_URL` is the ONE secret name GitHub Actions uses
to reach production; `production-db-verify.yml` is read-only and checks 11 objects (both group
columns **with their type**, both `ON DELETE SET NULL` group FKs, the group indexes, the payment
parent CHECKs, the ledger), `production-db-migrate.yml` is the only writer and prints the database
identity **before** applying; `test.yml` references no secret. **Verification never repairs, and a
missing secret is BLOCKED, never substituted.** Two durable CI lessons are in the archive: a
DB-backed assertion inside a *static* `describe` must be gated on `hasTestDatabase()`, and
`db/verify-reconciler.sh` must derive its connection from `TEST_DATABASE_URL`.

---

## Payment integrity — a captured Stripe charge could never settle in production (2026-10-04) — **ARCHIVED**

**Moved verbatim on 2026-10-27** (edit-headroom housekeeping; appended §83, nothing discarded) →
[`history/archive/AI_Handoff-2026-10-04-payment-integrity.md`](history/archive/AI_Handoff-2026-10-04-payment-integrity.md)
(index row: [`history/AI_Handoff_Archive.md`](history/AI_Handoff_Archive.md)).
**Still live from it:** the failure class (production schema ≠ backend code, `handleStripeEvent()`
throwing 42703 on the settlement query); the fix reads the column as a JSON KEY
(`to_jsonb(p) ->> 'checkout_group_id'`) so ONE statement is correct on both schemas, pinned by
`payment-webhook-schema-lag.test.ts`; **production `payments.checkout_group_id` is still BLOCKED and
owner-executed** (run `db/run-sqleditor.sql` against Render's database, then `Production DB
Verify` with `NEON_PRODUCTION_DATABASE_URL`); and **Real Stripe TEST E2E is still BLOCKED** —
payment is a hosted Checkout Session, so it needs a human in a browser.

---

## §68. Multi-shop PromptPay — "Failed to create checkout session" (2026-10-05) — **ARCHIVED**

**Record moved verbatim** → [`history/archive/AI_Handoff-2026-10-05-section-68-checkout-group-session-open.md`](history/archive/AI_Handoff-2026-10-05-section-68-checkout-group-session-open.md).
**Still live from it (the fix is SHIPPED):** `paymentsCheckoutGroupColumnExists()` — a cached `pg_attribute`
probe with a `__resetPaymentsGroupColumnCache()` seam — answers **503 `CHECKOUT_GROUP_UNAVAILABLE` BEFORE
`sessions.create`**, so no orphan payable URL is ever opened when the column is missing; the async
`logCheckoutSessionFailure()` emits one JSON line (`failure_stage`/`order_id`/`checkout_group_id`/
`payment_attempt_id`/`stripe_session_id`/…) while the client sees only generic text; a failed group INSERT
**expires** the session it just created; and the request key is claimed on the group path too, after ownership
is verified. Owner action restated by **§69**.

---

## §69. Production `payments.checkout_group_id` — the gap is real, applying it is **BLOCKED** (2026-10-05) — ARCHIVED

**Record moved verbatim** (2026-10-26, edit-headroom housekeeping) →
[`history/archive/AI_Handoff-2026-10-05-section-69-production-payments-checkout-group.md`](history/archive/AI_Handoff-2026-10-05-section-69-production-payments-checkout-group.md).

**Still live from it:** production `payments.checkout_group_id` remains **BLOCKED** and owner-executed —
create `NEON_PRODUCTION_DATABASE_URL` for the SAME Neon branch Render's `DATABASE_URL` uses, confirm the boot
`[db]` identity, run `db/run-sqleditor.sql`, then `Production DB Verify` must go BLOCKED → PASS. The
`db/migrations/054_*.sql` path named in the record is historical: there is no `db/migrations/` directory since
§76. No agent may connect to production (`.ai/AI_RULES.md` §17).

---

## §70–§72 + §74. Commerce rebuild · order-state projection · shipment lifecycle — **ARCHIVED** (moved 2026-10-23)

The completed-pass records for 2026-10-06 → 2026-10-08 — §70 (payment + checkout + order +
inventory + webhook rebuilt as ONE system), §71 (e-commerce rebuild phases 0-4), §72
(`orders.status` as a derived projection) and §74 (Phase 3 shipment lifecycle) — moved
**verbatim** to
[`history/archive/AI_Handoff-2026-10-06-to-2026-10-08-commerce-rebuild-passes.md`](history/archive/AI_Handoff-2026-10-06-to-2026-10-08-commerce-rebuild-passes.md)
(index row added) so this file stays under the ~55 KB edit ceiling. Their results still stand
(full suite 2103 pass / 2 skip / 0 fail at the time · `db/verify-reconciler.sh` ALL SCENARIOS
PASSED · all typechecks and builds green). What is still open lives in §6.

---

## §75. MVP repositioned: buy & sell — VelRepeat + Customer Memory PARKED (2026-10-14) — ARCHIVED

Superseded in part by §76: **VelRepeat is removed, not parked** (restoring it would be a rebuild).
**Customer Memory parking still stands** (`CUSTOMER_MEMORY_ENABLED` is the only feature flag left),
and the Phase-1 caption / corporate-site work shipped as recorded. **The wholesale buyer track was
never built** — pack pricing, shop accounts, MOQ and restock lists do not exist; a shop orders the
same retail lines as anyone else. Verbatim text:
[`.ai/history/archive/AI_Handoff-2026-10-14-section-75-mvp-reposition.md`](./history/archive/AI_Handoff-2026-10-14-section-75-mvp-reposition.md);
brief and Phase-2 model: [`.ai/tasks/active/mvp-marketplace-restructure-2026-10-14.md`](tasks/active/mvp-marketplace-restructure-2026-10-14.md).

---

---## §76. VelRepeat REMOVED + repository cleanup + SQL consolidation (2026-10-23) — ARCHIVED

VelRepeat is gone at every layer: 6 backend route modules + both schedulers +
`lib/velrepeat-{cycles,pricing}.ts`; the velShop pages/dialogs and every nav/menu/help/checkout entry;
`VELREPEAT_ENABLED` switches; i18n keys, `api-routes.ts` entries, tests, contracts and briefs; and
from the schema **12 tables · 12 columns · 62 indexes · 78 constraints**. Shared payment, order,
shipment, inventory, refund and billing logic and ALL Stripe infrastructure were preserved.

Exactly **two `.sql` files** remain — `db/schema.sql` (fresh snapshot) + `db/run-sqleditor.sql`
(rerunnable reconciler) + `db/verify-reconciler.sh`; `db/migrations/` and `db:migrate` are gone, and
`backend/tests/sql-reference-coverage.test.ts` pins backend SQL ↔ schema coverage. Legacy objects in
an existing database are removed only by the owner via `docs/VELREPEAT_REMOVAL_PLAN.md` (the
reconciler carries no VelRepeat statement). Audit §77 verdict: CLEAN WITH MINOR FINDINGS; production
state still NOT RUN / BLOCKED (§78).

Base `af9841b` → cleanup commit `cc3e9ea`. Full text moved verbatim to
[`history/archive/AI_Handoff-2026-10-27-sections-76-79.md`](history/archive/AI_Handoff-2026-10-27-sections-76-79.md)
on 2026-10-27 (edit-headroom housekeeping; nothing discarded).

## §77. Independent audit of the VelRepeat removal + repository cleanup (2026-10-24) — ARCHIVED

Audited `bfa416e` read-only. Verdict **CLEAN WITH MINOR FINDINGS**: 0 VelRepeat hits in
`apps/`, `backend/`, `packages/`; 2 `.sql` files only; the boot self-heal removal in
`backend/server.ts` documented for the first time. Full text moved verbatim to
[`.ai/history/archive/AI_Handoff-2026-10-24-section-77-audit.md`](./history/archive/AI_Handoff-2026-10-24-section-77-audit.md)
on 2026-10-25; report: [`.ai/audit/FINAL_AUDIT_2026-10-24_VELREPEAT_REMOVAL.md`](./audit/FINAL_AUDIT_2026-10-24_VELREPEAT_REMOVAL.md).

## §78. Production Neon READ-ONLY audit + permanent change-audit-trail rules (2026-10-25) — ARCHIVED

**Repo-side: PASS** — 0 VelRepeat in executable code, 2 `.sql` files, both declaring 63 tables,
checklist 19/19 (`users` stands in for customers; there is no `customers` table),
`sql-reference-coverage` 5/5. **Production Neon: NOT RUN / BLOCKED** by rule §17 — an agent must not
connect on the owner's behalf; the real state stays UNKNOWN until the owner runs the report's
read-only queries (never report PASS). WARNING: `production-db-verify.yml` probes only the
checkout-group invariants, not the 19 Marketplace tables. Permanent rules: `.ai/AI_RULES.md` §17
(read-only production) and §18 (Change Report + never claim an unrun check).
Report: [`2026-10-25-production-neon-audit.md`](./history/2026-10-25-production-neon-audit.md).
Full section text moved verbatim to
[`history/archive/AI_Handoff-2026-10-25-section-78-production-neon-audit.md`](./history/archive/AI_Handoff-2026-10-25-section-78-production-neon-audit.md)
on 2026-10-30 (edit-headroom housekeeping while appending §85; nothing discarded).

## §79. Phase 1 — UI/UX + Realtime Professional Audit (2026-10-26) — ARCHIVED (audit only)

Verdict: the systems exist and the payment/order core is sound, but production-grade interaction
quality is not reached — 1 P0 (VelSeller mobile had no chat entry), 18 P1, 14 P2, 4 P3. The P1s that
moved into work: VelCenter's socket missed `/ws`; chat unmounts killed the shared socket; errors
rendered as empty states (or an infinite spinner) instead of failing loudly; order history was capped
at 50/50/100 with no pagination; **Buy Now ignored `buyNowQty` and charged the cart quantity**;
support is a shop account, not a staffed desk. Responsive was **static analysis only** — the visual
matrix is NOT RUN, not passed.

Findings drove Phase 2A (§80, stability + realtime) and Phase 2B (§81, broken UX + commerce
accuracy). Still Phase 2C–2D: realtime commerce events, transactional notification rows, private
admin channels, chat/support fundamentals. Full report:
[`.ai/history/2026-10-26-ui-realtime-professional-audit.md`](history/2026-10-26-ui-realtime-professional-audit.md).
Full section text moved verbatim to
[`history/archive/AI_Handoff-2026-10-27-sections-76-79.md`](history/archive/AI_Handoff-2026-10-27-sections-76-79.md)
on 2026-10-27 (edit-headroom housekeeping; nothing discarded).

**Housekeeping:** §69 moved **verbatim** to
[`history/archive/AI_Handoff-2026-10-05-section-69-production-payments-checkout-group.md`](history/archive/AI_Handoff-2026-10-05-section-69-production-payments-checkout-group.md)
with an index row.

## §80. Phase 2A — Stability + Realtime Foundation (2026-10-27) — ARCHIVED

Base `4908d7d3…`, commit `af30288…`. ONE realtime client owned by `RealtimeProvider`;
VelCenter's broken inline socket removed; chat pages no longer tear the socket down; backend
presence + 30 s heartbeat; seller chat entry below `lg`; notification panels; error ≠ empty states.
Suite: 987 pass / 303 skip / 0 fail. Its "still open (Phase 2C)" list is delivered by §82.
Report: [`.ai/history/2026-10-27-ui-realtime-phase-2a.md`](history/2026-10-27-ui-realtime-phase-2a.md).
Full section text moved verbatim to
[`history/archive/AI_Handoff-2026-10-27-sections-80-81.md`](history/archive/AI_Handoff-2026-10-27-sections-80-81.md)
on 2026-10-27 (edit-headroom housekeeping while appending §82; nothing discarded).

## §81. Phase 2B — Broken UX + Commerce Correctness (2026-10-27) — ARCHIVED

Base `ded71177…`, commit `eca58eb` (18 files, +1288/−116). Buy Now charges the selected quantity
without touching the cart; order-history pagination on all three surfaces; bootstrap-claim `res.ok`;
VelCenter destructive-action guards; footer/marketing links. Suite: 992 pass / 313 skip / 0 fail.
Report: [`.ai/history/2026-10-27-ui-commerce-phase-2b.md`](history/2026-10-27-ui-commerce-phase-2b.md).
Full section text in the same archive file as §80.

## §82. Phase 2C — Realtime Commerce Correctness (2026-10-27) — ARCHIVED

Base `f78322f9…`, code commit `38662de6…` (16 files, +1551/−119). The five workstreams
(`order:created` published only after COMMIT; addressed `order:updated`/`shipment:updated`;
shipment events only for a real change; order-lifecycle notification ROWS; server-authorized
private admin channels). New `backend/tests/realtime-commerce-phase2c.test.ts` (23 contract
assertions + 8 DB-gated cases). Suite then: 1015 pass / 321 skip / 0 fail. Report:
[`.ai/history/2026-10-27-realtime-commerce-phase-2c.md`](history/2026-10-27-realtime-commerce-phase-2c.md).
Its "still open" list carried into §83/§84 (outbox drain worker, 30 s role staleness).
Full section text moved verbatim to
[`history/archive/AI_Handoff-2026-10-27-section-82-phase-2c.md`](history/archive/AI_Handoff-2026-10-27-section-82-phase-2c.md)
on 2026-10-28 (edit-headroom housekeeping while appending §84; nothing discarded).

---

## §83. Phase 2D — Chat/Support Fundamentals + Unread Badge (2026-10-27) — ARCHIVED

Base `1a4cce0543795acf51e37a663a9306554938b03d`, code commit
`4aed0847a8b58b3bd8c6c500b08cee49c3a917ae` (8 files, +1179/−28). Bounded `upTo` read (only messages
at/before the server-derived epoch-ms bound are marked read; unusable → 400); in-process `clientId`
send idempotency with draft restore (the durable unique-index fix still needs owner approval); ONE
server-derived chat-unread badge (`use-chat-unread.ts`) on both seller header entries and the
customer profile `/chat` row (`null` renders nothing, an error keeps last-known-good, reconnect
refreshes); addressed `chat:message`/`chat:read`. Suite then: `1033 pass / 332 skip / 0 fail`
(1365 tests, 66 files). Report:
[`2026-10-27-chat-support-phase-2d.md`](./history/2026-10-27-chat-support-phase-2d.md).
Full section text moved verbatim to
[`history/archive/AI_Handoff-2026-10-27-section-83-phase-2d.md`](./history/archive/AI_Handoff-2026-10-27-section-83-phase-2d.md)
on 2026-10-30 (edit-headroom housekeeping while appending §85; nothing discarded).

---

## §84. Phase 2E — CI/E2E Verification + Responsive/Visual Audit (2026-10-28) — ARCHIVED

Base `d7c7eefa…` → commits `ca66c4cb…`, `b2c6ef79…`, `06806685…`. The Phase 2D suite had never run
(it skips without `TEST_DATABASE_URL`); CI proved 4 real failures and one SHIPPED defect — the `upTo`
read bound compared a millisecond value against a microsecond `created_at`, excluding the message the
bound was derived from. Fixed with a documented `READ_BOUND_SQL` (`… + interval '1 millisecond'`) in
both read routes. Final Phase 2D run `40601957381`: 1342 pass / 11 fail / 2 skip; the 11 are the
pre-existing payment-rail failures, not 2D. **BROWSER/E2E: NOT RUN** (source-based responsive audit
only). Full section text moved verbatim to
[`history/archive/AI_Handoff-2026-10-28-section-84-phase-2e.md`](./history/archive/AI_Handoff-2026-10-28-section-84-phase-2e.md)
on 2026-10-30 (edit-headroom housekeeping while appending §87; nothing discarded).

---

## §85. Phase 2F — CI Checkout/Payment Test Reliability (2026-10-30) — ARCHIVED

Base `31456976…` → code commit `fe7927b6…` (3 test files). The 11 red CI checkout tests were
root-caused to a half-configured TEST payment rail in `buy-now-checkout` /
`realtime-commerce-phase2c` (a `sk_test_…` key with `STRIPE_WEBHOOK_SECRET` deleted → 503
`STRIPE_WEBHOOK_NOT_CONFIGURED` before any stock/idempotency code), fixed test-side with no
assertion weakened. New `checkout-test-payment-rail` guard (10 cases). CI run `40986922370`:
1363 pass / 2 skip / 0 fail. Full section text moved verbatim to
[`history/archive/AI_Handoff-2026-10-30-section-85-phase-2f.md`](./history/archive/AI_Handoff-2026-10-30-section-85-phase-2f.md)
on 2026-10-30 (edit-headroom housekeeping while appending §87; nothing discarded).

---

## §86. Phase 2G — Production Readiness Audit (2026-10-30) — **ARCHIVED** (moved 2026-10-31)

Verbatim record:
[`.ai/history/archive/AI_Handoff-2026-10-31-section-86-phase-2g.md`](./history/archive/AI_Handoff-2026-10-31-section-86-phase-2g.md).
Zero source changes (audit only). Its High finding — OAuth `state` treated as user data — was fixed
in §87.

---

## §87. Phase 2H — OAuth State Hardening (2026-10-30) — **ARCHIVED** (moved 2026-10-31)

Verbatim record:
[`.ai/history/archive/AI_Handoff-2026-10-31-section-87-phase-2h.md`](./history/archive/AI_Handoff-2026-10-31-section-87-phase-2h.md).
OAuth `state` is a 256-bit CSPRNG nonce bound to a signed, expiring, single-use httpOnly cookie; the
callback rejects missing/mismatched/forged/expired/replayed state before the code exchange.
**Known regression from this pass:** its route tests set `GOOGLE_CLIENT_ID`/`GOOGLE_REDIRECT_URI` at
module scope and then dynamically import `routes/auth.ts`, but an earlier module evaluation in the same
`bun test` process can snapshot them empty — `main` CI is red (11/1414) because of it. Test isolation
only; production behaviour is unaffected.

## §88. Unified Marketplace Chat (2026-10-30) — **ARCHIVED** (moved 2026-10-31)

Verbatim record:
[`.ai/history/archive/AI_Handoff-2026-10-31-section-88-unified-chat.md`](./history/archive/AI_Handoff-2026-10-31-section-88-unified-chat.md).
One `conversations` / `chat_messages` core serving `CUSTOMER_SELLER`, `CUSTOMER_COMPANY`,
`SELLER_COMPANY` and `COMPANY_INTERNAL`, with VelShop Shops/Velnox Support, VelSeller
Customers/Velnox and VelCenter Customers/Sellers/Internal.

---

## §89. Messenger UX — ticks, daily support ack, typing (2026-10-31) — **ARCHIVED** (moved 2026-10-31)

Verbatim record:
[`.ai/history/archive/AI_Handoff-2026-10-31-section-89-messenger-ux.md`](./history/archive/AI_Handoff-2026-10-31-section-89-messenger-ux.md).
✓/✓✓ from `readAt`, `chat:read` carrying its `upTo` bound, the once-per-Asia/Bangkok-day support
acknowledgment and the ephemeral `chat:typing` frame over the existing socket.

---

## §90. OAuth config read at use time — the 11 red CI cases (2026-10-31) — **ARCHIVED** (moved 2026-10-31)

Verbatim record:
[`.ai/history/archive/AI_Handoff-2026-10-31-section-90-oauth-config.md`](./history/archive/AI_Handoff-2026-10-31-section-90-oauth-config.md).
`routes/auth.ts` read its four Google/JWT values at import time; any module that imported
`invalidateCachedProfile` first froze empty values. They are now accessors read at use time.

---

## §91. Production schema reconciled + the PG18 probe bug (2026-10-31) — **ARCHIVED** (moved 2026-10-31)

Verbatim record:
[`.ai/history/archive/AI_Handoff-2026-10-31-section-91-pg18-probe.md`](./history/archive/AI_Handoff-2026-10-31-section-91-pg18-probe.md).
The five §89 chat objects were applied to production by `production-db-migrate` run `41114242571`; the
read-only probe's `text || "char"` failure on PostgreSQL 18 was fixed in `055c0ee`.

---

## §92. Chat ownership + real-time proof (2026-10-31) — **ARCHIVED** (moved 2026-10-31)

Verbatim record:
[`.ai/history/archive/AI_Handoff-2026-10-31-section-92-chat-ownership.md`](./history/archive/AI_Handoff-2026-10-31-section-92-chat-ownership.md).
One shared ownership rule (`packages/shared/src/lib/chat-message.ts`) for all three apps; system rows always
LEFT; delivery covered by DB+WebSocket tests.

---

## §93. Checkout → Order → Payment verification (2026-10-31) — **ARCHIVED** (moved 2026-11-01)

Verbatim record:
[`.ai/history/archive/AI_Handoff-2026-11-01-section-93-checkout-verification.md`](./history/archive/AI_Handoff-2026-11-01-section-93-checkout-verification.md).
335 pass / 168 skip / 0 fail across 21 payment+checkout files; production Stripe probed read-only; verdict
PARTIAL (real Stripe E2E blocked on missing test keys).

---

## §94. Commerce Messenger: durable idempotency + shared timeline (2026-10-31) — **ARCHIVED** (moved 2026-11-01)

Full text: [`archive/AI_Handoff-2026-11-01-section-94-commerce-messenger.md`](./history/archive/AI_Handoff-2026-11-01-section-94-commerce-messenger.md).

---

## §95. Development memory is a permanent rule (2026-10-31) — **ARCHIVED** (moved 2026-11-02)

Full text: [`archive/AI_Handoff-2026-11-02-section-95-dev-memory-rule.md`](./history/archive/AI_Handoff-2026-11-02-section-95-dev-memory-rule.md).

---

## §96. Chat images — backend only — **ARCHIVED** (moved 2026-11-02)

Full text: [`archive/AI_Handoff-2026-11-02-section-96-chat-images-backend.md`](./history/archive/AI_Handoff-2026-11-02-section-96-chat-images-backend.md).

---

## §97. Chat image UI — VelShop only — **ARCHIVED** (moved 2026-11-02)

Full text: [`archive/AI_Handoff-2026-11-02-section-97-chat-image-ui-velshop.md`](./history/archive/AI_Handoff-2026-11-02-section-97-chat-image-ui-velshop.md).

---

## §98. Chat images in VelSeller + VelCenter — **ARCHIVED** (moved 2026-11-02)

Full text: [`archive/AI_Handoff-2026-11-02-section-98-chat-images-seller-center.md`](./history/archive/AI_Handoff-2026-11-02-section-98-chat-images-seller-center.md).

---

## §99. Chat inbox + thread redesign — **ARCHIVED** (moved 2026-11-02)

Full text: [`archive/AI_Handoff-2026-11-02-section-99-chat-inbox-redesign.md`](./history/archive/AI_Handoff-2026-11-02-section-99-chat-inbox-redesign.md).

---

## §100. Chat parity: VelCenter images, bell-free chat, real unread (2026-11-02) — **ARCHIVED** (moved 2026-11-02)

Full text: [`archive/AI_Handoff-2026-11-02-section-100-chat-parity.md`](./history/archive/AI_Handoff-2026-11-02-section-100-chat-parity.md).

---

## §101. CI green + authoritative unread and company read model (2026-11-02) — **ARCHIVED** (moved 2026-11-02)

Full text: [`archive/AI_Handoff-2026-11-02-section-101-ci-green.md`](./history/archive/AI_Handoff-2026-11-02-section-101-ci-green.md).

---

## §102. VelCenter Support Inbox (2026-11-01) — **ARCHIVED** (moved 2026-11-02)

Full text: [`archive/AI_Handoff-2026-11-02-section-102-support-inbox.md`](./history/archive/AI_Handoff-2026-11-02-section-102-support-inbox.md).

---

## §103. Stripe sandbox commerce E2E (2026-11-01) — **ARCHIVED** (moved 2026-11-02)

Full text: [`archive/AI_Handoff-2026-11-02-section-103-stripe-sandbox-e2e.md`](./history/archive/AI_Handoff-2026-11-02-section-103-stripe-sandbox-e2e.md).

---

## §104. Payment rail switching no longer dead-ends (2026-11-01) — **ARCHIVED** (moved 2026-11-02)

Full text: [`archive/AI_Handoff-2026-11-02-section-104-rail-switching.md`](./history/archive/AI_Handoff-2026-11-02-section-104-rail-switching.md).

---

## §105. Stripe sandbox PromptPay E2E — PASS (2026-11-01) — **ARCHIVED** (moved 2026-11-02)

Full text: [`archive/AI_Handoff-2026-11-02-section-105-promptpay-e2e.md`](./history/archive/AI_Handoff-2026-11-02-section-105-promptpay-e2e.md).

---

## §106. Payment backlog (2026-11-02) — pointer only

[`.ai/tasks/active/payment-roadmap-handoff.md`](./tasks/active/payment-roadmap-handoff.md): env snapshot, verified test numbers, P1–P5 backlog and the rules for the next agent. No secrets.

---

## §107. Payment UX: typed errors + resume (2026-11-02) — **ARCHIVED** (moved 2026-11-02)

Full text: [`archive/AI_Handoff-2026-11-02-section-107-payment-ux.md`](./history/archive/AI_Handoff-2026-11-02-section-107-payment-ux.md).

---

## §108. Abandoned payment attempts retire safely (2026-11-01) — **ARCHIVED** (moved 2026-11-02)

Full text: [`archive/AI_Handoff-2026-11-02-section-108-abandoned-retirement.md`](./history/archive/AI_Handoff-2026-11-02-section-108-abandoned-retirement.md).

---

## §109. Vercel deployments were healthy (2026-11-02) — **ARCHIVED** (moved 2026-11-02)

Full text: [`archive/AI_Handoff-2026-11-02-section-109-vercel-diagnosis.md`](./history/archive/AI_Handoff-2026-11-02-section-109-vercel-diagnosis.md).

---

## §110. Production marketplace audit (2026-11-02) — **ARCHIVED** (moved 2026-11-02)

Full text: [`archive/AI_Handoff-2026-11-02-section-110-marketplace-audit.md`](./history/archive/AI_Handoff-2026-11-02-section-110-marketplace-audit.md).

---

## §111. Refund/replay harness was BLOCKED (2026-11-02) — **ARCHIVED** (moved 2026-11-02) — superseded by §112

Full text: [`archive/AI_Handoff-2026-11-02-section-111-replay-blocked.md`](./history/archive/AI_Handoff-2026-11-02-section-111-replay-blocked.md).

---

## §112. Refund + duplicate-webhook replay are green in CI (2026-11-02)

Full text: [`archive/AI_Handoff-2026-11-02-section-112-refund-replay.md`](./history/archive/AI_Handoff-2026-11-02-section-112-refund-replay.md).

---

## §113. Payment E2E completed with safe skips (2026-11-02) — **ARCHIVED** (moved 2026-11-02)

Full text: [`archive/AI_Handoff-2026-11-02-section-113-payment-e2e.md`](./history/archive/AI_Handoff-2026-11-02-section-113-payment-e2e.md).

---

## §114. VelCenter/VelSeller UI audit (2026-11-02) — **ARCHIVED** (moved 2026-11-02)

Full text: [`archive/AI_Handoff-2026-11-02-section-114-ui-audit.md`](./history/archive/AI_Handoff-2026-11-02-section-114-ui-audit.md).

---

## §115. LanguageProvider in VelCenter + VelSeller (2026-11-02) — **ARCHIVED** (moved 2026-11-02)

Full text: [`archive/AI_Handoff-2026-11-02-section-115-language-provider.md`](./history/archive/AI_Handoff-2026-11-02-section-115-language-provider.md).

---

## §116. VelCenter language switcher (2026-11-02) — **ARCHIVED** (moved 2026-11-02)

Full text: [`archive/AI_Handoff-2026-11-02-section-116-switcher.md`](./history/archive/AI_Handoff-2026-11-02-section-116-switcher.md).

---

## §117. VelCenter sidebar layout (2026-11-02) — **ARCHIVED** (moved 2026-11-02)

Full text: [`archive/AI_Handoff-2026-11-02-section-117-sidebar-layout.md`](./history/archive/AI_Handoff-2026-11-02-section-117-sidebar-layout.md).

---

## §118. VelCenter shell: drawer + collapse (2026-11-02) — **ARCHIVED** (moved 2026-11-02)

Full text: [`archive/AI_Handoff-2026-11-02-section-118-shell-drawer.md`](./history/archive/AI_Handoff-2026-11-02-section-118-shell-drawer.md).

---

## §119. VelCenter shell copy in TH/EN/MY (2026-11-02) — **ARCHIVED** (moved 2026-11-02)

Full text: [`archive/AI_Handoff-2026-11-02-section-119-shell-i18n.md`](./history/archive/AI_Handoff-2026-11-02-section-119-shell-i18n.md).

---

## §120. VelCenter dropdown diagnostic — no confirmed defect, browser repro needed (2026-11-02) — **ARCHIVED** (moved 2026-11-02)

Full text: [`archive/AI_Handoff-2026-11-02-section-120-dropdown-diagnostic.md`](./history/archive/AI_Handoff-2026-11-02-section-120-dropdown-diagnostic.md).

---

## §121. VelCenter dropdowns — browser phase BLOCKED, no code change (2026-11-02) — **ARCHIVED** (moved 2026-11-02)

Full text: [`archive/AI_Handoff-2026-11-02-section-121-dropdown-blocked.md`](./history/archive/AI_Handoff-2026-11-02-section-121-dropdown-blocked.md).

---

## §122. VelCenter local authenticated harness + first measurement (2026-11-02) — **ARCHIVED** (moved 2026-11-02)

Full text: [`archive/AI_Handoff-2026-11-02-section-122-harness.md`](./history/archive/AI_Handoff-2026-11-02-section-122-harness.md).

---

## §123. Root cause of the "top-left strip" identified from the owner's screenshot (2026-11-02) — **ARCHIVED** (moved 2026-11-02)

Full text: [`archive/AI_Handoff-2026-11-02-section-123-drawer-root-cause.md`](./history/archive/AI_Handoff-2026-11-02-section-123-drawer-root-cause.md).

---

## §124. VelCenter mobile drawer fixed (2026-11-02) — **ARCHIVED** (moved 2026-11-02)

Full text: [`archive/AI_Handoff-2026-11-02-section-124-drawer-fix.md`](./history/archive/AI_Handoff-2026-11-02-section-124-drawer-fix.md).

---

## §125. VelShop footer removed — app-style (2026-11-02)

**SHA:** `b32dae7` → this commit. Report: [`.ai/history/2026-11-02-velshop-app-shell-no-footer.md`](./history/2026-11-02-velshop-app-shell-no-footer.md).

Owner wants VelShop to behave like an application: no footer, with เกี่ยวกับฉัน / เงื่อนไข / ติดต่อ / ออกจากระบบ
living in the profile screen (Thaimart pattern, Velnox theme). Step 1 done: `ShopFooter` renders `null`
centrally, so all ~20 pages lost the marketing footer without touching them. velShop typecheck + build pass.
**Next:** restructure `ShopProfile.tsx` into the card sections + logout button; support channels must come from
the owner (no invented LINE/email/phone).

---

## §126. Status check: VelShop app-shell work (2026-11-02)

**SHA:** `1015e74` (== origin/main, clean). Report: [`.ai/history/2026-11-02-status-check.md`](./history/2026-11-02-status-check.md).

Verified green now: i18n 1294×3, typecheck 4/4, velShop + velCenter builds, 1529 backend tests with only the 8
Termux-only DB-guard failures. On main: VelShop footer removed centrally (`1015e74`), VelCenter drawer fixed with
browser evidence (`b32dae7`), shell copy in TH/EN/MY (`5d7996c`). The cookie-policy profile row was attempted and
**reverted** (locale namespace spread caused `TS1117`), so it returns next via direct base-locale edits. Contact
card stays blocked on real owner-provided channels. Local harness dies with the app restart — restart commands
recorded in §13 of the harness report.

---

## §127. Spec handed off: VelShop profile in the ThaiMart pattern (2026-11-02)

**Document:** [`.ai/tasks/active/velshop-profile-thaimart-spec.md`](./tasks/active/velshop-profile-thaimart-spec.md).

Block-by-block mapping from the reference screenshots to VelShop's existing routes/APIs, the gotcha that broke the
last attempt (`profile` namespace spread → `TS1117`, edit the base locale instead), the ordered work items, the
exact i18n keys to add for th/en/my, acceptance criteria with the local harness, and the hard "do not" list
(no footer, no invented contact channels/promos/IDs). Written so another agent can turn it into instructions
without re-investigating.

---

## §128. VelShop profile: cookie-policy row shipped, rest of the spec open (2026-11-02)

**SHA:** `8d7a2e1` → this commit. Report:
[`.ai/history/2026-11-02-velshop-profile-cookie-row.md`](./history/2026-11-02-velshop-profile-cookie-row.md).

First slice of the ThaiMart-pattern profile: the existing data-driven `ACCOUNT` row array gained `/cookies`, and
the three base locale files (`th.ts`/`en.ts`/`my.ts`) gained `profile.cookies*` **directly** — the approach that
fixes the earlier `TS1117` spread failure. i18n 1296×3, velShop typecheck + build pass, diff clean.
**Still open:** 4-tile order strip (needs the orders query), external terms/privacy rows (need an `<a>` row
variant), contact e-mail/phone (blocked on owner values), promo banner (no real source), browser measurements.

---

## §129. Impeccable skill installed; CLI still needs its platform binary (2026-11-02)

**Report:** [`.ai/reports/impeccable-skill-analysis.md`](./reports/impeccable-skill-analysis.md).

Installed the upstream skill from `pbakaus/impeccable` into the user skills dir: `SKILL.md` + `references/`
(42 files) + `scripts/` (11 files, 2.3 MB); `reference/` was renamed to `references/` and 66 paths in SKILL.md
rewritten so the Harness can resolve them (`skill_view(..., "references/android.md")` verified). All design
**judgement** commands are usable through their runbooks. **Not executable:** `scripts/impeccable` needs a
per-platform binary that the git checkout does not ship (`node scripts/impeccable --version` fails), so
`hooks`, `pin/unpin`, `doctor`, `live`, `generate` are documented-only until the npm platform package is
installed.

---

## §130. VelShop profile: order-status tile card (2026-11-02)

**SHA:** `ec77ac6` → this commit. Report:
[`.ai/history/2026-11-02-velshop-profile-order-tiles.md`](./history/2026-11-02-velshop-profile-order-tiles.md).

Four-tile order-status card added above the menu groups (bordered `rounded-2xl`, `grid-cols-4`, divide-x, icon +
11 px label, full-tile link) with `profile.orderTiles.*` keys written directly into `th.ts`/`en.ts`/`my.ts`
(1300 × 3 parity). velShop typecheck + build pass, diff clean. **Gaps:** no counts (no status-filter/aggregate
API), tiles link to `/orders`; header/member reference, group re-titling, external terms/privacy, contact
e-mail/phone and the promo banner remain open; browser measurements not taken.

---

## §131. VelShop profile: external terms/privacy rows (2026-11-02)

**SHA:** `f31e4fa` → this commit. Report:
[`.ai/history/2026-11-02-velshop-profile-external-rows.md`](./history/2026-11-02-velshop-profile-external-rows.md).

`ProfileRow` now supports `external` and `renderRow` builds the markup once, wrapping in `<Link>` or a real
`<a target="_blank" rel="noreferrer">`; the ACCOUNT group links to the existing corporate terms/privacy URLs.
`profile.terms|privacy` keys added directly to th/en/my (1304 × 3). typecheck + build pass, diff clean.
Still open: tile counts, header reference, group renaming, contact rows, promo, browser measurements.

---

## §132. Superpowers skill collection installed (2026-11-02)

**Report:** [`.ai/reports/superpowers-installation-report.md`](./reports/superpowers-installation-report.md).

All 15 `obra/superpowers` skills installed flattened into the user skills dir (`category: general` added where
missing), verified discoverable via `skills_list`; `impeccable` untouched. Harness supports shell, subagents,
parallel `task` calls and `todo_write`; it does **not** support upstream session hooks, the Node installer,
auto-activation triggers or CLI helpers — those are documented as gaps, not simulated. Note: user copies of
`systematic-debugging` / `test-driven-development` now shadow the bundled versions.

---

## §133. Impeccable integration test: real critique produced, tooling unavailable (2026-11-02)

**Report:** [`.ai/reports/impeccable-integration-test.md`](./reports/impeccable-integration-test.md).

Ran the skill for real on `apps/velshop/src/pages/ShopProfile.tsx`: `references/critique.md` + `references/audit.md`
loaded, 10-heuristic table scored **26/40 (Acceptable)**, five prioritised issues (no state colour/count on the
order tiles, **zero `focus-visible`** in the page, two icon grammars, "Session" jargon, dead `ShopFooter` import),
persona flags for Casey/Sam/Jordan. Run is **DEGRADED** by design: the detector/overlay CLI has no platform
binary, and assessments ran inline instead of in isolated sub-agents. **No browser verification** — no
screenshots or measurements were taken.

---

## §134. Local UI harness request: BLOCKED, host tools already cover most of it (2026-11-02)

**Report:** [`.ai/reports/local-ui-harness.md`](./reports/local-ui-harness.md).

The Android Harness app is **not in this workspace** (no Gradle project under the app files), so no WebView
component, tool registry entry or dependency could be added. Its built-in tools already implement the required
surface — `browser_navigate/refresh/click/type/scroll/get_dom/get_logs/eval/screenshot` plus
`shell_background`/`bg_list`/`bg_kill` — and loopback was proven this session (`localhost:5173` + proxy `:8899`).
Real gaps, all inside the host app: viewport control (WebView fixed at 492 px), network log, explicit close, and
an origin allow-list (any URL is currently reachable). No code changed in this repo.

---

## §135. Standard Local UI Testing workflow (2026-11-02)

**Document:** [`.ai/testing/LOCAL_UI_TESTING.md`](./testing/LOCAL_UI_TESTING.md).

Tool-only procedure (no Playwright, no app change): `shell_background` → `curl` 200 → `browser_navigate` →
`browser_eval` render/geometry proof → `browser_get_dom` → `browser_get_logs` → optional `browser_screenshot`
(needs the visible preview) → `bg_kill` + post-kill curl. Verified live on a scratch fixture at
`127.0.0.1:4180`: navigated, `title=VelNox UI Probe`, `vw=492`, `scrollWidth=492`, screenshot **NOT CAPTURED**
(preview hidden). Hard rules recorded: localhost only, no production cookies, and never claim responsive or
network verification from this harness (viewport fixed at 492 px, no request log).

---

## §136. `/profile` local validation: server + navigation PASS, render BLOCKED by harness script (2026-11-02)

**Report:** [`.ai/history/2026-11-02-velshop-profile-local-ui-validation.md`](./history/2026-11-02-velshop-profile-local-ui-validation.md).

Built velShop with the API pointed at an unreachable local port, served it with `shell_background` on
`127.0.0.1:5174` (job 15), both `/` and `/profile` answered 200, and `browser_navigate` reached the route — but
the document never rendered (`document.body` null, 0 buttons, empty title). The only console errors are the
Harness's own injected instrumentation (`__harnessUpdateScroll`, `appendChild` on a null body), so this is a
tooling failure, not a VelShop defect. Screenshot **NOT CAPTURED**; render/DOM/interaction/responsive/network
**NOT VERIFIED**. Cleanup: `bg_kill(15)` → curl `000`.

---

## §137. Harness browser-injection diagnosis: harness-side, root cause unconfirmed (2026-11-02)

**Report:** [`.ai/history/2026-11-02-harness-injection-diagnosis.md`](./history/2026-11-02-harness-injection-diagnosis.md).

Runtime evidence: on `127.0.0.1:5174/profile` the document stays `readyState:"loading"`, `document.body` is null,
title empty, `typeof window.__harnessUpdateScroll === "undefined"` — while the console repeats
`__harnessUpdateScroll is not a function` and one `appendChild` on a null body, all at injected lines 3/7. A
static fixture loaded fine in the same session. Classification: harness injection timing + a conditional helper
called unconditionally; **not** a Velnox defect. The host app's source is not in this workspace, so the exact
injector and a fix cannot be confirmed; a minimal proposal (guard on readyState/body, define-before-call,
idempotent injection, re-inject on pageshow) is recorded. No repo files changed.

---

## §138. `local-browser-testing` skill created (2026-11-02)

**Skill:** [`.ai/skills/local-browser-testing/SKILL.md`](./skills/local-browser-testing/SKILL.md) · mirrored to
`.harness/skills/local-browser-testing/SKILL.md` so the Harness actually discovers it (project skills load from
`.harness/skills/`, not `.ai/`). Skill = trigger + evidence rules only; the procedure stays in
[`.ai/testing/LOCAL_UI_TESTING.md`](./testing/LOCAL_UI_TESTING.md) — no duplicated workflow. Encodes the verified
limits: `shell_background` (never `nohup`), HTTP 200 ≠ rendered, harness-injection failures are not app defects,
screenshot needs a visible preview, no network/responsive claims.

---

## §139. Session summary report (2026-11-02)

**Report:** [`.ai/reports/session-summary.md`](./reports/session-summary.md) — one page covering the sandbox
payment proof and its three fixes, the refund/replay tests that are green in CI, the VelCenter/VelSeller
provider + drawer + i18n work, the VelShop footer/profile changes, the three installed skills (impeccable,
superpowers, local-browser-testing), and the local UI testing workflow with its verified limits (render blocked by
harness instrumentation on `/profile`).

---

## §140. ThaiMart reference analysis → VelShop plan (2026-11-02)

**Document:** [`.ai/tasks/active/thaimart-reference-analysis.md`](./tasks/active/thaimart-reference-analysis.md).

Extracted the real anatomy from the owner's screenshots (brand bar with pill search + cart badge + chat, circular
category rail, 18/12 section headings, 2-col 1:1 product grid, **fixed 4-item bottom nav**, no footer) and mapped
each region to VelShop's current state with the tokens to reuse (`#10B981` accent, radius 16/12/full, 11–18 px
type scale). Implementation order: bottom tab bar → header brand bar → category rail → grid → profile → other
screens. Analysis done; no UI code changed in this step.

---

## §141. VelShop bottom tab bar → 4 tabs (2026-11-02)

Step 1 of the plan. **Correction to §140:** VelShop already had a bottom bar — `ShopTabBar` in
`apps/velshop/src/main.tsx` mounting the shared `MobileTabBar` (5 items: home · products · cart ·
orders · profile). Nothing was rebuilt; only the item set changed.

Now: **หน้าแรก · ออเดอร์ · การแจ้งเตือน · โปรไฟล์** (`/` · `/orders` · `/notifications` ·
`/profile`), matching the reference. `/products` and `/cart` left the bar (products stays on the home
"view all" + category rail, cart stays on the header cart icon → `CartDrawer`). Cart badge wiring and
the `Package` / `ShoppingCart` imports removed with it. Routes, auth guards and cart state untouched.

Already supplied by the shared bar and reused as-is: fixed floating pill with safe-area inset,
`#10B981` active colour (`#ECFDF5` icon pill), `md:hidden` so desktop keeps header nav, `.site-app`
bottom padding under 768 px, `null` on `/auth`. Labels came from existing `nav.*` keys — no new i18n.

**Verified:** typecheck 0 · build 0 · i18n 1304/1304/1304 · live DOM: 4 links in order, `/` active
with computed `rgb(16,185,129)`, bar `display:flex` at mobile width · built CSS: `.md\:hidden` inside
`@media(min-width:48rem)`. **Visual: NOT VERIFIED** (`browser_screenshot`: "preview hidden or
detached", §137).

**Remaining:** plan steps 2–6 (header brand bar, category rail, 2-col grid, profile tokens, other
screens).

**Record:** [`.ai/history/2026-11-02-velshop-bottom-nav-4tabs.md`](./history/2026-11-02-velshop-bottom-nav-4tabs.md).

## §142. VelShop header → mobile brand bar (2026-11-02)

Step 2 of the plan. `ShopHeader` now has two responsive presentations of one component: a mobile
**solid `#10B981` bar, 56 px** (brand mark 32 px on a white tile · white pill search 40 px with the
magnifier on the right · language · cart with the real count · chat) and the **unchanged** desktop bar
(logo · nav · language · bell · cart · profile/login). No second header system, no backend change.

Search writes the existing `/products?q=` contract (drops `page`, preserves other filters, mirrors `q`
back into the pill) — no duplicate search. Cart keeps `openCart()` (drawer / guest → `/auth?returnTo=/`)
and the real count. Chat uses the existing `/chat` route plus `useChatUnread("customer")` (server count,
`null` → no badge). `LanguageSwitcher` gained `tone="brand"`; `CartFlyAnimation` now targets the visible
`[data-cart-icon]`. i18n: `header.ariaChat` added to th/en/my → 1305 keys each.

**Verified (measured):** header 56 px sticky z-40 · bar `rgb(16,185,129)` · pill 40 px, fully rounded,
white · logo box 36 / mark 32 · cart & chat 36 px at `x=400/444` · overflow 0 · desktop bar
`display:none`. Widths 360/390/430/492 (iframe probes): header 56, pill 156/186/226/288, overflow 0
each. Search → `/products?q=เสื้อผ้า`; logo → `/`; cart (guest) → `/auth?returnTo=/`; chat link → `/chat`.

**Blocked:** screenshots NOT VERIFIED (§137 — preview surface hidden); 768/1024/1440 NOT MEASURED
(iframes never leave `loading`; CDP resize unavailable on android/arm64) — desktop evidenced only by
`.md\:block` / `.md\:hidden` rules plus byte-identical desktop markup. Real cart/chat badge counts not
observable (guest session, empty cart) and were not fabricated.

**Record:** [`.ai/history/2026-11-02-velshop-header-brand-bar.md`](./history/2026-11-02-velshop-header-brand-bar.md).

## §143. Home vs Marketplace information architecture (2026-11-02)

Step 3. **IA split:** Home `/` = discovery only (banner · compact categories · trending · new arrivals ·
memory rails), Market `/products` = the complete catalogue (search · category · seller · price range ·
availability · verified · sort · pagination).

- **Header search is route-aware:** the pill renders only on `/`. Marketplace keeps its own in-page
  search, so mobile never shows two search boxes and utility screens (`/orders`, `/notifications`,
  `/profile`, `/help`, PDP, cart, checkout, chat, account) show none. Submit still writes
  `/products?q=…` and now emits the `SEARCH` tracking event. Desktop nav now says `nav.market`.
- **Home:** hero removed (it held the duplicate search form). Banner = real top category + its live
  count → `/products?category=…` (no campaign source exists, so no campaign copy). Categories are
  4-per-row / 6-on-sm circular chips + "view all" → `/categories`. Trending keeps the real `soldCount`
  ranking, "view all" → `/products?sort=popular`; new section "new arrivals" = newest `createdAt`,
  "view all" → `/products?sort=newest`. Max 16 cards on Home.
- **Tabs:** 5 — home · market (`Store`) · orders · notifications · profile.
- **Marketplace filters:** already complete (category, real `shops` seller filter, min/max price,
  in-stock, verified, Sheet + sidebar, apply/reset). **Removed the `rating` sort** — the API implements
  only `newest`/`price_asc`/`price_desc`/`popular`.

**i18n:** `nav.market`, `home.bannerEyebrow`, `home.bannerCta`, `home.newTitle`, `home.newDesc` in
th/en/my → **1310 each, parity OK**.

**Verified:** typecheck 4 apps 0 · build 0 · `/` pill 288×40, header 56 · `/products` and `/help` pill
absent, page search present on Market · 5 tabs with correct `aria-current` · overflow 0 at 492 px.
**Catalogue is empty in this sandbox**, so banner/rails render nothing (correct empty state) — not
observable with data, and no mock data was added.

**Not verified:** screenshots (§137) · widths 360/390/430/768/1024/1440 (iframe probes stuck loading,
CDP resize unavailable) · `bun test backend/tests` 1139 pass / 382 skip / 8 fail (all in
`test-database-isolation.test.ts` subprocess probes — sandbox limitation, no backend file touched).

**Record:** [`.ai/history/2026-11-02-velshop-home-marketplace-ia.md`](./history/2026-11-02-velshop-home-marketplace-ia.md).

## §144. Home storefront polish — real image banner + density (2026-11-02)

Step 4. Architecture from §143 untouched (Home discovery · Market catalogue · route-aware search ·
five tabs · filters/sort).

- **Banner** now carries a real product photo: category = most-stocked published category, count = its
  live count, image = `primaryImage.displayUrl ?? url` of a real product in that category (Cloudflare R2
  CDN), `object-fit: cover`, `alt` = product name, destination `/products?category=<slug>`. No campaign
  source exists, so no sale/discount copy. Text-only fallback when no product image exists.
  Size: `h-[150px]` mobile, `md:h-[240px]`; `rounded-2xl`; mint surface; 38 %/42 % image column.
- **Density:** Home rails `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4`; category section padding
  `py-4 sm:py-5`; chips unchanged (56 px circle, 11 px label, 4/6 per row).

**Verified (measured):** banner 460 × 150 at 492 px, image 174 × 148 `cover` (natural 1280 × 1810),
header 56 px, overflow 0, typecheck 4 apps 0, build 0, i18n 1310 ×3, tests 1139/382/8 (8 = sandbox
DB-guard subprocess probes). Desktop evidenced only by rules (`md:h-[240px]` in `48rem`,
`sm:grid-cols-3` in `40rem`, `lg:grid-cols-4` in `64rem`).

**Not verified:** VISUAL VERIFICATION: NOT VERIFIED (§137 preview surface hidden); 768/1024/1440 not
measurable. Real catalogue currently has 1 published product, so Home honestly shows 1 chip/1 card.

**Record:** [`.ai/history/2026-11-02-velshop-home-banner-polish.md`](./history/2026-11-02-velshop-home-banner-polish.md).

## §145. Production visual audit + marketplace filter polish (2026-11-02)

First audit of the **deployed** site (`https://velshop.vercel.app`), not a local build. Deployed CSS carries
the §144 classes, so production is at/after the banner step.

**Evidence channel:** in-app screenshots are still BLOCKED (§137 — preview surface hidden; no CDP resize on
android/arm64). Real renders were obtained through `image.thum.io` (desktop-width viewport only) and the
deployed DOM was probed at the app browser's 492 px width.

**Defect found and fixed (Marketplace filters):** the 1440 render showed the category filter as ~22 stacked
outlined buttons stretching the sidebar well past the results column, with a near-black `bg-slate-900`
active chip that contradicted the `#10B981` accent. Change (presentation only): active chip → mint
`#10B981`; inactive → soft `bg-slate-50` rows without outlines; desktop list capped at `max-h-[340px]` with
its own scroll. Filtering logic, URL params, sort options, pagination and backend untouched.

**Observed but not "fixed":** the catalogue has a single published product, so Home shows one category chip
and one card per rail and Market shows one result — real data, left honest.

**Verified:** typecheck 4 apps 0 · build 0 · i18n 1310×3 · `diff --check` 0 · production `/` at 492 px:
header pill present, 5 tabs, overflow 0 · tests 1139/382/8 (8 = sandbox DB-guard subprocess probes).

**Not verified:** mobile 360/390/430 renders (no real viewport), in-app screenshots, and in-app DOM probes of
`/products` `/orders` `/notifications` `/profile` / PDP (documents broke under the injected script).
`image.thum.io` renders a **1280 CSS px** viewport and scales to the requested output width, so desktop
evidence is 1280 px — never quote it as 1440 px.

**Deployed twice and verified:** `0544b58` (accent chip + soft rows + 340 px cap) then `6ffeed5`
(+ `lg:overflow-x-hidden`, because the first re-render still showed a horizontal scrollbar under the capped
list). Each deploy was confirmed by fetching the production CSS and grepping the new class
(`index-DWsdvEgl.css` → `.lg\:max-h-\[340px\]`, `index-r0p13K9O.css` → `.lg\:overflow-x-hidden`).
Screenshots: `products-1440.png` (before) → `products-1440-after.png` (fix 1) → `products-after2.png`
(fix 2, scrollbar gone).

**Record:** [`.ai/history/2026-11-02-velshop-production-audit-filter-polish.md`](./history/2026-11-02-velshop-production-audit-filter-polish.md).

## §146. Announcement carousel + dropdown positioning (2026-11-02)

**No announcement system exists.** `db/schema.sql` has no announcement/campaign table; the only related
field is `shops.announcement` (per-shop, set in VelCenter settings). So the carousel was built against a
clean `Announcement[]` contract and fed **real storefront data only**: a platform welcome, the live listed
count, and the live Velnox-verified count. No campaign, discount, countdown or percentage is claimed, and
the component renders `null` when the list is empty.

- `apps/velshop/src/components/shop/AnnouncementCarousel.tsx` (new): fixed 136/168 px stage (no reflow),
  one re-armed `setTimeout` per slide (5 s, cleared on unmount/pause/hidden tab), pointer swipe > 40 px,
  dot buttons, desktop arrows, ←/→ keys, `aria-live` position text, `prefers-reduced-motion` disables
  autoplay and the slide transform.
- Home: the product-image banner and its `bannerProduct` memo are gone; the carousel sits in the same slot
  between the header and the categories. Header, five tabs, search routing, categories, rails unchanged.
- i18n: new `announce.*` namespace, 12 keys, th/en/my → **1322 each, parity OK**.

**Dropdown positioning (shared primitives).** Root cause: `SelectContent` defaulted to Radix
`position="item-aligned"` + `align="center"`, which anchors the menu to the selected row and can push a long
list outside the viewport. Now `position="popper"`, `align="start"`, `sideOffset=4`, `collisionPadding=8`,
`max-h-[min(320px,available)]` (dropdown: `min(360px, …)`), internal scroll. Radix flips to the top edge
automatically when space below is short. Applies to VelShop, VelSeller and VelCenter through the shared
primitives; no second dropdown system.

**Verified:** typecheck 4 apps 0 · build velshop 0 · build velcenter 0 · i18n 1322×3 · `diff --check` 0 ·
tests 1139/382/8 (unchanged sandbox DB-guard failures) · carousel at 492 px: 3 real slides, 3 dots with
labels, autoplay advancing, dot click and synthetic swipe both navigate, `overflowX = 0`.

**Not verified:** VelCenter dropdown runtime **BLOCKED** (no authorized account; the harness also failed to
render `/` and `/products` in this session); 360/390/430/1440 carousel renders **NOT VERIFIED** (no viewport
control, change not deployed yet).

**Record:** [`.ai/history/2026-11-02-announcement-carousel-and-dropdown.md`](./history/2026-11-02-announcement-carousel-and-dropdown.md).

## §147. Owner-managed announcements (VelCenter → VelShop) + native selects removed (2026-11-02)

The carousel now has a real content pipeline the owner controls, without a schema change:
`platform_settings` key `shop_announcements` holds a JSON array (`id, title, description, imageUrl,
linkUrl, active, sortOrder`, ≤10 items, 240 chars).

- `GET /api/announcements` — public, active items sorted, never 500s.
- `GET/PUT /api/admin/announcements` — `settings.manage` only.
- Upload purpose `announcement` → key `announcements/{userId}/{uuid}.webp`, owner segment enforced at
  confirm; only `settings.manage` can mint it. VelCenter's editor uploads through presign → R2 → confirm.
- VelCenter → Settings shows **"แบนเนอร์ประกาศหน้าแรก"**: add/remove/reorder, visibility toggle, title,
  short text, optional link, image preview + upload, save. i18n `announceAdmin.*` (17 keys, 1339 ×3).
- VelShop: carousel renders the published items (image column when a URL exists, internal `Link` or
  external `a`), and falls back to the honest platform facts only when the list is empty.

**VelCenter dropdowns:** the five native `<select>` controls (category parent tree, audit action/entity,
moderation status/sort, verification status) are now the shared Radix `Select`, which uses
`position="popper"` + `collisionPadding=8` + `max-h: min(320px, available)` and scrolls internally, so a
long list flips above the trigger instead of running off the top of the viewport.

**Verified:** typecheck 4 apps 0 · build velshop 0 · build velcenter 0 · backend `tsc --noEmit` 0 ·
i18n 1339×3 · `diff --check` 0 · tests 1139/382/8 (8 = known DB-guard subprocess probes; the
upload-security allowlist test was updated and passes).

**Not verified:** the new API and the VelCenter editor at runtime — needs `DATABASE_URL`/R2 credentials and
an authorized account; the harness could not render authenticated pages. No banner-editor screenshot.

**Record:** [`.ai/history/2026-11-02-velcenter-announcements-and-dropdowns.md`](./history/2026-11-02-velcenter-announcements-and-dropdowns.md).

## §148. VelCenter mobile nav drawer offset (2026-11-02)

The mobile menu rendered `fixed inset-y-0`, i.e. from the very top of the viewport, while the page header
is `sticky … h-16 z-40`. The first nav rows therefore sat under the header/status area and were
unreachable, and the scrim shared `z-40` with that header.

Fix (presentation only): drawer starts at `top-16` (exactly below the header), ends at `bottom-0`, keeps
internal scrolling, gets `pb-[calc(1rem+env(safe-area-inset-bottom))]` and a shadow, plus an in-drawer
title row with an explicit close (X) button. Scrim moved to `z-30`, drawer stays `z-50`, desktop keeps
`md:static md:overflow-visible md:px-0 md:pt-0 md:shadow-none`.

**Verified:** velcenter typecheck 0 · build 0 (8.89 s) · `diff --check` 0 · built CSS contains `.top-16`,
`.z-30`, `.z-50`, `.pb-[calc(1rem+env(safe-area-inset-bottom))]`.

**Corrected in §150:** the offset was only half the bug — see the TabsList `h-9` finding below.

**Record:** [`.ai/history/2026-11-02-velcenter-mobile-nav-offset.md`](./history/2026-11-02-velcenter-mobile-nav-offset.md).

## §149. Local authenticated UI harness (2026-11-02)

Owner-supplied sessions are stored **only** in `.harness/sessions.json` (untracked, `600`) for three roles:
`customer` (VelShop), `center` (VelCenter), `seller` (VelSeller). `.harness/proxy.py` forwards
GET/POST/PUT/PATCH/DELETE to `https://velnox-api.onrender.com`, injects that role's `velnox_session` cookie
and answers CORS for any local dev origin — cookies cannot be set cross-site, so this is the only reliable
way to authenticate a localhost build.

```
.harness/dev-auth.sh center      # prints the exact ports
HARNESS_ROLE=center HARNESS_PORT=5192 python3 .harness/proxy.py
VITE_API_URL=http://127.0.0.1:5192 bun run dev:velcenter -- --port 5193
```

**Verified:** `/api/auth/me` **200** (Jirad, `884291e5…`), `/api/admin/settings` **200** (settings.manage),
`/api/seller/status` **200**; session file permissions `-rw-------`; `.harness/` is gitignored so nothing
secret can be committed.

**Blocked:** the in-app browser now kills every authenticated document (`documentElement === null`,
`scripts === 0`, `readyState: "loading"` — §137), so the VelCenter drawer and the announcement editor still
could not be inspected visually. Drawer fix remains code+CSS-verified only.

**Record:** [`.ai/history/2026-11-02-local-auth-harness.md`](./history/2026-11-02-local-auth-harness.md).

## §150. Authenticated UI check + real drawer root cause (2026-11-02)

Using the owner sessions from §149 (cookie-injecting proxy, production API), VelCenter was finally
rendered at 492 px and measured.

**Root cause of the clipped menu:** `#center-nav` is the shared Radix `TabsList`, whose default class
carries `h-9`. The drawer itself was already positioned correctly (`top: 64` under a 65 px header), but
the eleven-tab vertical list was confined to a **36 px** box, so the first tabs rendered at
`top: -35` — above the viewport, exactly what the owner reported. The `flex … flex-col` class never
removed that height.

**Fix:** `h-auto` on the TabsList (tailwind-merge drops `h-9`).

| Measured after fix (492 px) | Value |
|---|---|
| drawer | top 64 → bottom 815 (full height), `fixed`, `z-50`, `overflow-y: auto` |
| `#center-nav` | 458 px tall (was 36) |
| first / last tab | `top: 119` / `top: 531` — both visible |
| tabs / close button | 11 / present |
| drawer padding | 12 px top, 33 px bottom (safe area) |

**Also verified in the same session:** Settings → “แบนเนอร์ประกาศหน้าแรก” card renders with add + save;
`GET /api/announcements` 200 `[]`; `GET/PUT /api/admin/announcements` 200; a temporary announcement
round-tripped into the VelShop carousel (1 slide, 138 px, `overflowX = 0`) and was deleted again;
`POST /api/upload/presign` with `purpose: "announcement"` minted
`announcements/{userId}/{uuid}.webp`.

**Not verified:** the actual R2 PUT/confirm for an announcement image (only presign), desktop rendering,
and a published (non-empty) announcement left in production — the probe was removed.

**Record:** [`.ai/history/2026-11-02-velcenter-mobile-nav-offset.md`](./history/2026-11-02-velcenter-mobile-nav-offset.md).

## §151. Full ecosystem regression audit (2026-11-02)

Audit only — **no application code changed**; working tree clean before and after. HEAD `68dcc64`.

**Matrix:** typecheck 4/4 **PASS** · builds 4/4 **PASS** · backend `tsc` **PASS** · i18n **1339×3 PASS** ·
backend tests **1139 pass / 382 skip / 8 fail** (all `test-database-isolation` subprocess probes —
environment only) · production `curl`: shop / seller / center / `velnox.vercel.app` / API health **200**,
`velnox.com` **000 (DNS, not a code defect)**.

**Re-verified fixes from §141–§150** (regression, not trust):

- drawer: `top 64` under a 65 px header, `#center-nav` **458 px** (not 36), first tab 119, last 531, close
  button, no overflow;
- dropdown (Audit filter at 451 px): opens `side=top`, rect inside the viewport, `max-height 320px`;
- announcements: create 2 → public order, edit + reorder → order flips, hide → public drops it while admin
  still sees it, delete all → `[]`;
- VelShop: `/` carousel 3 fallback slides + 3 dots + pill + 5 tabs; `/products` no header pill, search,
  price inputs, filters, sort, active tab; PDP price + cart action, no pill; `/cart` authenticated empty
  state; every page `overflow 0`;
- VelSeller `/seller/goals` renders real data;
- authz: seller → admin endpoints **403**, anonymous → API **401**, seller → `/api/seller/status` **200**;
- VelRepeat: no runtime remnants (two comments only).

**Not verified:** screenshots (§137); any viewport other than 492 px; seller shop/orders and corporate
pages (documents destroyed by the injected script); checkout/Stripe/PromptPay/chat realtime (would mutate
production); R2 `confirm` (presign only); `db/verify-reconciler.sh` **BLOCKED** (no Postgres, `/tmp`
not writable) — not evidence of schema drift.

**Record:** [`.ai/history/2026-11-02-full-ecosystem-audit.md`](./history/2026-11-02-full-ecosystem-audit.md).

## §152. Deployment recovery + real R2 announcement image (2026-11-02)

Start `804d2c6` (the brief’s `68dcc64` was already superseded). **No deployment failure could be
reproduced:** all four Vercel projects have READY production deployments (velshop/velcenter/velnox at
`804d2c6`; velseller at `dc90ba9` with no newer build because that app did not change). No
`build-rate-limit` state appeared in the queried window. Production URLs answer 200; `velnox.com` still
does not resolve (DNS, owner infra).

**R2 flow verified end to end** with a 70-byte PNG through the owner session: presign 200 →
PUT 200 → confirm 200 → public URL 200 → announcement saved → public API returned it → VelShop carousel
rendered the `<img>`. The image initially never loaded because the slide used `loading="lazy"`; the active
slide is now `eager` (`AnnouncementCarousel.tsx`, one line) and the image completed (`natural 1×1`).
Failure paths behave: 400 for a bad type, 400 for a missing object, 403 for a foreign-owner key, 403 for a
seller minting an `announcement` upload (`settings.manage required`). Test announcements were deleted
(`shop_announcements` is `[]`); the uploaded probe object remains public because no delete endpoint exists.

**Responsive:** only 492 px is renderable — CDP cannot install on android/arm64 and iframes return no
document, so 360/390/430/768/1024/1280/1440 stay **NOT VERIFIED**.

**Tests:** typecheck 4/4, velshop build, i18n 1339×3, `diff --check` — all PASS after the fix.

**Record:** [`.ai/history/2026-11-02-deployment-recovery-r2-verification.md`](./history/2026-11-02-deployment-recovery-r2-verification.md).

## §153. Payment, database and chat verification — what is actually blocking (2026-11-02)

Audit only; **no application code changed** (HEAD `79f1b61` + this docs commit).

- **The 8 failing `test-database-isolation` probes are an environment limitation, not a defect.** They spawn
  `bun -e` with a minimal env (`PATH/HOME/NODE_ENV`); on this Android sandbox *any* exec with a stripped
  environment fails: `env -i … bun …` → “Permission denied” (exit 126), and the same is true for `bash`.
  Assertions stay untouched.
- **Database reconciler BLOCKED:** `initdb` (twice, one with `--no-sync`) produced no output within 240–300 s,
  so no disposable cluster exists here. Do not read this as schema drift.
- **Payments BLOCKED:** no `STRIPE_SECRET_KEY`, no test database. No charge, refund or order was created.
- **Chat realtime BLOCKED:** `/ws` closes with 1006 after 8 s for both anonymous and cookie-authenticated
  probes, so it proves nothing about auth — neither PASS nor FAIL.
- **Responsive still NOT VERIFIED beyond 492 px:** CDP binary unavailable for android/arm64, iframes yield no
  document.

**Green this pass:** typecheck 4/4 · builds 4/4 · backend `tsc` 0 · i18n 1339×3 · `diff --check` ·
tests 1139 pass / 382 skip / 8 env-fail. Skips = DB- and credential-gated suites plus 42 explicit
`test.skip` + 2 `test.skipIf` markers.

**Record:** [`.ai/history/2026-11-02-final-stabilization-payments-db.md`](./history/2026-11-02-final-stabilization-payments-db.md).

## §154. Velseller audit + primary-action colour (2026-11-02)

Audit of the seller app (routes `/seller/goals · shop · orders / :orderId · reorder · income · chat ·
profile`), run against the production API with the seller session at 492 px.

**Verified working:** dashboard renders real seller data and KPI cards with an empty-state CTA; `/seller/shop`
shows the real shop with status chips and true counts (2 products: 1 published, 1 suspended); the new-product
dialog is 437 × 713 inside an 815 px viewport and scrolls internally; `/seller/orders` renders its status
filters; every audited page has `overflow 0`; the five-tab bar is correct.

**Fix (presentation only):** primary actions and active filter pills used near-black `bg-slate-900`, against
the documented `#10B981` accent already used by VelShop/VelCenter. Fifteen occurrences across seven pages now
use `bg-[#10B981] hover:bg-[#059669]`. After the change the dashboard CTA computes `rgb(16, 185, 129)`.
No backend, schema, payment, auth or ownership file was touched.

**Not changed (reported):** primary buttons are 36 px tall (below the 44 px touch guidance); seller copy is
still hard-coded Thai (i18n debt).

**Checks:** typecheck 4/4 · velseller build 0 (6.77 s) · i18n 1339×3 · backend tests 1139/382/8 (8 = known
sandbox exec failures) · `diff --check` 0.

**Not verified:** any viewport other than 492 px (CDP unavailable, iframes empty); `/seller/income`,
`/reorder`, `/chat`, `/profile`, `/orders/:id` were not re-rendered this pass; no screenshots (§137).

**Record:** [`.ai/history/2026-11-02-velseller-audit-accent.md`](./history/2026-11-02-velseller-audit-accent.md).

## §155. Velseller round 2 — localised navigation + 44 px actions (2026-11-02)

Base `1c39a20`. Two verified defects fixed inside the seller scope:

- **Seller navigation ignored the language setting.** `AppHeader.NAV_ITEMS` (desktop) and `SELLER_TABS`
  (mobile tab bar) carried Thai literals, so EN/MY users still saw Thai. Added `sellerNav.*` (7 keys) to
  `th/en/my` (now **1346** each) and rebuilt both navs from `t()`. `AppHeader` is imported only by
  Velseller (grep), so the shared file cannot affect other apps.
- **Primary actions were 36 px tall.** Twelve seller CTAs plus the Income inline CTA are now `h-11` /
  `min-h-11` (44 px). Measured after the change: 44 px with `rgb(16,185,129)`.

A source-level guard test pins `<MobileTabBar items={SELLER_TABS} until="lg" />` after the
`shouldShowSellerTab` check; the identifier is now a local const so the assertion still holds rather than
being weakened (`seller-access-authorization.test.ts` → 8 pass / 8 skip / 0 fail).

**Checks:** typecheck 4/4 · velseller build 0 (15.05 s) · i18n 1346×3 · full suite 1139/382/8 (8 known
sandbox exec failures) · `diff --check` 0.

**Not verified:** viewports other than 492 px; `/seller/income`, `/reorder`, `/chat`, `/profile`,
`/orders/:id` were not re-rendered this round; EN/MY strings not observed on device (reload destroys the
document, §137).

**Record:** [`.ai/history/2026-11-02-velseller-i18n-touch.md`](./history/2026-11-02-velseller-i18n-touch.md).

## §156. Velseller product editor — existing images fixed (2026-11-02)

**Root cause (frontend only):** `ProductFormDialog` kept `galleryImages`/`detailImages` as empty local
arrays and never seeded them from `product.images`. Edit mode rendered `current.images` instead, while new
uploads appended to those empty arrays — so an image added during editing was invisible and never saved
(edit save looped only `detailImages`), and existing images had no remove control at all (`DraftImage` had
no database id to delete by).

**Fix in `packages/shared/src/components/seller/ProductFormDialog.tsx`** (imported only by `MyShop`):

- galleries are seeded from `product.images` (gallery + detail) with their `id`;
- one render path for both modes, remove button on every thumbnail (24 px);
- removing an existing image calls the existing `DELETE /api/seller/products/images/:id` (server checks
  seller ownership and refuses suspended/archived products); drafts are just dropped locally;
- saving edit mode persists only newly added images via `POST /api/seller/products/save-image` with their
  real `imageType`, then re-reads `/api/products/:id` so the caller gets the authoritative image list;
- thumbnails load eagerly so the editor shows images immediately.

**Verified (read-only, production data):** the edit dialog now renders **4/4** stored images
(`naturalWidth 1280`, `complete: true`, R2 host) and the counter reads `4 / 10`; API returns the four rows
with ids and https URLs; images return 200 to a browser UA. typecheck 4/4 · velseller build 0 (6.75 s) ·
i18n 1346×3 · backend suite 1139/382/8 (known env) · `diff --check` 0.

**NOT VERIFIED (would write to production):** adding an image, removing one, text-only save, reopen after
save. Viewports other than 492 px unverified; no screenshots (§137).

**Record:** [`.ai/history/2026-11-02-velseller-product-images.md`](./history/2026-11-02-velseller-product-images.md).

## §157. Velseller product management — end-to-end audit (2026-11-02)

Base `7396a4a`. Traced create → upload → save → list → edit → add → remove → save → reopen through
`ProductFormDialog`, `POST /api/seller/products/save-image`, `DELETE /api/seller/products/images/:id` and
`GET /api/seller/products`.

- **Real defect fixed (repeat save duplicated images):** the editor re-POSTed every image that still had no
  database id, because the state was never refreshed from the server after a successful save. The image
  lists are now derived by `seedGalleries()` and only `pendingUploads()` may be saved; after a save the
  lists are rebuilt from the returned product.
- **New pure helper** `packages/shared/src/lib/product-images.ts` (split gallery/detail by `image_type`,
  order by `sort_order`, keep ids/storage keys) with **9 unit tests** in
  `backend/tests/product-image-state.test.ts` — the duplication and ordering logic now has deterministic
  coverage without touching production data.
- Ownership re-proven live (no mutations): seller + unknown image **404**, customer delete **403**,
  customer save-image **403**, seller on a foreign product **403**.

**Verified read-only:** edit dialog shows **4/4** stored images (`naturalWidth 1280`, R2 host, counter
`4 / 10`) at 492 px; product list returns real statuses/counts. **Checks:** typecheck 4/4, velseller build
0 (7.12 s), backend `tsc` 0, suite 1139/382/8 across 81 files, i18n 1346×3, `diff --check` 0.

**NOT VERIFIED:** create/upload/add/remove/text-save/reopen (all write to the live shop), EN/MY product-form
copy (still hard-coded Thai), every viewport except 492 px, screenshots (§137).

**Record:** [`.ai/history/2026-11-02-velseller-product-management-e2e.md`](./history/2026-11-02-velseller-product-management-e2e.md).

## §158. Product upload guards + lifecycle verification (2026-11-02)

Base `68dd372`. Two real gaps closed while tracing create → upload → save → edit; no schema, auth or
ownership rule changed.

- **Draft upload key injection fixed.** `POST /api/seller/products/draft-upload-intent` interpolated the
  client's `draftId` and `subfolder` straight into the R2 key, so `subfolder="../../products/<id>"` could mint
  a presigned PUT outside the seller's own prefix. New `backend/lib/upload-paths.ts` allows at most three
  `[A-Za-z0-9_-]` segments and falls back to `preview`; the key is now built from the sanitised parts.
- **Stored-size limit enforced.** `save-image` discarded the `HeadObject` response, so any object size was
  accepted. It now keeps `ContentLength` and rejects over `MAX_UPLOAD_BYTES` with the documented
  `FILE_TOO_LARGE` code.
- **7 guard tests** (`backend/tests/product-upload-guards.test.ts`) cover traversal, absolute paths, the
  subfolders the UI actually sends, and both route wirings.

Earlier fixes re-verified read-only: the edit dialog still renders **4/4** stored images (`naturalWidth 1280`)
and the 9 `product-image-state` tests still pass.

**Checks:** typecheck 4/4 · velseller build 0 (11.56 s) · backend tsc 0 · suite 1139/382/8 across 82 files
(1545 tests) · i18n 1346×3 · `diff --check` 0.

**NOT VERIFIED:** create/upload/add/remove/text-save/reopen (production writes), the product form's TH/EN/MY
copy (still hard-coded Thai), viewports beyond 492 px, screenshots.

**Next recommended:** run the mutation E2E against a disposable seller + database, then internationalise the
product form.

**Record:** [`.ai/history/2026-11-02-velseller-product-management-e2e.md`](./.ai/history/2026-11-02-velseller-product-management-e2e.md) and [`./.ai/history/2026-11-02-velseller-product-upload-guards.md`](./.ai/history/2026-11-02-velseller-product-upload-guards.md).
