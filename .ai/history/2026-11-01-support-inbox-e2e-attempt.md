# VelCenter Support Inbox + E2E attempt (2026-11-01)

**Starting SHA:** `76133f12483348f369e54d4819641f79c3692312`
**Final code SHA:** `e5971cbcc5f619e65398820971ef929d27f34e3e` (this record is committed after it).

## What changed — a real Support Inbox in VelCenter

Before: VelCenter exposed three tabs — `ลูกค้า` (CUSTOMER_COMPANY + legacy reserved-shop rows),
`ผู้ขาย` (SELLER_COMPANY), `ภายใน` (COMPANY_INTERNAL). "Support" was implicit: it lived inside the
customer tab, so a support thread was indistinguishable from a normal customer conversation and seller
support was a separate tab.

Now:
- `GET /api/center/chat/conversations?type=support` merges the two EXISTING support queries
  (customer support incl. legacy reserved-shop rows, seller support), tags every row with
  `supportAudience: "customer" | "seller"`, sorts newest-first and caps at 200. No new table, no new
  message model, no new authorization — the same `requireCenterMember` gate and the same SQL.
- `GET /api/center/chat/unread` returns `support = customers + sellers`, so the inbox badge is derived
  from the two counts it represents and cannot drift.
- UI: a fourth tab `Support Inbox` (default), its own label per audience (`ลูกค้า` / `ผู้ขาย`) on each row,
  plus the retained per-audience tabs and the internal rooms tab. `tab` labels collapse to short text on
  phones so four tabs fit.
- Isolation is asserted, not assumed: a private customer↔seller thread must not appear in the support list.

## Verification (real evidence)

**CI — Production DB Verify #59 (`e5971cb`): all four jobs SUCCESS**
- `Validate schema and workflow contracts` ✅
- `Verify production schema and identity` ✅ (production DB: identity, schema fingerprint, critical objects)
- `Typecheck, build and database tests (disposable PostgreSQL)` ✅ — reconcile cases, full suite,
  typecheck, all four app builds, whitespace hygiene
- `Production database verdict` ✅

**Disposable-PostgreSQL suite in CI:** **1489 pass / 0 fail / 1491 tests** (19.6 s), including:
- `(pass) daily support acknowledgment … > Support Inbox merges customer + seller support and excludes commerce`
- `(pass) VelCenter has a real Support Inbox > the center exposes a combined support tab …`
- `(pass) VelCenter has a real Support Inbox > the API accepts the support tab and merges the two audiences`

**CI — Tests #232 (`e5971cb`): SUCCESS.** Local: `bun test backend/tests` → 8 failures, all the documented
Termux-only `test database guard` probes; `bun run typecheck` 4/4; `bun run build:apps` 4/4; diff clean.

## Browser / E2E — NOT RUN (unchanged blocker)

A real browser pass over VelShop, VelSeller and VelCenter could not be executed on this device:

1. **No session.** The only sign-in is Google OAuth; no test account credentials exist here, and the task
   forbids inventing them. Every app route redirects to `/auth` without a session.
2. **No disposable database.** PostgreSQL 18 is installed but `initdb` hangs at its `postgres --boot`
   probe in this Android sandbox (`postgres --describe-config` works, so the binary is intact). Without a
   DB there are no seeded users, no sockets and no upload path to drive.
3. **No R2 credentials.** They are backend-only; a real image upload from the UI therefore cannot be
   exercised here. The stored-object URL path was verified earlier by HTTP (`200 image/jpeg`).

Consequently the image matrix — Customer→Seller, Seller→Customer, Customer→VelCenter,
VelCenter→Customer, Seller→VelCenter, VelCenter→Seller — and the unread/read, bell and presence UI checks
are **NOT VERIFIED in a browser** in this session. The DB-gated suites do cover the server half
(per-conversation unread, company Model A read state, support isolation, WebSocket delivery/typing/read).

## Unchanged and re-confirmed by the suite

- Chat writes no `notifications` rows; the bell feed filters historical `type='chat'` rows (8 remain in
  production, untouched).
- Company read model stays **Model A** (one `read_at` per message ⇒ any authorized staff read marks the
  thread read for the company) — still asserted with two staff accounts.
- Per-conversation unread, latest-unread preview, and read clearing remain asserted.

## Remaining work

1. Browser matrix on a real deployment with real accounts (all three apps, text + image + viewer + unread +
   bell + support separation).
2. Real image upload E2E with R2 credentials in the environment.
3. Optional owner decision: per-staff company read state (would need a new table) and cleanup of the 8
   historical chat notification rows.
