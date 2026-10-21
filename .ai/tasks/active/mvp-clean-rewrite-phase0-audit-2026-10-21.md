# PHASE 0 — AUDIT REPORT: Velnox Clean MVP Rewrite

**Date:** 2026-10-21
**Repository:** `EnJirad/velnox-marketplace`, branch `main`
**Git SHA audited:** `d653a37485e8438a0276dbe6b4b4c71d3d6d6e16` (local == `origin/main`, tree clean at audit start)
**Scope:** READ-ONLY audit. **No application code, schema, migration, route or test was changed.**
**Method:** every number below was produced by reading or searching this tree at this SHA. Where a claim could not be verified without a live browser, Stripe account, R2 bucket or production database, it is marked **NOT VERIFIED** instead of assumed.
**Baseline check this turn:** `bun run typecheck` → 4/4 exit 0. The last full-suite evidence is §81/§82 of `.ai/AI_HANDOFF.md` (2,147 pass / 16 skip / 0 fail on PostgreSQL 14). The suite was **not** re-run because no file changed.

> **STOP CONDITION.** This document is Phase 0 only. Phase 1 must not start until the owner answers §13. Nothing in §8 is deleted yet.

---

## 0. Executive summary

Velnox is **not an MVP today**. It is a mature commerce platform with an MVP-sized landing page:

| Measure | Current |
|---|---|
| TypeScript/TSX | **~127,100 lines** (backend 34,462 · tests 38,466 · apps 30,160 · shared 24,020) |
| Backend route modules | 22 · **≥165 statically declared `/api` paths** |
| Database | **77 tables**, 837 columns, 305 indexes (last verified fresh-DB count) |
| Schema surface | `db/schema.sql` 1,963 lines + `db/run-sqleditor.sql` 5,442 lines + **62 migration files** |
| Frontends | 4 Vite apps (velshop 17,193 · velseller 4,309 · velcenter 7,656 · velnox 1,002) |
| Tests | 75 files / 38,466 lines |
| Runtime extras | WebSocket server · 3 background workers · R2 presigning · Stripe + COD · 3 languages |

The requested MVP is **BUY + SELL + CONTROL**. The gap is not missing features — it is **accumulated surface**:

1. **Order truth is spread over four vocabularies** — legacy `orders.status` (12 values), `orders.order_state` (5), `orders.fulfillment_status` (9), payment fold (11). Three writers and a projection layer exist to keep them consistent (`backend/lib/order-state.ts`, 443 lines).
2. **Parked ≠ removed.** VelRepeat, Customer Memory and wholesale are flag-gated but still occupy **~9,000 backend lines, ~2,900 app lines, 15 tables, 22 test files**, boot-time DDL, route mounts and shared flags. `VELREPEAT_ENABLED=false` hides them; it does not remove them.
3. **Dead structure is mixed into the canonical schema.** 12 legacy/no-writer tables and 4 tables with zero references are indistinguishable from live tables in `db/schema.sql`.
4. **The canonical database has no reset path.** There is no reset script. `db:migrate` is a placeholder (`echo 'Run migrations via db/migrations/'`), the real updater is a 5,442-line reconciler, and `server.ts` performs DDL at boot for four legacy modules — the exact anti-pattern the rewrite must end.

**The good news:** the parts that are hard to get right are already right and should be preserved, not rewritten blindly:

- server-authoritative pricing and stock at checkout (client cannot supply price/total/seller);
- one guarded atomic stock reservation statement (`quantity - reserved >= $n`);
- durable checkout/payment idempotency (`checkout_requests`);
- Stripe webhook signature verification over the raw body + per-event claim + refund totals recomputed from `SUM(refunds)`;
- seller ownership scoping and the 2026-10-19 fix that gates product writes on `sellers.status = 'approved'`;
- the test-database guard that **fails closed** instead of falling back to production;
- httpOnly JWT cookie, server-side revocation, Origin guard, route-class rate limits;
- R2 presigned upload + confirm;
- the 3-language i18n and design system.

**Estimated deletion vs. construction:** the rewrite should remove roughly **45–55% of backend lines**, **15–18 tables**, **~120 of 165 endpoints**, **2 of 4 apps**, all 62 migrations, all 3 schedulers (then re-add at most 1), and the WebSocket layer. It should *keep* the money/stock/idempotency invariants rather than re-invent them.

**Blocking decisions:** 12 owner decisions in §13. The three that block Phase 2 are D1 (which database is reset), D3 (sets/packs) and D4 (multi-shop checkout).

---

## 1. CURRENT ARCHITECTURE

### 1.1 Runtime shape

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  velShop     │  │  velSeller   │  │  velCenter   │  │  velNox       │
│  :5173       │  │  :5174       │  │  :5175       │  │  :5176        │
│  customer    │  │  seller      │  │  admin/staff │  │  corporate    │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │  HTTPS + httpOnly cookie + WebSocket /ws            │
       └───────────────────┬─────────────────────────────────┘
                           ▼
                 ┌─────────────────────┐
                 │  Express 4 (tsx)    │   backend/server.ts (630 lines)
                 │  22 route modules   │   ≥165 /api paths
                 │  JWT · Origin guard │
                 │  rate limits        │
                 └──────┬───────┬──────┘
                        │       │
             ┌──────────▼─┐  ┌──▼─────────────┐
             │ Neon       │  │ Cloudflare R2  │
             │ PostgreSQL │  │ presigned PUT  │
             │ 77 tables  │  └────────────────┘
             └────────────┘
                        │
             ┌──────────▼─────────────────────┐
             │ Stripe Checkout + webhook      │
             │ (single source of payment truth)│
             └────────────────────────────────┘
```

- **One backend, one database.** Frontends never touch Neon; every business fact is read through the API.
- **Deployment:** Render (backend) + four Vercel projects (`apps/*/vercel.json`). Six GitHub workflows: test, production-db-migrate, production-db-verify, diag-neon-schema, diag-stripe-payment-trace, dependabot.
- **Realtime:** one `ws` server at `/ws`, cookie-authenticated at upgrade, channel allowlist, revocation sweep. Consumers are VelCenter queues, the audit tab and notification bells. **No business data travels over the socket** — events are signals and consumers refetch.
- **Workers:** `payment-reservation-scheduler` (live, 443 lines), `velrepeat-scheduler` (parked, 496), `velrepeat-v2-cycle-scheduler` (parked, 113). No queue, no Redis, no cron service beyond these in-process timers.
- **No AI, no recommendation engine, no analytics pipeline, no event bus, no microservices.** That is a genuine strength for the MVP target.

### 1.2 Repository scale (measured)

| Area | Files | Lines | Note |
|---|---:|---:|---|
| `backend/` non-test | 69 | 34,462 | routes 23,896 · lib 7,325 · server/jobs/realtime/db |
| `backend/tests` | 75 | 38,466 | 2,147 pass / 16 skip at last DB run |
| `apps/velshop` | 45 | 17,193 | 27 pages/routes, cart, checkout, VelRepeat |
| `apps/velseller` | 10 | 4,309 | 8 pages, no dedicated product page (inside `MyShop`) |
| `apps/velcenter` | 14 | 7,656 | one 2,509-line `Center.tsx` + 9 components |
| `apps/velnox` | 7 | 1,002 | corporate marketing only |
| `packages/shared` | 111 | 24,020 | UI kit, api client, i18n, 8 commerce libs |
| DB | 68 | 7,405 SQL | 62 migrations + canonical snapshot + reconciler |

### 1.3 API surface by prefix (static grep, unique paths)

| Prefix | Paths | MVP relevance |
|---|---:|---|
| `/api/seller/*` | 77 | products, orders, options, goals, income, reorder, VelRepeat, selling units, verification |
| `/api/admin/*` | 40 | center tabs, sellers, products, categories, staff, settings, store accounts, refund |
| `/api/customer/*` | 31 | cart, orders, addresses, profile, wishlist, notifications, chat, store account |
| `/api/velrepeat/*` | 20 | remove |
| `/api/products/*`, `/api/categories/*`, `/api/shops/*` | 12 | catalog |
| `/api/subscriptions/*` | 4 | remove |
| `/api/auth/*` | 4 | keep, simplify |
| `/api/stripe/*`, `/api/payments/*` | 5 | keep, simplify |
| `/api/upload/*` | 2 | keep, reduce |
| `/api/events/*`, `/api/memory/*` | 3 | remove |
| `/api/orders/*`, `/api/reviews/*`, `/api/health/*`, `/api/_diag/*` | 6 | keep order read · remove reviews/diag |
| **Total** | **≥165** | target ≈ 40–45 |

### 1.4 Dead / unused code found

| Finding | Evidence |
|---|---|
| **No mock/fake production data** | `grep -riE "mock|fake data|dummy data|hardcoded"` over `backend` (non-test) → **0**. This requirement is already satisfied. |
| **No TODO/FIXME/HACK** | 0 across `backend`, `apps`, `packages`. |
| **Unused dependency: `zod`** | declared in `backend/package.json`; **0 imports** in backend. |
| **Unused dependency: `framer-motion`** | declared in `apps/velshop/package.json`; **0 imports**. |
| **Large unused UI primitives** | `recharts` and `react-hook-form` are only imported by `packages/shared/src/components/ui/chart.tsx` and `form.tsx`, which are re-exported but never imported by a page. |
| **Misplaced dependency** | `leaflet` is declared at the repo root but only used by `apps/velshop/src/components/shop/MapPicker.tsx`. |
| **Boot-time DDL** | `server.ts` runs `ensureVariantTables`, `ensureCheckoutIdempotencyTable`, `ensureChatTables`, and conditionally `ensureVelRepeatV2Tables` at startup. Startup must never migrate. |
| **Deprecated `db/run-update.sql`** | correctly absent; do not recreate. |

---

## 2. CURRENT DATABASE

### 2.1 Authority and shape

- **Canonical files:** `db/schema.sql` (declared snapshot) and `db/run-sqleditor.sql` (rerunnable bootstrap/updater). They are supposed to stay structurally identical; a contract test pins them.
- **62 migrations** in `db/migrations/` (numbers 001–059 with four duplicated numbers and no 026). The chain is historical, not authoritative.
- **Live shape (last verified fresh bootstrap, handoff §81):** 77 tables · 837 columns · 305 indexes · 2 triggers. Money is `NUMERIC(12, 2)`; timestamps are `TIMESTAMPTZ`; `gen_random_uuid()`/`uuid_generate_v4()` are used consistently. **Those are good foundations and should survive the rewrite.**
- **Reset story:** none. There is no `db/reset*` script; `bun run db:migrate` is an `echo` placeholder; `db:smoke` and `db:consistency` are placeholders. A development reset today means dropping the database and running the 5,442-line reconciler.
- **Orphan risk:** the schema declares foreign keys inline, but **live FK validity was not checked this turn** (no database in this workspace). Do not assume "no orphans" from the file alone.

### 2.2 Table inventory — all 77 tables classified

Classification rule:
- **REQUIRED** — needed by the target MVP.
- **OPTIONAL** — can support the MVP but is not in the requested acceptance criteria; can be deferred or dropped without redesign.
- **LEGACY** — structure from an earlier design or a 056 "foundation" table with **no runtime writer/reader**; safe to delete in a clean schema.
- **UNUSED** — zero references in non-test code.
- **VELREPEAT / MEMORY / WHOLESALE / TRACKING** — the named non-MVP domains.

#### REQUIRED (25)

| Table | Why |
|---|---|
| `users` | identity, role, status |
| `auth_identities` | Google `sub` ↔ user |
| `revoked_tokens` | server-side session revocation |
| `addresses` | shipping address ownership + snapshot source |
| `sellers` | seller application/approval state |
| `shops` | storefront identity; products belong to a shop |
| `seller_verifications` | review evidence/decision history (could collapse into `sellers` — see D12) |
| `categories` | catalog tree (slug is the product FK) |
| `products` | core catalog |
| `product_images` | product media |
| `product_variants` | variant price/stock |
| `product_option_groups` | option model |
| `product_option_values` | option model |
| `product_variant_values` | option → variant mapping |
| `inventory` | non-variant stock + reserved |
| `carts` | one cart per user |
| `cart_items` | cart lines |
| `orders` | order header |
| `order_items` | immutable line snapshots |
| `payments` | payment attempt/session/result |
| `payment_events` | webhook idempotency claim |
| `checkout_requests` | checkout/payment request idempotency |
| `checkout_groups` | one charge for a multi-shop purchase (keep if D4 = keep) |
| `media` | R2 object registry |
| `audit_logs` | admin control trail |

#### OPTIONAL (20)

| Table | MVP verdict | Note |
|---|---|---|
| `shipments` | **KEEP (minimal)** | one row per order for carrier/tracking; needed for SHIPPED |
| `refunds` | defer | MVP can cancel before shipping; refunds are a later finance feature |
| `notifications` | defer | seller/admin order alerts; polling is enough |
| `product_variant_images` | defer | variant galleries |
| `option_value_images` | defer | option swatches |
| `product_attributes` | defer | extra specs; not required by acceptance |
| `platform_settings` | defer | admin settings |
| `customer_profiles` | defer | profile fallback only |
| `seller_settings` | defer | shop preferences |
| `moderation_records` | defer | replace with `audit_logs` if product approval is kept |
| `seller_review_history` | defer | replace with `audit_logs` |
| `payment_incidents` | defer | valuable but not MVP |
| `product_reviews` | **DROP** | not in acceptance criteria; adds ratings/counts |
| `customer_wishlist` | **DROP** | not in acceptance criteria |
| `conversations` | **DROP** | chat not in MVP |
| `chat_messages` | **DROP** | chat not in MVP |
| `seller_goals` | **DROP** | seller intelligence not in MVP |
| `employees` | **DROP if D7 = owner/admin only** | staff RBAC |
| `schema_migrations` | drop with the chain | see D10 |
| `product_selling_units` | **DROP if D3 = base product only** | sets/packs; 6 snapshot columns across cart/order |

#### LEGACY (12) — structure with no runtime writer

| Table | Evidence |
|---|---|
| `commissions` | 0 non-test references; no writer |
| `settlements` | only a comment/reference in `routes/stripe.ts`; no writer |
| `ledger_entries` | 0 non-test references; append-only trigger only |
| `outbox_events` | 0 non-test references; no drain worker |
| `inventory_movements` | 0 non-test references |
| `fulfillment_orders` | 0 non-test references |
| `shipment_items` | 0 non-test references |
| `order_returns` | 0 non-test references |
| `payment_attempts` | 0 non-test references (runtime uses `payments` + `payment_events`) |
| `reconciliation_runs` | 0 non-test references |
| `reconciliation_findings` | 0 non-test references |
| `product_verifications` | product verification removed 2026-09-13; V badge is seller-only |

#### UNUSED (4) — zero references anywhere outside schema/migrations

| Table | Note |
|---|---|
| `company_settings` | never read/written |
| `system_settings` | never read/written (`platform_settings` is the live one) |
| `departments` | never read/written |
| `seller_analytics` | never read/written |

#### VELREPEAT (12)

`subscriptions`, `vrepeat_packages`, `vrepeat_deliveries`,
`velrepeat_plans`, `velrepeat_items`, `velrepeat_runs`, `velrepeat_events`,
`velrepeat_packages`, `velrepeat_package_items`, `velrepeat_cycles`,
`velrepeat_pricing_snapshots`, `velrepeat_pricing_snapshot_items`.

Plus **columns**: `products.vrepeat_*` (9), `orders.velrepeat_run_id`,
`orders.velrepeat_cycle_id`, `payments.plan_id`, `carts`/`cart_items` repeat fields.

#### MEMORY (2)

`behavioral_events` (Customer Memory collector; `POST /api/events/track`, `/merge`, `/memory/insights`),
`customer_events` (created by VelRepeat migration 024; **0 references**).

#### WHOLESALE (1)

`store_accounts` (B2B application + VelCenter review queue). Also
`product_selling_units.is_wholesale` is a wholesale column, not a table.

#### TRACKING (1)

`tracking_events` — **not** behavioral tracking. It is the shipment scan/telemetry
table read by `backend/lib/order-read.ts:129` and `routes/seller-orders.ts:305`.
The name collides with the marketing meaning of "tracking"; it is order-tracking
data, and should be renamed or folded into `shipments` in the new schema.

**Totals: 25 + 20 + 12 + 4 + 12 + 2 + 1 + 1 = 77.** No table is unclassified.

### 2.3 Database defects to fix in the rewrite (not merely delete)

1. **Three order vocabularies + a legacy projection.** `orders.status` carries
   payment ∧ order ∧ fulfilment in 12 values; `order_state` (5) and
   `fulfillment_status` (9) were added by 056 and are now written by a 443-line
   projection module. The MVP needs **one** status axis.
2. **Dual stock authority.** Non-variant stock lives in `inventory`; variant stock
   lives in `product_variants.stock`. Both are reserved/committed through different
   statements. One table keyed by `(product_id, variant_id)` removes the fork.
3. **Sets/packs leak into the core.** `cart_items` and `order_items` each carry
   `selling_unit_id`, `selling_unit_pieces`, `selling_unit_name`; checkout
   multiplies quantity by pieces for stock. Removing them (D3) simplifies three
   layers at once.
4. **`orders.status` CHECK is the only database-enforced transition.** There is no
   DB constraint on allowed transitions; the machine is code-only.
5. **Dead structure is indistinguishable from live structure.** 056 added nine
   "production foundation" tables with no writer; they must not be copied forward.
6. **No reset script.** A clean rewrite must ship `db/reset-dev.sql` (or `.sh`) and
   one canonical schema — see D10.

---

## 3. CURRENT AUTH

### 3.1 What exists

| Piece | Implementation |
|---|---|
| Customer login | Google OAuth 2.0 code flow (`GET /auth/google`, `GET /auth/google/callback`) |
| Staff login | `POST /api/auth/member-login` with email + scrypt password (`backend/lib/password.ts`); only `owner`/`admin`/`staff` |
| Session | JWT (`{userId, email, jti}`), 7 days, `velnox_session` **httpOnly** cookie, `SameSite=None`, `Secure` in production |
| Revocation | `revoked_tokens` table + in-memory JTI cache; `requireAuth` checks both |
| Identity | `users.role` ∈ customer / seller / owner / admin / staff; seller ownership via `sellers.user_id` → `shops.seller_id`; admin via role + `employees.permissions` |
| Route guards | `requireAuth`, `optionalAuth`, `requireSeller`-style lookups per route, `CENTER_ROLES`, permission catalog (`orders.view`, `orders.manage`, `products.moderate`, `sellers.manage`, `users.manage`, `staff.manage`, `audit.view`, `settings.manage`) |
| Bootstrap | `POST /api/admin/claim-owner` with `BOOTSTRAP_OWNER_SECRET` |
| Frontends | each app has its own `AuthPage`; shared `auth-flow.ts`/`api-client.ts` |

### 3.2 Verified strengths

- httpOnly + server-side revocation; a valid JWT alone is not sufficient.
- Origin allowlist on state-changing methods (CSRF defense).
- Route-class rate limits (auth tight, money 10/min user-keyed, public reads 300/min).
- Deny-by-default permission resolution (missing row/malformed JSON/DB error → `[]`, never throw).
- Seller writes are now gated on `sellers.status = 'approved'` across the product modules (fixed 2026-10-19).

### 3.3 Weaknesses relevant to the rewrite

1. **OAuth `state` is not a nonce.** It is `base64url(JSON.stringify({returnTo}))`
   with no signature and no cookie comparison (`routes/auth.ts:432-445`). It is a
   return-path carrier, not CSRF protection. The rewrite should use a signed,
   single-use nonce (httpOnly cookie or HMAC) and validate `returnTo` as a
   same-origin path.
2. **`SameSite=None` on every deployment** requires `Secure`; in local HTTP the
   cookie is dropped or treated inconsistently. Not a production bug, but a
   friction point for the MVP test harness.
3. **Two login systems** (Google for customers, staff password for Center) and
   three `AuthPage` copies. The MVP needs one auth contract.
4. **Authorization is enforced per route by convention.** Five modules resolve the
   seller row themselves; only one shared helper would remove the class of bug
   fixed on 2026-10-19.
5. **No email verification, no password reset, no refresh token.** Fine for MVP,
   but if email/password login is added (D6) this becomes a requirement.

---

## 4. CURRENT ORDER FLOW

### 4.1 Happy path (as implemented)

```
CART (carts/cart_items)
  │  cart lines carry a price snapshot; checkout ignores it and re-reads products/variants
  ▼
POST /api/customer/checkout            backend/routes/cart.ts:779-1285
  │  • ownership-check the address, build a server-side snapshot
  │  • validate each line: product published, variant active, stock available
  │  • re-read the authoritative price (product/variant/selling unit)
  │  • group lines by shop
  │  • ONE transaction:
  │       checkout_requests claim (requestId)
  │       checkout_groups row (multi-shop parent)
  │       one ORDER per shop
  │       order_items snapshots
  │       inventory.reserved += base units (guarded UPDATE)
  │       payments row (pending)
  ▼
POST /api/stripe/checkout               backend/routes/stripe.ts:2077+
  │  • one Stripe Checkout Session per order OR per checkout group
  │  • amount derived from DB rows, never from the request
  │  • requestKey idempotency, active-session uniqueness indexes
  ▼
Stripe-hosted payment
  ▼
POST /api/payments/stripe/webhook        backend/routes/stripe.ts:2570+
  │  • raw-body signature verification
  │  • payment_events claim (one event id = one processing)
  │  • single-order or group settlement transaction:
  │       payment → paid, order → paid/confirmed, inventory commit
  │  • failures return 500 so Stripe retries; late money becomes a payment_incident
  ▼
ORDER (customer list/detail)             GET /api/customer/orders[/:id]
  ▼
PROCESSING → SHIPPED → DELIVERED         seller/admin transition routes
```

### 4.2 The state model today

| Axis | Storage | Vocabulary |
|---|---|---|
| Payment | `payments.status` (folded by `lib/payment-attempt.ts`) | unpaid, pending, requires_action, processing, authorized, paid, failed, cancelled, expired, partially_refunded, refunded |
| Order | `orders.order_state` | pending, confirmed, processing, completed, cancelled |
| Fulfilment | `orders.fulfillment_status` | unfulfilled, ready, picking, packing, ready_to_ship, shipped, delivered, failed, cancelled |
| Legacy projection | `orders.status` | pending, confirmed, packing, shipped, delivered, completed, cancelled, pending_payment, paid, payment_failed, refunded, expired |
| Fulfilment machine | code (`lib/order-fulfillment.ts:90`) | pending → confirmed → packing → shipped → delivered → completed; cancel from pending/confirmed |

**Why this matters:** the requested MVP has **one** order lifecycle. Today a
"delivered" order can be `fulfillment_status='delivered'`,
`order_state='completed'`, `payments.status='paid'`,
`orders.status='delivered'` — four rows/values that must agree. The projection
module exists solely to keep them from disagreeing.

### 4.3 Order-adjacent behavior that is real, not fake

- **Inventory reservation** is a guarded atomic UPDATE and is released by the
  payment-reservation expiry sweep (30-minute window, `payment_expires_at`).
- **Cancel** is customer-allowed only in `pending`/`confirmed`, with a settled
  payment guard before cancellation.
- **Shipments** are one-per-order (unique index) with carrier/tracking number.
- **Refunds** are operator-triggered, validated against the captured amount, and
  the local total is recomputed from provider refund rows.
- **Order numbers** are generated with a uniqueness retry loop
  (`lib/order-number.ts`, 125 lines).
- **Multi-shop:** one cart → N orders → one payment (checkout group). This is a
  genuine marketplace requirement, not incidental complexity.

### 4.4 What the rewrite must change

| Current | MVP target |
|---|---|
| 3 axes + 12-value legacy projection | **1 order status**: `pending_payment → paid → processing → shipped → delivered`, `cancelled` from allowed states |
| Payment state as a derived fold | `payments.status` only (pending/paid/failed/refunded) |
| `checkout_groups` + per-shop orders + group settlement | keep **only if D4 = keep multi-shop**; otherwise one order = one payment |
| Reservation expiry worker writing orders | either keep one sweep (recommended) or lazy expiry inside order read + webhook |
| 12 transition writers | one transition module with an explicit owner/rule table |

---

## 5. CURRENT PAYMENT FLOW

### 5.1 Provider and configuration

- **Stripe** (`stripe@22`), Checkout Sessions, THB, card + PromptPay by default.
- **COD** exists behind `COD_ENABLED` / `COD_CUSTOMER_SELECTABLE`; both default off.
- `backend/lib/payment-config.ts` (412 lines) is the single method/secret/mode authority.
- No Connect, no payout, no seller settlement writer (`commissions`/`settlements` are dead).

### 5.2 Flow and invariants

```
POST /api/stripe/checkout
  → assertPaymentMethodUsable(method)         (COD gate happens before any write)
  → ownership + payable-state read
  → idempotency: checkout_requests (user, scope, request key)
  → create/reuse one active Session            (partial unique indexes enforce one active per order/group)
  → persist provider session id + amount
Stripe → webhook
  → express.raw body, signature verified
  → payment_events INSERT ... ON CONFLICT DO NOTHING   (event claim)
  → settlement transaction: lock order(s), re-read amount, mark payment paid, commit stock,
    project order status; rollback on mismatch
  → already-settled duplicate = success (no double stock commit)
  → captured-but-unsettleable = payment_incident + 500 (operator action)
```

**Verified strengths to preserve:** signature over the raw body; one event claim;
server-derived amount; active-session uniqueness; stock commit exactly once;
refund totals recomputed, never incremented; operator refund bounds checked;
failure returns 500 so the provider retries.

### 5.3 Complexity that is beyond the MVP

- Checkout groups (one charge, N orders, N locks) — two settlement paths.
- Schema-lag tolerance (`selectOrderPaymentRow`, `readOrderPurchaseScope`,
  `to_jsonb(o)`) so the backend can run against a database missing 054/056 columns.
- `payment_incidents` (late money handling) and its VelCenter tab.
- Reservation expiry scheduler + policy JSON + urgency contracts.
- COD as a second rail with its own confirmation rules.
- VelRepeat plan payments sharing the same webhook.

None of these are fake or dead: they are real, tested behavior. They are simply
**not required for a buyable MVP** and each one doubles a branch in the money path.

---

## 6. CURRENT SELLER FLOW

```
POST /api/seller/apply
  → sellers row (status pending) + seller_verifications (status pending, evidence URLs)
  → verification evidence confirmation (R2 presign + confirm)
GET  /api/seller/status                → pending | approved | rejected | suspended
Admin PATCH /api/admin/sellers/:id/status
  → approve / reject / suspend; writes seller_verifications + seller_review_history + notification + audit
  → approval creates/uses the shop
POST /api/seller/products              → draft or pending_review (never published directly)
PATCH /api/seller/products/:id/status  → seller may submit for review / withdraw only
Admin  PATCH /api/admin/products/:id/moderation → publish / reject / suspend
GET  /api/seller/orders                → orders containing this seller's items
PATCH /api/seller/orders/:id/status    → fulfilment transitions
```

**Verified enforcement:**
- Product write handlers resolve the seller through `getSellerForUser`, which now
  filters `status = 'approved'`. Suspended/pending sellers get 403 even with a raw
  request (regression test `seller-access-authorization.test.ts`, 17 pass).
- Product ownership is checked by `shops.seller_id`/`products.shop_id`; the client
  never supplies a seller id.
- A seller cannot publish directly: creation resolves `published` → `pending_review`;
  only admin moderation writes `published`.
- Catalog visibility is `products.status='published'` **and** the seller's
  `verification_status='verified'` for the V filter.

**MVP gap:** the seller flow is complete but wrapped in a verification/evidence
system (960-line `verification.ts`, review history, reason codes, self-approval
guard). The requested MVP says "สมัคร Seller → เห็นสถานะ approval" — a simple
application + admin approve/reject is sufficient (D12).

**Missing in velseller UI:** there is no dedicated product-create/edit page; product
management is embedded in `MyShop.tsx` (1,133 lines). The rewrite should separate
`Products` and `ProductEditor` for clarity.

---

## 7. CURRENT ADMIN FLOW

### 7.1 Access model

- `owner` / `admin` open VelCenter and implicitly hold every permission.
- `staff` hold exactly `employees.permissions` from the catalog; deny-by-default.
- `owner`-only mutations: roles, staff, employee reset, settings writes.
- Every tab re-checks server-side; frontend hiding is UX only.

### 7.2 Surfaces (all real database reads/writes)

| Tab / area | Endpoints | What it does |
|---|---|---|
| Overview | `GET /api/admin/overview`, `/market-overview`, `/dashboard/counts` | revenue, order count, customers, approved sellers, products, low stock, goals |
| Orders | `GET /api/admin/orders`, `PATCH .../status`, `PATCH .../shipment` | monitor and transition any order |
| Sellers | `GET /api/admin/sellers`, `PATCH .../status`, `GET .../application`, `POST .../revoke` | approve/reject/suspend + evidence review |
| Products | `GET /api/admin/products/moderation`, `.../moderation-detail`, `PATCH .../moderation` | review queue, approve/reject/suspend |
| Payment incidents | `GET/PATCH /api/admin/payment-incidents` | late-money operations |
| Audit | `GET /api/admin/audit-logs` | actor/action/entity trail |
| Staff | employees CRUD, permissions, reset password | RBAC |
| Settings | platform settings, categories | configuration |
| Store accounts | wholesale queue (mounted only when `WHOLESALE_ENABLED`) | B2B |

### 7.3 What the MVP actually needs

Only four screens and six metrics:

- Sellers: list, application detail, approve/reject/suspend.
- Products: list, suspend/unpublish (and approve if D2 keeps moderation).
- Orders: list/detail, status/shipment.
- Overview: sellers, products, orders, revenue (sum of paid orders), pending sellers, pending orders.
- Plus audit log entries for those admin actions (cheap, high value for CONTROL).

**Not needed:** staff RBAC, departments, goals, payment incidents UI, store-account
queue, categories tree editor beyond a simple CRUD, settings UI beyond a small
key/value editor.

---

## 8. REMOVE — non-MVP surface (evidence-backed)

> Nothing in this section has been deleted. It is the Phase 1 work list, pending §13.

| # | Module | Evidence | Size | Tables / routes / tests |
|---|---|---|---:|---|
| R1 | **VelRepeat (V1 + V2)** | 6 route modules, 2 libs, 2 schedulers, `VELREPEAT_ENABLED` in 2 places, boot-time DDL, `/api/velrepeat*`, `/api/subscriptions`, `products.vrepeat_*`, `orders.velrepeat_*`, `payments.plan_id` | **6,720 backend lines** + 1,593 storefront lines | 12 tables · 20 endpoints · 22 test files |
| R2 | **Customer Memory** | `POST /api/events/track`, `/merge`, `GET /api/memory/insights`; `behavioral_events`; `useTracking` in 8 storefront files; `IdentityMerge` | ~280 shared lines + 3 endpoints | 2 tables (`behavioral_events`, `customer_events`) |
| R3 | **Wholesale / B2B** | `store_accounts` table, `/api/customer/store-account`, `/api/admin/store-accounts*`, `lib/store-accounts.ts`, `ShopStoreAccount.tsx`, `WHOLESALE_ENABLED` in 3 places, `is_wholesale` | 545 backend + 296 page + ~300 admin queue | 1 table · 4 endpoints · 14 skipped tests |
| R4 | **Selling units / sets / packs** *(if D3 = drop)* | `product_selling_units`, 6 snapshot columns across cart/order, `lib/selling-units.ts` 309, route 396, cart/checkout base-unit math | ~705 backend + UI/tests | 1 table · 4 endpoints |
| R5 | **Chat** | `routes/chat.ts` 698, `conversations`/`chat_messages`, `ShopChat` 576, `SellerChat` 418, WS channel | ~1,700 lines | 2 tables · 10 endpoints |
| R6 | **Reviews / wishlist** | `product_reviews`, `customer_wishlist`, routes inside `products.ts` and `cart.ts` | ~400 lines | 2 tables · 6 endpoints |
| R7 | **Seller intelligence** | `seller-intelligence.ts` 380, `seller_goals`, `seller_analytics`, `Income`/`Reorder`/`SellerGoals` pages, `lib/seller-stats.ts` | ~1,300 lines | 2 tables · 6 endpoints |
| R8 | **Staff / departments / settings** *(if D7 = owner/admin only)* | `employees`, `departments`, `company_settings`, `system_settings`, staff CRUD, permission catalog | ~500 lines | 4 tables · 8 endpoints |
| R9 | **WebSocket / realtime** | `ws` server, `/ws`, shared `chat-socket.ts`, `center-events.ts`, consumers in 3 admin components | ~300 lines + 1 dependency | 0 tables |
| R10 | **Corporate app** | `apps/velnox` 7 files / 1,002 lines, `vercel.json`, build script, CORS origin | 1,002 lines | 1 app |
| R11 | **Dead schema** | 12 LEGACY + 4 UNUSED tables (see §2.2), 056 foundation tables with no writer | — | 16 tables |
| R12 | **Legacy boot DDL** | `ensureVariantTables`, `ensureCheckoutIdempotencyTable`, `ensureChatTables`, `ensureVelRepeatV2Tables` | ~200 lines | — |
| R13 | **Migration chain** *(if D10 = reset)* | 62 files, 4 duplicate numbers, no 026, plus 5,442-line reconciler | 7,405 SQL lines | 62 files |
| R14 | **Unused deps** | `zod` (backend), `framer-motion` (velshop), `recharts`/`react-hook-form` (only unused shared primitives possible), root `leaflet` placement | — | 4+ packages |

**Approximate removal total:** ~10,000–12,000 backend lines (29–35%), ~3,000 app
lines, 15–18 tables, ~120 endpoints, 2,000+ test lines, 1 app, 1 dependency
(`ws`, if R9), 62 migrations. This is a **deletion-led rewrite**, not a greenfield
invention.

**Do not delete without a replacement:** the inventory reservation, checkout
idempotency, Stripe webhook claim/settlement and the seller-approval guard. They
are small, proven and directly required by the MVP.

---

## 9. KEEP — proven, simple, directly useful

| Keep | Why (evidence) |
|---|---|
| **Server-authoritative checkout** | price/stock/product/seller resolved from DB; client sends ids/quantities only; price change is detected and communicated |
| **Guarded stock reservation** | one atomic `UPDATE ... WHERE quantity - reserved >= $n`; no oversell race |
| **`checkout_requests` idempotency** | `UNIQUE(user_id, scope, request_key)` + stored response; duplicate submit returns the original purchase |
| **Stripe raw-body + signature + event claim** | forged webhooks refused; one event processed once; failures retried |
| **Refund total recomputation** | `SUM(refunds.amount)` prevents double-count on replay |
| **Seller approval gate** | `status='approved'` at the one lookup that every product write uses |
| **JWT httpOnly + revocation** | logout is server-enforced, not client-only |
| **Origin guard + rate limits** | real CSRF/abuse defense already wired |
| **Test DB fails closed** | refuses Neon-looking targets, no fallback |
| **R2 presigned upload** | file bytes never transit the API; confirm step prevents unowned objects |
| **`audit_logs` choke point** | one writer for actor/action/entity |
| **Order number generator** | unique, retry-safe |
| **i18n (th/en/my) + design system** | already enforced by `i18n:check`; rewriting copy is wasted effort |
| **`money.ts` / NUMERIC(12,2) / TIMESTAMPTZ** | correct money and time foundations |
| **`pagination.ts`** | bounded page sizes |
| **Seller order ownership scoping** | `order_items.shop_id` join, never a client-supplied seller id |

**Rule:** extract these into small modules with tests before deleting the old
routes. Do not copy the old files wholesale — the goal is the invariant, not the
implementation.

---

## 10. REWRITE — modules, responsibilities, target schema

### 10.1 Target applications (3)

| App | Pages (MVP) |
|---|---|
| **velShop** | Home/catalog, Search, Product detail, Cart, Checkout, Orders, Order detail, Auth, Addresses |
| **velSeller** | Apply/status, Products list, Product editor (create/edit/price/stock/images/variants), Orders, Order detail |
| **velCenter** | Login, Overview, Sellers, Products, Orders, (Audit) |
| **velNox** | **removed from MVP** (D9) |

Drop: VelRepeat pages, wishlist, chat, notifications, reviews, store account,
tracking page, cookie policy (optional legal page can stay static).

### 10.2 Target backend modules (~40–45 endpoints)

| Module | Endpoints |
|---|---|
| `auth` | Google start/callback, me, logout, (optional password login) |
| `catalog` | products list/search, product detail, categories, shops/:id |
| `cart` | get, add, update, remove |
| `orders` | checkout, list, detail, cancel |
| `payments` | methods, create session, webhook, status |
| `seller` | apply, status, products CRUD, status, stock, images, variants, orders, order status |
| `admin` | overview, sellers list/decision, products list/suspend, orders list/detail/status, audit |
| `uploads` | presign, confirm |
| `health` | health |

### 10.3 Target schema (19–20 tables)

```
users(id, email, name, avatar, role, status, password_hash?, created_at, updated_at)
auth_identities(id, user_id, provider, provider_id, email, created_at)
revoked_tokens(jti, expires_at)
addresses(id, user_id, label, recipient_name, phone, line1, line2,
          subdistrict, district, city, state, postal_code, country, is_default,
          created_at, updated_at)

seller_profiles(id, user_id UNIQUE, store_name, slug UNIQUE, description,
                logo_url, status pending|approved|rejected|suspended,
                rejection_reason, approved_at, approved_by, created_at, updated_at)

categories(id, parent_id?, name, slug UNIQUE, sort_order, is_active)
products(id, seller_id, category_id?, name, slug UNIQUE, description,
         price NUMERIC(12,2), status draft|published|suspended|archived,
         created_at, updated_at)
product_images(id, product_id, url, alt, sort_order)
product_variants(id, product_id, name, sku, price NUMERIC(12,2),
                 stock INTEGER, status active|inactive, sort_order)
product_option_groups / product_option_values / product_variant_values
inventory(product_id, variant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
          quantity, reserved, UNIQUE(product_id, variant_id))   -- zero uuid = base product

carts(id, user_id UNIQUE, created_at, updated_at)
cart_items(id, cart_id, product_id, variant_id?, quantity, price_snapshot,
           UNIQUE(cart_id, product_id, variant_id))

orders(id, user_id, seller_id, checkout_group_id?, order_number UNIQUE, status,
       subtotal, shipping_fee, total_amount, currency,
       shipping_address JSONB, paid_at, shipped_at, delivered_at,
       cancel_reason, created_at, updated_at)
order_items(id, order_id, product_id, variant_id?, product_name_snapshot,
            variant_name_snapshot, image_url_snapshot, quantity,
            unit_price, subtotal)

payments(id, order_id, provider, provider_session_id UNIQUE, provider_payment_id,
         amount, currency, status pending|paid|failed|refunded,
         paid_at, raw JSONB, created_at, updated_at)
payment_events(id, provider_event_id UNIQUE, type, processed_at, payload)

checkout_requests(user_id, scope, request_key, order_id, response, created_at,
                  UNIQUE(user_id, scope, request_key))
checkout_groups(id, user_id, total_amount, currency, item_count, shop_count, created_at)
shipments(id, order_id UNIQUE, carrier, tracking_number, shipped_at, delivered_at)
audit_logs(id, actor_id, action, entity_type, entity_id, metadata, created_at)
media(id, key, url, content_type, size, uploaded_by, created_at)
```

**Optional/deferred:** `notifications`, `refunds`, `platform_settings`,
`product_attributes`, variant/option images. **Do not recreate:** the 16 dead
tables, all VelRepeat tables, `behavioral_events`.

### 10.4 Target order state machine (one axis)

| From | To | Who | Rule |
|---|---|---|---|
| `pending_payment` | `paid` | payment webhook only | provider says paid; stock commits in the same transaction |
| `pending_payment` | `cancelled` | customer/admin/expiry | no captured payment |
| `paid` | `processing` | seller/admin | seller accepts |
| `paid` | `cancelled` | admin | requires refund |
| `processing` | `shipped` | seller | carrier/tracking number required (optional per D10) |
| `shipped` | `delivered` | seller/admin | — |
| `delivered` | terminal | — | — |
| `cancelled` | terminal | — | — |

No `packing`, `ready_to_ship`, `picking`, `confirmed`, `completed`,
`payment_failed`, `refunded` **order** states. A failed payment stays
`pending_payment` with `payments.status='failed'`; a refund is a payment fact,
not an order state (unless D5 adds refunds).

### 10.5 Payment flow target

```
create order (pending_payment) → create Stripe session (server-derived amount)
→ provider → webhook (raw body, signature) → claim event → transaction:
    payment = paid, order = paid, stock committed
→ frontend reads GET /api/orders/:id (never treats redirect as success)
```

Keep: idempotency key, active-session unique index, event claim, amount re-read,
500 on processing failure, refund recomputation if refunds stay.

---

## 11. PHASE PLAN (after owner decisions)

| Phase | Deliverable | Exit check | Stop? |
|---|---|---|---|
| **0 (this)** | Audit + decisions | this document reviewed | **YES — await §13** |
| **1 Clean base** | Delete R1–R14, remove flags/boot DDL/apps/deps; 3 apps build | `bun install`, typecheck 3/3, build 3/3, `git diff --check`; no `/api/velrepeat`, `/api/events`, `/api/store-account` strings remain | commit + report |
| **2 Database** | New canonical schema, `reset-dev` script, FK/index/constraint review | fresh reset twice → identical; FK orphan check = 0; NOT NULL/default/CHECK verified; no dead table | commit + report |
| **3 Core backend** | auth/users/seller/products/cart/checkout/orders/payments/addresses/uploads | route contract tests + real DB integration for price/stock/idempotency/webhook | commit + report |
| **4 velShop** | browse → product → cart → checkout → payment → order | real DB flow; browser E2E (or explicit limitation) | commit + report |
| **5 velSeller** | apply → approve → product → price/stock/images/variants → orders → status | suspended seller 403; approved seller creates and sees order | commit + report |
| **6 velCenter** | seller approval, product control, order monitor, 6 metrics | admin actions write audit rows; metrics from DB only | commit + report |
| **7 Verification** | Full real-flow matrix + acceptance checklist §21 | every box in §21 checked with evidence; no fake/mock; no dead route | final |

**Rules for every phase:** one commit per phase (not one giant commit), update
`.ai/AI_HANDOFF.md` with state + gaps, push via Git CLI, verify local == remote,
keep the working tree clean. Do not start Phase N+1 before Phase N's exit check
passes.

**Verification reality:** the current 2,147-test suite mostly tests the system
being removed. Do not treat "old tests pass" as MVP proof. New tests must cover
the money path (price authority, stock reservation, idempotency, webhook
signature/replay), authz (suspended seller, non-owner admin, address ownership),
and the admin transitions. Browser E2E and real Stripe TEST remain **NOT
VERIFIED** in this workspace and must be listed as limitations until run.

---

## 12. RISKS

| Risk | Impact | Mitigation |
|---|---|---|
| **Destructive production reset** | irreversible data loss | D1: build a new empty database/branch, keep the old one read-only until cutover; never `DROP` production on the first pass |
| **Rewriting proven payment logic** | double charge / lost money | extract the invariants from §9, test replay/forgery/late-webhook before deleting the old handler |
| **Removing sets/packs changes cart/order shape** | data/schema churn, UI rework | D3 decision first; if kept, keep the current base-unit math and do not "simplify" it halfway |
| **Multi-shop payment** | one charge, N orders is the hardest branch | D4; if kept, one settlement function with explicit tests; if dropped, document the UX regression |
| **Losing i18n parity** | broken storefront copy | keep `th` key shape as source; run `bun run i18n:check` each phase |
| **Old test suite gives false confidence** | regressions slip | new acceptance-driven tests; explicitly label unrun browser/Stripe checks |
| **Production schema is already behind** (handoff §82) | deploy fails on missing `order_state`/`product_selling_units` | the rewrite replaces this migration path; apply the new schema to a fresh DB and cut over, do not patch the old one |
| **Vercel/Render dashboard changes** | app still deployed after repo deletion | owner removes the velnox project + env vars; update CORS origins |
| **Google OAuth redirect URIs** | login fails after app removal | keep the exact callback URLs per app; add the new admin URL before cutover |

---

## 13. DECISIONS REQUIRED — STOP HERE

Answer these before Phase 1. Each has a recommendation; "impact" says what changes
if you choose otherwise.

| # | Decision | Options | Impact | Recommendation |
|---|---|---|---|---|
| **D1** | **Which database is reset?** | (a) new empty Neon branch/database, cut over; (b) wipe existing production; (c) migrate existing data | (a) safe, reversible; (b) irreversible, needs backup + maintenance window; (c) keeps history but drags legacy shape | **(a)** — build clean, keep old DB read-only until cutover. Never wipe production first. |
| **D2** | **Product approval** | (a) mandatory review (current); (b) instant publish for approved sellers, admin can suspend; (c) per-seller trust flag | (a) adds a queue + 6 statuses; (b) removes the moderation queue, faster seller flow; (c) middle ground | **(b)** for MVP: approved seller publishes, admin can unpublish/suspend. Revisit review when abuse appears. |
| **D3** | **Sets/packs (selling units)** | (a) drop, base product + variant + quantity; (b) keep sets/packs | (a) removes 1 table, 6 columns, 705 backend lines, base-unit math; (b) keeps a real retail feature but complicates stock/orders | **(a)** — the acceptance criteria only require product/variant/quantity. |
| **D4** | **Multi-shop checkout** | (a) keep one cart → N orders → one payment (`checkout_groups`); (b) one shop per checkout/order | (a) true marketplace UX, keeps 1 table + a settlement branch; (b) simpler money path, worse UX | **(a) keep** — but only one settlement function and a hard test matrix. If you want the absolute minimum, (b). |
| **D5** | **Payment methods** | (a) Stripe only (card + PromptPay); (b) Stripe + COD | (a) one rail, one state path; (b) COD needs "pay on delivery" confirmation rules | **(a)** — COD is already off by env; do not carry the branch. |
| **D6** | **Customer login** | (a) Google OAuth only; (b) Google + email/password | (a) no password/reset/verification surface; (b) more auth code and support burden | **(a)** for MVP; add email/password later if needed. |
| **D7** | **Admin model** | (a) owner/admin only; (b) keep staff + permission catalog | (a) drops `employees`/`departments`/RBAC; (b) keeps granular control but adds 4 tables + guards | **(a)** — two roles are enough for CONTROL. |
| **D8** | **Non-MVP shopper surfaces** | multi-select: reviews, wishlist, chat, notifications, seller goals/income | each adds tables/endpoints/UI and test surface | **Drop reviews, wishlist, chat, goals/income.** Keep notifications only if seller order alerts are required. |
| **D9** | **Corporate app `velnox`** | (a) delete app + build + deploy; (b) keep repo, remove from build only | (a) smallest repo; (b) keeps marketing source but still a stale deploy target | **(a)** delete from the MVP repo; marketing can live in a separate repo. |
| **D10** | **Schema authority** | (a) one `db/schema.sql` + `db/reset-dev.sql`, delete 62 migrations; (b) keep migrations + reconciler | (a) simple, reproducible, but changes `AGENTS.md` rule 4; (b) keeps history and the 5,442-line updater | **(a)** — with owner approval to amend the rule. |
| **D11** | **Languages** | (a) keep th/en/my; (b) Thai + English only | (a) existing parity check works; (b) less copy | **(a)** keep all three; it is already enforced and not the complexity. |
| **D12** | **Seller approval depth** | (a) simple application + admin approve/reject/suspend; (b) keep evidence upload + verification queue + review history | (a) removes 960-line verification route + 2 tables; (b) stronger trust/audit, more UI | **(a)** for MVP; keep the `sellers.status` state machine and audit log. |

**Also confirm:** no refunds in MVP (D5/a) — cancel-before-ship only? If refunds are
required, add `refunds` + one operator action and say so before Phase 3.

---

## 14. VERIFICATION OF THIS AUDIT

**Verified this turn**
- Repo identity: `d653a374…` == `origin/main`; tree clean.
- `bun run typecheck` → 4/4 exit 0.
- All file/line/table/route counts above (commands: `find`, `wc`, `grep`, schema parse).
- Table classification against non-test references; every one of the 77 tables assigned.
- Route inventory and prefix counts from static `app.get/post/...` declarations.
- Absence of mock/fake data and TODO/FIXME in production code.
- Auth cookie/revocation/OAuth state code; seller approval gate; Stripe signature/event claim; checkout transaction semantics — read directly.

**NOT verified / limitations**
- No live PostgreSQL in this workspace → FK orphan check, constraint behavior and
  full suite were not re-run this turn. The last full-suite result is recorded in
  `.ai/AI_HANDOFF.md` §81/§82 at `938dc01`/`d653a37` (2,147 pass / 16 skip / 0 fail).
- No browser E2E, no real Stripe TEST round trip, no R2 credentials, no production
  database access. Any claim about a real customer payment remains unproven.
- Route count is static; dynamically composed paths may add a few.
- The audit did not run a secret scanner or a live schema diff.

**No code was changed by Phase 0.** The only repository change is this report plus
a handoff pointer.

---

## Appendix A — route modules (22)

`admin.ts` · `auth.ts` · `cart.ts` · `center.ts` · `chat.ts` · `index.ts` ·
`product-options.ts` · `product-selling-units.ts` · `products.ts` ·
`seller-intelligence.ts` · `seller-orders.ts` · `seller.ts` · `store-accounts.ts` ·
`stripe.ts` · `upload.ts` · `velrepeat-packages.ts` · `velrepeat-plans.ts` ·
`velrepeat-v2-payments.ts` · `velrepeat-v2-plans.ts` · `velrepeat-v2-status.ts` ·
`velrepeat.ts` · `verification.ts`

## Appendix B — evidence commands

```bash
git rev-parse HEAD && git rev-parse origin/main
find backend -name '*.ts' -not -path '*/tests/*' | xargs wc -l
ls db/migrations | wc -l
grep -oE '^CREATE TABLE (IF NOT EXISTS )?[a-z_"]+' db/schema.sql
for t in $(cat /tmp/tables.txt); do grep -rlw "$t" backend apps packages | wc -l; done
grep -rniE "\bmock(ed)?\b|fake data|dummy data|hardcoded" backend --include='*.ts'
grep -rn "TODO\|FIXME\|HACK" backend apps packages
grep -rhoE 'app\.(get|post|put|patch|delete)\(\s*"[^"]+"' backend/routes backend/server.ts
```
