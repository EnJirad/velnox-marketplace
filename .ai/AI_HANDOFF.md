# Velnox AI Handoff — current state

**Last updated:** 2026-10-30 · **Branch:** `main` · **Latest pass:** **Phase 2G — Production Readiness Audit** (**§86**, COMPLETE, AUDIT ONLY) — 0 Critical / 1 High / 12 Medium / 8 Low / 7 Info. The only High is OAuth `state` being user-controlled data rather than a CSRF nonce (login CSRF). **Production DB Verify remains BLOCKED** (missing canonical `NEON_PRODUCTION_DATABASE_URL`); **browser/E2E NOT RUN** (no tooling/preview; deployed frontends DNS-unreachable). All existing automated checks green (**1359 pass / 6 skip / 0 fail**). No source, SQL, env, dependency or CI change.
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

---

## §85. Phase 2F — CI Checkout/Payment Test Reliability (2026-10-30) — COMPLETE

**Base SHA:** `31456976c017f9dd85f5cb04ab383b852b6d1cf9` (local was 8 behind; fast-forwarded first,
clean tree). **Code commit:** `fe7927b6fee4a7028244b1eead79f2502e01ba2b` (3 test files, +232/−4).
**Report:** [`.ai/history/2026-10-28-phase-2f-ci-payment-test-reliability.md`](./history/2026-10-28-phase-2f-ci-payment-test-reliability.md).

**The 11 red CI tests were NOT a product defect and NOT a missing CI secret.** The six
`buy-now-checkout` and five `realtime-commerce-phase2c` DB cases send `paymentMethod: "CARD"`; their
`beforeAll` set a dummy `sk_test_…` key but **deleted `STRIPE_WEBHOOK_SECRET`**, while
`stripeStatus()` requires a configured webhook secret for a usable rail. The payment gate therefore
answered **503 `STRIPE_WEBHOOK_NOT_CONFIGURED` before any stock/idempotency/realtime code ran** — in
every environment, CI included. The tests configure the rail themselves; they configured half of it.

**Fix (tests only).** Both suites now install the complete DUMMY test-mode rail already used by
`checkout-payment-flow` (`STRIPE_MODE=test`, `sk_test_0000…`, `whsec_0000…`), saved/restored around
the block. No assertion weakened, no case skipped, and no product, Stripe, pricing, reservation or
auth code touched. New `backend/tests/checkout-test-payment-rail.test.ts` (10 cases) pins: the
fixture is usable/test-mode; a live key, a missing webhook secret, or no configuration is still
refused; the checkout handler makes no Stripe API call; the CI workflow references no secret and no
`STRIPE_*`/`COD_ENABLED`, keeps `TEST_DATABASE_URL`, and still pins the production-database refusal.

**Verified.** Pre-fix local disposable PG14: `31 pass / 11 fail` (both suites). Post-fix: **42/0**.
Full `bun test tests` (disposable PG14): **1359 pass / 6 skip / 0 fail** (1365 tests, 67 files).
GitHub Actions on `fe7927b`: **run `40986922370` — success, 1363 pass / 2 skip / 0 fail**; all 11
previously failing cases are `(pass)`, zero `(fail)` lines. `bun run typecheck` 4/4 · backend
typecheck · `build:apps` 4/4 · `i18n:check` 1257/1257/1257 · `git diff --check` clean.
**BROWSER/E2E: NOT RUN** (no tooling; test-configuration-only change).

**Boundaries:** production DB **not connected** (only an explicit local `TEST_DATABASE_URL`),
production payment **not touched**, schema/SQL **unchanged**, Stripe logic **unchanged**, COD default
**unchanged**, VelRepeat **unchanged**. No owner approval or secret is needed.

---

## §86. Phase 2G — Production Readiness Audit (2026-10-30) — COMPLETE (AUDIT ONLY)

**Audited SHA:** `9c38ae35019d1a4b4ace7127327e85db22bb30cf` (`HEAD == origin/main`, clean tree at start
and end). **Report:**
[`.ai/history/2026-10-30-phase-2g-production-readiness-audit.md`](./history/2026-10-30-phase-2g-production-readiness-audit.md).
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

---

**Note on this file's size:** the ~55 KB edit-tool ceiling is real. §69 was archived on 2026-10-26;
§76/§79 and §80/§81 on 2026-10-27; the 2026-10-04 payment-integrity narrative on 2026-10-27 with
§83; §82 on 2026-10-28 with §84; and §78 + §83 on 2026-10-30 with §85 (all verbatim + index row).
Before appending again, archive the next-longest closed block the same way. Archiving is not
deletion: the text is preserved verbatim.
