# Velnox AI Handoff — current state

**Last updated:** 2026-10-31 · **Branch:** `main` · **Latest pass:** **§89 — Messenger UX** (left/right already existed; ✓/✓✓, realtime read bound, daily Velnox Support acknowledgment, typing indicator). **`main` CI was RED before this pass:** run `41043341845` = 1401 pass / **11 fail** / 2 skip of 1414, every failure in `oauth-route.test.ts` (test isolation, not production behaviour) — §89 leaves it untouched and reproduces it locally. **Production DB Verify remains BLOCKED** (missing `NEON_PRODUCTION_DATABASE_URL`); **browser/E2E NOT RUN**. i18n 1264/1264/1264.
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

## §88. Unified Marketplace Chat (2026-10-30) — COMPLETE

**Starting SHA:** `2633cdf8bf2f11acfb0c0f4cb3100cfff361a228` (`HEAD == origin/main`, 0/0, clean tree).
**Code commit:** `feat(chat): add unified marketplace company and internal chat` (find with
`git log -1 --format=%H -- backend/routes/center-chat.ts`). **Docs commit:** `docs(ai): record unified
marketplace chat implementation` (find with `git log -1 --format=%H -- .ai/history/2026-10-30-unified-marketplace-chat.md`).
**Report:** [`.ai/history/2026-10-30-unified-marketplace-chat.md`](./history/2026-10-30-unified-marketplace-chat.md).

**Final chat architecture.** ONE core: `conversations` + `chat_messages`, with
`conversations.type` = `CUSTOMER_SELLER` | `CUSTOMER_COMPANY` | `SELLER_COMPANY` | `COMPANY_INTERNAL`.
`routes/chat.ts` owns the customer/seller routes and the shared helpers (`validateBody`, `loadMessages`,
`readUpTo`/`READ_BOUND_SQL`, `replaySend`/`rememberSend`, `notifyUser`, `notifyCompanyStaff`);
`routes/center-chat.ts` imports them for company endpoints. There is NO second table, engine, socket,
channel or polling loop. `sender_role` gained `company`; `conversations` gained `title`,
`support_status` (OPEN/ASSIGNED/WAITING/CLOSED) and `assigned_to`, and its participant columns are now
nullable **by type** (`conversations_participant_shape_check`). Partial unique indexes guarantee one
customer-company thread, one seller-company thread and one internal room per title.

**Surfaces.** VelShop Chat → **Shops** / **Velnox Support**; VelSeller Chat → **Customers** / **Velnox**;
VelCenter → **Chat** tab → **Customers** / **Sellers** / **Internal** (new `ChatManagement.tsx`).
Shop-chat CTAs exist on product, store and order pages. Support is a real `CUSTOMER_COMPANY` thread, not
a reserved shop: a legacy `velnox-support` thread is converted in place (messages preserved) on first
open, and remains readable by company chat before conversion.

**Authorization.** Customer = own `customer_id`; seller = own approved `seller_id`; company =
`users.role IN (owner, admin, staff)` AND only company types — a private `CUSTOMER_SELLER` row is refused
(404) unless it is the legacy support row. Sender identity is always the session; `assignedTo` must be an
active company member. Realtime is addressed (`sendToUser` / `sendToCenter`) on the existing shared
socket: `chat:message`, `chat:read`, plus `chat:conversation` for a new internal room.

**Also fixed (in scope):** `GET .../messages` returned raw `sender_id` / `created_at` while clients read
`senderId` / `createdAt`; `loadMessages` now maps through `mapMessage`, so reloaded threads keep own-side
alignment, timestamps and read ticks.

**Verified:** backend `tsc --noEmit` PASS · root typecheck 4/4 · `build:apps` 4/4 · i18n 1262/1262/1262 ·
new `chat-unified.test.ts` **13 pass / 0 fail** · existing chat suite **27 pass / 0 fail** · full backend
suite on disposable PG14 **1412 pass / 2 skip / 0 fail** (1414 tests, 71 files) · reconciler applied twice
with no error and no duplicate · `bash db/verify-reconciler.sh` **52/52 PASS** after re-measuring the
canonical object counts to `63|239|265|657` · `git diff --check` clean. The 2 skips are pre-existing R2-credential cases.

**Limitations (deliberate, documented):** read state is one `read_at` per message, not per staff member;
send idempotency is still the in-process `recentSends` map (durable UNIQUE column deferred); internal rooms
are visible to every company member (no membership table); company unread counts are messages; product
context is preserved but order context is not stored on a conversation. No browser/E2E run. Out of scope:
attachments, emoji/reactions, editing/deletion, typing indicators, tickets/SLA/CRM, Redis/broker, separate
chat service.

**Next:** durable chat idempotency (schema + unique index), per-staff read state if needed, internal room
membership, order-linked context, then the deferred browser E2E for the five golden flows.

---

## §89. Messenger UX — ticks, daily support ack, typing (2026-10-31) — COMPLETE

**Starting state:** `HEAD == origin/main` at `903fbeb`, clean tree. Committed on the owner's explicit
instruction after the local checks ran (see "Verified here").

Extends §88's core — no second engine, table, socket, polling loop or notification system.

**Schema (both canonical files, `db/schema.sql` + `db/run-sqleditor.sql`).** `chat_messages.sender_id`
became nullable (a system row has no human sender), the `sender_role` CHECK was widened to
`('customer','seller','company','system')`, and two columns were added: `system_kind TEXT`,
`ack_day DATE`. A partial UNIQUE index
`uq_chat_messages_support_daily_ack (conversation_id, ack_day) WHERE system_kind='support_daily_ack'`
makes "one per day" a DATABASE guarantee.

**Daily acknowledgment.** `createDailySupportAck()` runs only from the customer send handler for
`CUSTOMER_COMPANY` (and the legacy reserved-shop support shape). One statement:
`INSERT … ON CONFLICT (conversation_id, ack_day) WHERE system_kind='support_daily_ack' DO NOTHING
RETURNING *` — a concurrent request, a retry or another instance loses the race and returns no row. The
day is `(NOW() AT TIME ZONE 'Asia/Bangkok')::date`: calendar-day boundary, one authoritative clock,
restart-proof. The ack is a real `chat_messages` row (`sender_role='system'`, `sender_id NULL`), so both
sides read the same sentence; `sender_id <> $reader` being NULL keeps it out of unread counts and out of
mark-read.

**Ticks + realtime read state.** All three surfaces render `<Check/>` when `readAt == null` and
`<CheckCheck/>` once read. `chat:read` now carries `upTo` (the newest `created_at` the UPDATE actually
marked), so a client ticks exactly those messages and ignores its own receipt.

**Typing.** `chat:typing` ({conversationId, typing}) over the ONE existing socket. `lib/chat-access.ts`
resolves the audience from `conversations` (never from the frame); staff are refused on a private
`CUSTOMER_SELLER` thread; the sender never receives its own frame; nothing is stored. Client side:
shared `useChatTyping` (throttle 2.5 s, idle stop 3 s, receive expiry 6 s) + shared `TypingDots`
(CSS-only, `prefers-reduced-motion` aware). `chat:viewing` gained the same membership check.

**Canonical counts:** expected `63|240|265|659` (+1 index, +2 columns) — **derived, not measured**;
`db/verify-reconciler.sh` says so in its own note. Re-measure on a disposable PostgreSQL before trusting it.

**Tests added:** `backend/tests/chat-messenger-ux.test.ts` (structure group always runs; 8 behaviour cases
are DB-gated). `chat-unified.test.ts` had one assertion updated for the widened CHECK.

**Verified here (bun 1.4.4 + 329 deps installed on-device):** `bun run typecheck` **4/4 PASS** ·
backend `tsc --noEmit` **PASS** · `bun run build:apps` **4/4 PASS** · `bun run i18n:check`
**1264/1264/1264** · `git diff --check` clean · full suite `bun test backend/tests`
**1076 pass / 360 skip / 19 fail** of 1455 tests — the 19 are (a) the 11 pre-existing OAuth cases and
(b) 8 `test-database-isolation` subprocess probes that cannot run here because Termux reports
`process.execPath` as Android's `linker64`; both classes pre-date this pass and pass on CI.
The 360 skips are the DB-gated cases (no PostgreSQL: `initdb` hangs at its `max_connections` probe on
this device), so **the new behaviour suite SKIPPED locally** and is only exercised by CI.
`db/verify-reconciler.sh` could not run for the same reason.

**Known pre-existing red:** `main` run `41043341845` fails 11/1414, all in `oauth-route.test.ts`:
`/auth/google` redirects to the frontend error URL because `GOOGLE_CLIENT_ID`/`GOOGLE_REDIRECT_URI` are
empty when `routes/auth.ts` snapshots them at import (module-level env writes land after the first
module load). Production is unaffected (env is set there); it is a test-isolation defect from §87.

**Limitations:** read state is still one `read_at` per message, so a COMPANY_INTERNAL room shows ✓✓ on
the first staff read; the ack body is stored in English by design (both participants must see the same
words); no browser/E2E run.

---

**Note on this file's size:** the ~55 KB edit-tool ceiling is real. §69 was archived on 2026-10-26;
§76/§79 and §80/§81 on 2026-10-27; the 2026-10-04 payment-integrity narrative on 2026-10-27 with
§83; §82 on 2026-10-28 with §84; §78 + §83 on 2026-10-30 with §85; §84 + §85 on 2026-10-30 with §87; and
§86 + §87 on 2026-10-31 with §89
(all verbatim + index row). Before appending again, archive the next-longest closed block the same way.
Archiving is not deletion: the text is preserved verbatim.
