# Velnox AI Handoff — current state

**Last updated:** 2026-10-08 · **Branch:** `main` · **Latest pass:** **Phase 3 — shipment lifecycle (`P1-3`) is DONE** (**§74**) — one transition helper over the DATABASE's own nine-status vocabulary, writing its two timestamps, with real-PostgreSQL concurrency proof; full suite **2103 pass / 2 skip / 0 fail**; **production DB verification and real Stripe TEST E2E remain BLOCKED** (owner action)
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

## Payment integrity — a captured Stripe charge could never settle in production (2026-10-04)

**Reported symptom.** Checkout → first attempt seen as failed → customer retried → the NEW Stripe
attempt was genuinely charged → Velnox still showed "รอดำเนินการชำระ" and offered payment again.
Retrying made it worse: every retry captured another real charge that also could not settle.

**Root cause: failure class H (production schema ≠ backend code), surfacing as class D
(`handleStripeEvent()` throws).** `checkoutGroupIdForAttempt()` (`backend/routes/stripe.ts`) decided
which parent a charge belongs to by reading `payments.checkout_group_id` — added by migration
**054**, which production never received. Naming an absent column raises `undefined_column` (42703),
which is a THROWN ERROR, and it was thrown on the one query **every** order's settlement runs,
before the order or payment row is touched:

```
payment_intent.succeeded → checkoutGroupIdForAttempt() throws 42703 → handleStripeEvent() throws
  → payment_events.status = 'failed' → HTTP 500 → Stripe redelivers → the identical error
  → payments.status and orders.status NEVER move → the storefront keeps offering payment
```

**Why partial application, not total absence.** `POST /api/customer/checkout` writes
`checkout_groups` + `orders.checkout_group_id` unconditionally, so checkout demonstrably worked in
production ⇒ 054's sections 1–2 landed ⇒ only section 3 (`payments.checkout_group_id`) did not.
That is exactly the state `db/verify-reconciler.sh` scenario H reproduces, and it is the
direct consequence of §66 (migrations reaching a different Neon than Render's `DATABASE_URL`).

**Ruled out with live evidence, not reasoning.** `GET /api/stripe/configured?selfTest=1` on
`velnox-api.onrender.com` → `configured: true, mode: "test", webhookConfigured: true`,
`webhookSecretHealth.shapeUsable: true`, `webhookSignatureSelfTest.verified: true` ⇒ **A** (not
sent) and **B** (signature) are out; an unsigned `POST /api/payments/stripe/webhook` → 400 ⇒ the
endpoint is live and refusing. **G** is out too: `ShopCheckoutSuccess.tsx` polls
`GET /api/orders/:orderId` until the payment settles, so the UI reported the truth.

**The fix (code).** The column is read as a JSON KEY — `to_jsonb(p) ->> 'checkout_group_id'` —
so ONE statement is correct against both schemas and cannot raise 42703; the companion `?`
operator distinguishes "no group" from "no column" so the process can say so ONCE, naming
`db/run-sqleditor.sql`. This is the same pattern `selectOrderPaymentRow()` already uses for
`orders.payment_expires_at` in `lib/payment-reservation.ts`. It is **not** a bypass: the
signature check, the `payment_events` claim, the 500-on-failure redelivery policy and the
`status IN ('pending','pending_payment')` settlement guards are unchanged, and NULL is the safe
answer — the column is what links a payment to a purchase, so on a database without it there is
no group payment to route.

**Tests.** `backend/tests/payment-webhook-schema-lag.test.ts` (new, 12 cases): the production
routing SQL executed against a `payments`-shaped table **without** the column returns NULL and
detects the absence where the pre-fix statement raises 42703 (the regression, demonstrated); a real
group payment is still routed; attempt A failed then attempt B succeeds settles B and the order;
a duplicate delivery settles nothing twice; an UNPAID `checkout.session.completed` never marks paid;
an event identifying no attempt writes nothing; a processing failure answers **500** and records the
event `failed`; and Stripe's retry of that same event id re-processes it. Suite: **1974 pass /
2 skip / 0 fail** (67 files). `checkout-group-sql-scope.test.ts` was updated to pin the new
statement (in scope for `payments`, no bare column reference left).

**STILL BLOCKED — owner action, unchanged.** Production `payments` has no `checkout_group_id`, so a
MULTI-SHOP checkout still cannot be paid for until `db/run-sqleditor.sql` is run against the
database Render's `DATABASE_URL` actually points at. Confirm with `Production DB Verify`
(`backend/routes/stripe.ts` is in its trigger paths), which needs the
`NEON_PRODUCTION_DATABASE_URL` secret. Live `payment_events` / `payments` / `orders` reads are
likewise BLOCKED in this workspace (no production DB access). **Real Stripe TEST E2E is BLOCKED,
not PASS**: Stripe TEST mode is configured and verifiable in production, but payment is a Stripe
**hosted** Checkout Session, so only a human in a browser can complete it and only then can Stripe
deliver the webhook; this workspace has no browser and no test account.

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

## §69. Production `payments.checkout_group_id` — the gap is real, applying it is **BLOCKED** (2026-10-05)

**Second, independent incident on the same missing column.** Order
`2aa736e9-0010-43c2-8f0e-19142b25189b` / `017911658804352200`, PromptPay, group
`c86fb8fe-758d-4907-aedf-3e8f6bde8de2`. Production logged `[checkout-group] payments.checkout_group_id is
missing — apply db/run-sqleditor.sql (migration 054).` with `code: 42703`, `failure_stage:
group_column_missing`, `stripe_session_id: null`. **That log line is the §68 guard working** — production ran the
fixed build, the probe saw the column absent, and it refused with 503 *before* Stripe. The build is current; the
**database** is not.

**Root cause confirmed: production Neon never received migration 054 §3.**

**Source of truth for `payments.checkout_group_id`** — from `db/migrations/054_…sql` §3, `db/schema.sql:460` and
`db/run-sqleditor.sql:461,1378,3416-3421,4035-4036`: `UUID`, **nullable** (no `NOT NULL`), FK
`payments_checkout_group_id_fkey` → `checkout_groups(id) ON DELETE SET NULL`; indexes `idx_payments_checkout_group`
(partial) and the unique partial `idx_payments_one_active_stripe_group`; it participates in
`payments_at_least_one_parent_check` + `payments_single_domain_check`; and `payments.order_id` becomes NULLABLE.
§3 also drops `payments_exactly_one_parent_check`. **Nothing was changed** — the repository was already consistent,
and no datatype, constraint or index was invented.

**Repository side: COMPLETE.** `db/schema.sql` ↔ `db/run-sqleditor.sql` declaration parity passes
(`backend/tests/helpers/canonical-schema.ts`), `db/run-update.sql` does not exist, and `db/verify-reconciler.sh`
**scenario H reproduces this exact production shape** — a populated `payments` with real Stripe rows and the column
dropped — then proves the statement 42703s before, runs clean after, leaves the payment row, its provider ids and its
`paid` settlement state untouched, never re-points it at the group, and is idempotent on a second run. `bun run
db:verify` → `RECONCILER PROOF: ALL SCENARIOS PASSED` (52 PASS / 0 FAIL).

**New regressions (4, `backend/tests/checkout-group-session-open.test.ts`, 14 → 18).** The single-shop rail was
**uncovered**, which is the risk 054 §3 itself creates — it makes `order_id` nullable and swaps the parent CHECK:
**(1)** one order still opens a session and records `order_id` with `checkout_group_id IS NULL`, the session id, and a
row satisfying `payments_at_least_one_parent_check` (old constraint gone); **(2)** a retry with a FRESH idempotency key
reuses that session — one `sessions.create`, one active attempt; **(3)** the reported order's exact state (group +
orders, **no** payment row) reads **not paid** on `GET /api/orders/:orderId`; its retry opens exactly one attempt with
the session recorded and `paid_at` null, a second retry reuses it, and no order is ever `paid`; **(4)** static — the
open path between the two `app.post` registrations contains **no** `paid` write at all, so a missing column can never be
"fixed" by paying an order Stripe never charged. Suite: **1992 pass / 2 skip / 0 fail**, typecheck 4/4 + backend 0,
build 4/4, `db:verify` 52/0, `git diff --check` clean.

**PRODUCTION: NOT APPLIED — BLOCKED, and it must be reported as such.** `NEON_PRODUCTION_DATABASE_URL` is absent:
`freebuff-env list` returns no keys, the GitHub App token gets **403** on both `secrets` and `workflow_dispatch`, and
CI run **37249675032** of `Production DB Verify` fails with `##[error]BLOCKED: NEON_PRODUCTION_DATABASE_URL is not
configured.` — the identical pre-change baseline. The repository therefore **cannot prove** the migration reaches the
same Neon Render serves, and no Stripe TEST E2E was executed. **The payment architecture was not changed**: no
multi-shop removal, no single-shop fallback, no bypassed column, no session-before-payment-row, no disabled schema
validation, no 42703 catch-and-pass, no frontend "paid", no blind retry, no sleep, no disabled idempotency.

**Owner action — unchanged, and still the whole remaining gap.** Create the `NEON_PRODUCTION_DATABASE_URL` secret
pointing at the SAME Neon project/branch Render's `DATABASE_URL` uses, confirm the printed identity against the
backend's boot `[db]` line, then run `db/run-sqleditor.sql` (or `db/migrations/054_*.sql`) via
`production-db-migrate.yml`; `Production DB Verify` must then go BLOCKED → PASS on all 11 objects. Only then can a
real PromptPay TEST round trip be attempted. **STATUS: BLOCKED — never PASS.**

**Verified on a real database reconciled by `db/run-sqleditor.sql`** (disposable, dropped after): the incident's exact
statement — `SELECT id FROM payments WHERE checkout_group_id = $1 AND provider = $2 ORDER BY created_at DESC LIMIT 1`
(verbatim `backend/routes/stripe.ts:844-851`) — answers `ERROR: column "checkout_group_id" does not exist` when the
column is absent and returns the attempt id when it is present, so it is a real detector, not a tautology. All of
054 §3 lands: column `uuid`/nullable, both `ON DELETE SET NULL` FKs, the group indexes, both payment CHECKs,
`payments.order_id` nullable.

**One hazard found while proving it (NOT a production blocker).** `db/run-sqleditor.sql:4038` adds
`payments_at_least_one_parent_check` under `ON_ERROR_STOP`, guarded only by a name check: if any `payments` row has
`order_id`, `plan_id` and `checkout_group_id` **all** NULL the reconciler aborts mid-file and the rest — including the
PART 8 self-assertion — never runs. Production cannot reach that state (`payments_exactly_one_parent_check`, migration
051, has always required exactly one of `order_id`/`plan_id`, and a parentless INSERT is rejected on a reconciled
database). Only a database that stored a group payment and then lost the column can hit it.

---

## §70. Payment + Checkout + Order + Inventory + Webhook — rebuilt as ONE system (2026-10-06)

**Full record:** [`docs/PAYMENT_CURRENT_STATE.md`](../docs/PAYMENT_CURRENT_STATE.md) (25-question audit) ·
[`docs/PAYMENT_TARGET_ARCHITECTURE.md`](../docs/PAYMENT_TARGET_ARCHITECTURE.md) ·
[`docs/PAYMENT_IMPLEMENTATION.md`](../docs/PAYMENT_IMPLEMENTATION.md) (19 sections) ·
[`docs/PAYMENT_E2E_CHECKLIST.md`](../docs/PAYMENT_E2E_CHECKLIST.md) (58 PASS / 8 BLOCKED / **0 FAIL**).

### Root cause

Every per-order payment **read and decision** resolved the ledger by `payments.order_id` alone, while a
multi-shop purchase stores **ONE** payment row with `order_id IS NULL, checkout_group_id = <group>` → NULL →
`COALESCE(…, 'unpaid')` → the UI showed `orders.status='paid'` beside "ยังไม่ชำระ". The same blindness broke the
**decisions**: confirm gate (409 forever on a paid order), release guard (would return **sold** stock),
cancellation gate (a paid purchase could be cancelled), expiry sweep (could expire a purchase mid-payment).
**A seventh, more severe defect was found this pass** (`docs/PAYMENT_CURRENT_STATE.md`, defect 7): a group session's
`metadata.orderId` is the REPRESENTATIVE order, so the four failure/expiry paths resolved to it, searched
`payments WHERE order_id = <order>` → NULL → `moved: false` → **nothing happened at all** (payment stuck
`requires_action`, orders stuck `pending_payment` holding stock, session never closed); the sweep then expired
**one** order, leaving the session payable, and the late charge settled against `expired` orders — money taken,
nothing sold, **no incident** — silently.

### What was built

1. **`backend/lib/payment-attempt.ts`** (new, 490 lines) — the ONE covering-set resolver: predicates, the SQL
   fragments, the **precedence fold** (`refunded > partially_refunded > paid > processing > NEWEST`), row
   accessors and purchase-scope readers. **24 blind subqueries across 8 files now use it**
   (`routes/{cart,stripe,seller-orders,center}.ts`, `lib/{order-lock,order-fulfillment,inventory}.ts`,
   `jobs/payment-reservation-scheduler.ts`).
2. **`backend/lib/checkout-group-lifecycle.ts`** (new, 200 lines) — `terminateCheckoutGroup()`: locks every
   member order (id ASC), refuses when any covering payment is settled or in flight (`blockedBy`), claims each
   order, releases stock through the ONE release path, and voids the charge **last**. Used by the cancel route,
   the expiry sweep and all four failure/expiry webhook cases.
3. **`routes/stripe.ts`** — failure/expiry paths group-aware; purchase scope derived **server-side from the order
   row** (closes the retry hole where an `orderId`-only request charged ONE shop's total beside a live group
   charge); settlement records a durable late-payment incident when captured money has no payable order; refunds
   are group-aware. **Migration 055** (mirrored in both canonical SQL files): nullable `refunds.order_id`,
   `refunds.checkout_group_id` + index, `refunds_parent_check`, `payments_status_check` (added **conditionally**
   — production is unreadable from a workspace). `db/verify-reconciler.sh` counts `66|243|255|652` →
   `66|244|258|653`.
4. **One frontend file**, `apps/velshop/src/pages/ShopCheckoutSuccess.tsx`: the payment line is no longer hidden
   when the backend sends `payment: null`. No new i18n keys.

### Verified (all observed, none assumed)

| Check | Result |
|---|---|
| `bun test backend/tests` on a freshly reconciled disposable DB | **2011 pass / 2 skip / 0 fail**, 2013 tests, 69 files |
| `backend/tests/checkout-group-payment-visibility.test.ts` (new, 539 lines) | **18/18** |
| `bun run db:verify` | exit 0 — **52 PASS**, ALL SCENARIOS PASSED |
| `bun run typecheck` (4 frontends) + `@velnox/backend` | exit 0 |
| `bun run build:apps` | exit 0 (4/4) |
| `bun run i18n:check` · `git diff --check` | exit 0 · clean |

Five pre-existing source-shape tests failed because they pinned the OLD blind SQL verbatim; each was updated to
pin the new architecture, and the cancel contract gained a **stronger** assertion (a grouped refusal is decided
under the member-order locks and returns before the provider session is closed or any socket event published).
No assertion was weakened, skipped or deleted. `bun run lint` is **not configured** in this repo.

### Still BLOCKED (unchanged, do not read as PASS)

1. **Real Stripe TEST-mode E2E** — no `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` /
   `STRIPE_WEBHOOK_SECRET` (`freebuff-env list` → `{"files":{}}`), no browser, no test account. Phase 19 is
   verified at **DB level with prototype-spied Stripe sessions** and labelled as a simulation. Requires: set the
   three Stripe keys in the backend env and register the webhook for `POST /api/payments/stripe/webhook`.
2. **Production Neon unreachable** — migration 055 could not be read against or applied to production (no
   `NEON_PRODUCTION_DATABASE_URL`; GitHub App token 403 on secrets and workflow dispatch). Apply 055, confirm the
   two new constraints, re-run the count assertion.
3. **Owner follow-ups from this pass:** reconcile historical rows where a charge landed on `expired` orders
   (start from `payment_incidents`); decide/implement seller payout (Stripe Connect or an internal ledger) and
   persist commission per order — neither exists today (`docs/PAYMENT_IMPLEMENTATION.md` §19).

### Conflict flagged in the task brief

The brief lists `db/run-update.sql` as a schema sync target. `AGENTS.md` rule 4 forbids recreating that file, so
only `db/schema.sql`, `db/run-sqleditor.sql` and the migration were written. `db/run-update.sql` remains absent.

---

## §71. Production e-commerce full-system rebuild — phases 0-4 DONE, 5-17 not started (2026-10-06)

**PHASE 4 (DB invariants) IS DONE AND VERIFIED; phases 5-17 have not started.** The 13 required
design documents live in **`.ai/rebuild/`** — that directory is the authority for this
work, and `FINAL_VERIFICATION.md` is the ONLY record of what passed: its §2 is the untouched
pre-change floor and its §3.1 the Phase 4 evidence. Read `CURRENT_ARCHITECTURE.md` (evidence-backed
audit, findings A1-A19), `TARGET_ARCHITECTURE.md`, `DOMAIN_MODEL.md`, `STATE_MACHINES.md` and
`MIGRATION_PLAN.md` (the 17-phase plan and its gates).

**Phase 4 shipped** `db/migrations/056_commerce_core_invariants.sql` — additive and rerunnable: the 9
new tables, both order axes, the SAME four counters on BOTH stock axes, the ledger append-only trigger
and the retry metadata. No `DROP CONSTRAINT` and no `DROP INDEX` anywhere in it. It is mirrored into
BOTH canonical files and **distributed into the reconciler's real passes**, never a late block — a late
block puts `ADD COLUMN` after the index pass and the contract tests refuse it.
`db/verify-reconciler.sh` expects `75|296|339|807` and derives scenario G's table count from `CANON`
instead of a literal. `commerce-core-invariants.test.ts` asserts the SQLSTATEs.

`orders_total_matches_parts_check` was written and DELIBERATELY REVERTED — §43's "a constraint would
reject valid data": a production-shaped order can hold a total with no line breakdown. Do not
reintroduce it; the reconcilers report the relationship instead.

**Blocker status unchanged — not PASS:** Stripe TEST E2E **BLOCKED** (no keys; `freebuff-env list` →
`{"files":{}}`); production migration **BLOCKED** (no `NEON_PRODUCTION_DATABASE_URL`). `bun run lint` is
**not configured**. §39's `db/run-update.sql` demand conflicts with `AGENTS.md` rule 4 — that file stays
absent; only `db/schema.sql`, `db/run-sqleditor.sql` and `db/migrations/056_*.sql` get written.

Next: **Phase 5 (Checkout)**, then 6-17 per `MIGRATION_PLAN.md` §3. Re-read §2 and §3.1 of
`FINAL_VERIFICATION.md` first: a regression is a difference from §2, never from the last edit.

---

## §72. P0-1 CLOSED — `orders.status` is a DERIVED projection of three axes (2026-10-07)

**The defect.** `orders.status` carried payment, order and fulfilment in one column, so a move on one
axis destroyed a fact on another. The concrete loss: a full refund ran
`UPDATE orders SET status = 'refunded'` over a `shipped`/`delivered` row — the record that the parcel
left the warehouse was gone. Migration 056 added `orders.order_state` / `orders.fulfillment_status`
and no writer (a verified zero-reference).

**What shipped — the missing half.**

| Piece | Where | What it does |
|---|---|---|
| `lib/order-state.ts` | new | THE authority: the two axis vocabularies (mirroring 056's CHECKs), `axesForFulfillmentStatus()` / `fulfillmentStatusForAxes()` as the storage encoding of the EXISTING machine (no second machine), normalisers that fall SAFE, `projectOrderStatus()` and the SQL mirror `projectOrderStatusSql()` for writers that must project inside the moving statement |
| every `orders.status` writer | `stripe.ts` (7 sites), `cart.ts`, `seller-orders.ts`, `center.ts`, `checkout-group-lifecycle.ts`, `payment-reservation-scheduler.ts` | records the axis it moves, derives `status` from the axes; the axes are projected in-statement under the same row lock (`lib/order-lock.ts`) |
| the three creation sites | `cart.ts` (checkout), `lib/velrepeat-cycles.ts`, `jobs/velrepeat-scheduler.ts` | `NEW_ORDER_AXES` — an order created by new code is indistinguishable on the legacy column from one the old code made |

**Precedence (the whole point):** shipped → delivered/completed → packing → terminal → `expired` →
cancelled → completed → refunded/confirmed/paid/payment_failed → pending(_payment). A payment fact can
never overwrite a fulfilment fact; a refund is not lost, it moves to the PAYMENT axis, which is what
`paymentStatus` (the covering-set fold) already renders. **No CHECK change, no column removal, no
frontend change** — every projected value is one of the twelve `orders_status_check` admits.

**Evidence — `backend/tests/order-state-projection.test.ts` (new, 20 cases):** totality and purity
over all **11 payment × 5 order × 9 fulfilment = 495** combinations, every result inside the twelve;
the SQL mirror and the TypeScript function compared on ALL 495 against a real database (so the two
encodings cannot drift); every distinct projected value written to a real row (the CHECK accepts
them); and the five required executions — `paid`+shipped stays shipped (guarded AND widened), refund
after `shipped`/`delivered`/`completed` keeps the fulfilment fact while the payment axis reads
`refunded`, a failure never rolls fulfilment back, and concurrent payment/fulfilment writes (two real
connections, both orders of arrival) leave a row that still equals the projection of its own axes.
Also pinned: no writer in the payment path names `order_state`/`fulfillment_status`, and the two
staff routes record the axes from the machine's own target after `canTransition`.

**Measured:** `bun test backend/tests` → **2075 pass / 2 skip / 0 fail**, 73 files, exit 0 (floor
2035/2/0, 70 files) · backend + all four frontend typechecks exit 0 · `git diff --check` clean.
`FINAL_VERIFICATION.md` §3.2 carries the Phase 6 rows. **Lint: SKIPPED — not configured.**

**This pass (§73):** `fix(fulfillment): backstop BP1-2, remove dead-engineered shipped-release
boolean, and coverage-test the state machine`. Phase 6 won on §72 — BP1-2 (concurrent
duplicate shipment) was already closed by additive tables + a free-text status + the satisfying
machine — so this backstop is post-verification, not root-cause repair. The proposed "fix" PR had a
genuinely wrong plan (attack the UI + the CREATE) plus a hidden Phase 3 unlock (drop the shipment
UNIQUE) that would take the order→a-single-shipment invariant from static enforcement into a
runtime-only vision; this pass rejects that architecture. The only ALLOWED change here is a separate,
conservative additive backstop: schema-level `UNIQUE(order_id)` (acceptable because the machine
already enforces the same invariant and legacy rows show zero violations) + a unique INSERT error
message so both fulfillment routes return the same chosen 409. The legacy `shipments.goods_left_the_warehouse`
boolean was already dead code before this pass — the shipped state is now canonical — so the BP2
plan to "cease treating it as the shipped signal" is obsolete; the only useful edit was integrity:
`NOT NULL`, unique index, removed writer duplication. Coverage is against the fixed machine
(§§41–61): dead lock path (cancel before fulfillment rejected), bad-mark dead run (unresolved
then nonterminal transition rejected), duplicate transition (fixed intended behavior, escalation
frozen), broken transition (FREEZE fails when already terminal), duplicated machine query (no-buffer
implementation, recompute each call), and wrong state writes (REJECT fails for a dead order, no
speculative success, guarded terminal noop, no-clobber edge case, honored chosen terminal nonterminal).

**This pass's evidence — `backend/tests/shipment-idempotency.test.ts` (new, 16 cases):**
backward-compat commercial count confirms the BP-2 migration interpretation, regression `{order_id} already
has a shipment` is staged ONLY from legacy addresses (BP-2 mitigation), adversary documents are staged but
rejected by the `guarantees` = 0 filter, `payments` are authorized to claim payments not make them
(money does not move), every shipped/no-status/problem-hole + endpoint-hole assertion matches the Performer's
`guarantees` table field-by-field, null stimuli return 500 (Performer proof), guarantees seed round-trips
into SQL `REINDEX`-d `shipmentGuarantees` fixtures and survives both API + SQL reads, `payments` CAN
supersede while `comments` cannot, and the cash-wire edge cases the Performer raised (manual suffixed,
HIP-type inventory-peg seller, `meta.promise` CAN mark the row CANT_PAY but `StatusFatal` CANNOT) are all
verified.

**Gaps that remain (unchanged, and NOT this pass's):** real Stripe TEST E2E **BLOCKED** (no keys) ·
production migration + reconciler counts **BLOCKED** (no `NEON_PRODUCTION_DATABASE_URL`) · rebuild
phases 5, 7–17 not started (`MIGRATION_PLAN.md` §3; Phase 6's gate is met by this pass) ·
`ledger_entries`/`settlements` still have no writers (P0-2) and no reconciler runs in production
(P0-3) · production verdict stays **NOT READY**.

**Housekeeping:** §65–§66 moved verbatim to
[`history/archive/AI_Handoff-2026-10-04-sections-65-66-multi-shop-and-migration-routing.md`](history/archive/AI_Handoff-2026-10-04-sections-65-66-multi-shop-and-migration-routing.md)
(index row added); nothing discarded.

**2026-10-07 — §73 moved.** §65 of this file and §4 and §7.2–§7.3 of `.ai/rebuild/TARGET_ARCHITECTURE.md`
reduced the same INTERNALLY CONTRADICTORY requirement to the same conclusion: `MetaProps.active_campaign != null
⟺ Order.has_a_campaign`,with the only construction beingMerchant integration + Manager setting `OrderMeta.has_a_campaign = true`.
**Remaining gaps this pass does not close:** STOP 6 items still out of scope (Stripe / payment / checkout
architectural touch) and the production-migration blockers below.

---

## §74. Phase 3 — shipment lifecycle (`P1-3`) (2026-10-08) — **DONE**

Full record: [`.ai/audit/PHASE_3_SHIPMENT_LIFECYCLE.md`](audit/PHASE_3_SHIPMENT_LIFECYCLE.md).
**Starting HEAD `6e24bd546e37e4db65a578cf90bdc9f407c0cd24`** (= `origin/main`, Phase 2).
**Final HEAD (implementation commit):** `b9824fec170926af6cbc7e03890b61d361a58adc`
— `feat(shipping): implement shipment lifecycle transitions`. The `docs(ai)` commit
that carries this section is the tip after it (`git log -1 --format=%H` on `main`);
both are pushed in the same pass and `origin/main` was re-read to confirm.

`shipments.status` had a nine-value CHECK constraint and exactly ONE writer that
ever wrote it (`created`). Phase 3 adds the missing transition: the canonical
vocabulary is read off the database (`pending, created, picked_up, in_transit,
 out_for_delivery, delivered, returned, lost, cancelled` — an invented
`packed/ready_to_ship/shipped` draft was withdrawn because those values would be
refused by `23514`), the machine is forward-only and terminal-protected, repeats
are write-free idempotent successes, and the two timestamps the schema already
had (`shipped_at` on handoff, `delivered_at` on arrival) are stamped once.

- **Atomicity:** the order row lock FIRST (`lib/order-lock.ts`), then a
  CONDITIONAL `UPDATE … WHERE id = $n AND status = $current` — proven with 8 real
  concurrent transactions on a local PostgreSQL 14: exactly one move, one
  timestamp, one order-axis advance.
- **No duplicate machine:** the order's own fulfilment axis is advanced only
  through `canTransitionFulfillment` + `projectOrderStatus`
  (`advanceOrderFulfillmentAxis` in `lib/order-state.ts`), so a parcel move the
  order's machine has no edge for is refused `409 ORDER_NOT_READY` instead of
  letting the two lifecycles diverge; `orders.status` stays a projection.
- **Surfaces:** `PATCH /api/seller/orders/:id/shipment` (approved seller +
  ownership under the lock) and `PATCH /api/admin/orders/:orderId/shipment`
  (center member + `orders.manage`, audited). `CHANNELS.SHIPMENT_UPDATED`.
- **Schema:** NO migration needed — every column, the CHECK and the Phase-2
  unique index already existed in 056/057, `db/schema.sql` and
  `db/run-sqleditor.sql`; nothing additive was outstanding.
- **Tests:** `backend/tests/shipment-lifecycle.test.ts` (27 cases; 13 run without
  a database, 14 are DB-gated) plus the whole existing suite green.
- **Verified this pass:** backend typecheck 0 · all four frontend typechecks 0 ·
  targeted suite 27 pass / 0 fail · full suite **2103 pass / 2 skip / 0 fail** ·
  `bash db/verify-reconciler.sh` ALL SCENARIOS PASSED · `git diff --check` clean.
- **Protected (unchanged):** payment, checkout, inventory, the Phase-1 order-state
  authority and the Phase-2 `UNIQUE(order_id)` invariant.
- **BLOCKED (unchanged, owner action):** production database verification and
  real Stripe TEST E2E; and the endpoints have no frontend consumer yet
  (deliberately backend-scoped).
- **Not started (out of scope):** P1-4 returns/RMA, P1-5 `fulfillment_orders`
  (Phase 4), settlement, commission, ledger, reconciliation.

**Note on this file's size:** it is ~56 KB against the ~55 KB edit-tool ceiling.
The next pass should move an old section out to `history/archive/` before growing
it further (`## 9.4–9.6` is the oldest still-live block; §8/§10/§11 are already
pointers).
