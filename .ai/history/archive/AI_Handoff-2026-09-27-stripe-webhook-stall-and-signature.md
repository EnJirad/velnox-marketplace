# Handoff archive — Stripe webhook stall (§32) and signature boundary (§33)

Verbatim record of `.ai/AI_HANDOFF.md` §§32–33 as they stood on 2026-09-28, before they were
replaced by stubs to keep the live handoff inside this environment's ~55 KB file-edit window
(see `../README.md`). **Reference only — do not load automatically.** Neither section has
open work: the fixes are committed on `main` (`016c214` for §32, the §33 middleware/health
commit for §33) and their behaviour is re-proved by the suites named below.

---

## 32. Stripe webhook never answers in production — unbounded DB waits (2026-09-27)

**Reported.** A REAL signed event forwarded to `POST /api/payments/stripe/webhook`
(`velnox-api.onrender.com`) times out — *"context deadline exceeded (Client.Timeout exceeded
while awaiting headers)"* — while `GET /api/stripe/configured`, `/api/payments/methods` and the
DB read `/api/shops` all answer 200.

**Measured (read-only; `freebuff-env list` → `{}`).** The Stripe CLI aborts a forwarded
delivery after **30s** (stripe-cli#710). Production answers every pre-DB path fast (no/forged
signature → 400, chunked → 400, 300 KB body → 500, all ≤0.3s), so routing, the raw-body
branch and `constructEventAsync` are healthy. The stall is the only work between the
signature check and `res.json()`: the `payment_events` claim, `handleStripeEvent`, and the
payment/order writes.

**Root cause.** `backend/db/index.ts` bounded only ACQUIRING a connection
(`connectionTimeoutMillis`); node-postgres applies no per-query deadline, so a statement the
server never finishes (Neon compute scaled to zero, pooler restart, blocked row lock) left the
webhook pending until the CALLER gave up. Second cause: `pool.on("error")` called
`process.exit(-1)`, so a routine Neon idle-close restarted the service mid-request.

**Fix.** `query_timeout: 15000` (in-process; NOT `statement_timeout`/`lock_timeout`/
`idle_in_transaction_session_timeout` — startup parameters PgBouncer on Neon rejects). Pool
error handler logs safe fields and keeps the pool alive; the webhook logs secret-free stage
timings. No schema change, `db/` untouched, no payment state altered.

**Verified.** `webhook-resilience.test.ts` 10 pass/0 fail · backend suite 676 pass/91 skip/0
fail · backend `tsc` 0 · `typecheck` 4/4 · `build:apps` 4/4 · `i18n:check` 1331 · `diff
--check` clean. **NOT production-verified** (no credential/DB here). Owner: after redeploy,
`stripe trigger payment_intent.succeeded` via `stripe listen --forward-to …/api/payments/
stripe/webhook` must return 2xx with no timeout and log the stage lines; never copy the CLI
signing secret into `STRIPE_WEBHOOK_SECRET`.

**Open:** a `payment_events` row left `processing` is re-armed only on a `failed` retry (§31).
§30 is archived; §§28–§29 joined it on 2026-09-28 (§34).

---

## 33. Stripe webhook 400 "No signatures found matching the expected signature" — the boundary made self-identifying (2026-09-27)

**Reported.** `stripe listen --forward-to …/api/payments/stripe/webhook` → `[400]`, Render log
`[stripe webhook] signature verification failed: No signatures found matching the expected
signature for payload.` (A different symptom from §32's timeout — same route.)

**Proven in production by probe (executed, read-only):** no signature → 400, forged signature →
400 (routing + `constructEventAsync` alive), and — the decisive discriminator — a **150 KB
valid-JSON body on the webhook path answers 500** (body-parser `entity.too.large`, the *raw*
parser's 100 KB default) while the same body on another path answers 404 (the JSON parser's 1 MB
limit accepts it). So the deployed revision really does read this route's body with
`express.raw`: **verification sees the exact signed bytes.** The production `pk_test_…` and the
reported `pi_3UKKDBKp4iwMdWLy0TvMGUuZ` also share the token `Kp4iwMdWLy` (one test-mode account;
corroborating only).

**Root cause of the reported 400.** A `stripe listen --forward-to <production-url>` session signs
with its **own per-session secret**, which is a different secret *by design* from the Dashboard
endpoint's — so forwarding a CLI session into production **must** 400 unless production's
`STRIPE_WEBHOOK_SECRET` is that session's secret, which the rules forbid. The one cause that
would break **real** deliveries is a **value mismatch**: the variable is not `velpay`'s signing
secret (leftover CLI secret, a secret from a deleted/recreated endpoint or another account, or a
value pasted with wrapping quotes). `webhookConfigured: true` cannot distinguish them — it is
true for a value that verifies nothing — and Stripe's API cannot either: an endpoint's `secret`
is **returned only at creation** (`GET /v1/webhook_endpoints` never re-exposes it), so alignment
is a Dashboard read.

**Fix (code, minimal — no schema, no payment-logic, no auth/CORS change).**
- `backend/middleware/stripe-raw-body.ts` (new) — the raw-body gate as an exported, testable
  module: matches the path as Express routes it (case-insensitive, trailing slash) and does
  **not** gate on `Content-Type`. Mounted in `server.ts` before `express.json()`; the inline copy
  it replaces is gone (tests used to mirror that copy, so a `server.ts` regression could not fail).
- `backend/routes/stripe.ts` — a non-raw body is refused with **500 "Webhook body was not
  preserved for signature verification"** instead of the misleading 400, and the stages
  `webhook_received` (body kind + byte count only) → `signature verified` → `claimed —
  dispatching` → `processed` are logged with elapsed ms. Never a secret/signature/payload/cookie.
- `backend/lib/payment-config.ts` — `webhookSecretHealth()`: shape-only (`shapeUsable`, `whsec_`
  prefix, coarse length bucket, wrapping quotes, interior vs surrounding whitespace), returned by
  `GET /api/stripe/configured`. No character of the value is derivable from it.
- `GET /api/stripe/configured?selfTest=1` → `webhookSignatureSelfTest`, which signs a throwaway
  payload with the deployed secret and verifies it through the same SDK call the webhook uses:
  `verified: true` rules out the raw-body cause and any WebCrypto/runtime defect, `false` is a
  code defect. (Found on the way: `generateTestHeaderString` has the same sync/async trap as
  `constructEvent` — the async form is required.)

**Verified here.** new `stripe-webhook-raw-body.test.ts` **13 pass/0 fail** ·
`payment-foundation.test.ts` 67 pass/2 skip/0 fail (`buildApp` now uses the real middleware) ·
full backend suite **697 pass / 91 skip / 0 fail** (788 tests/37 files; was 676/91/767) · backend
`tsc` 0 · `typecheck` 4/4 · `build:apps` 4/4 · `i18n:check` 1331 · `git diff --check` clean.
Docs: `docs/ENVIRONMENT.md` + `.ai/context/payment.md` (the three causes, in the order to check
them); **`INSTALLATION.md` wrong host fixed** (`velnx-api` → `velnox-api`) — the §31 hazard.

**NOT verified here (owner-side: no Stripe credential, no Render env, no DB reach).** Proof chain
after the redeploy carrying this commit: (1) `GET /api/stripe/configured` contains
`webhookSecretHealth` ⇒ the host runs this revision; (2) `?selfTest=1` → `verified: true`;
(3) Dashboard → Developers → Webhooks → `velpay` → **resend a real delivery** → `2xx` + a
`signature verified`/`processed` line in Render's log; (4) the DB row changes. **Step (3) is the
only authoritative E2E — a CLI forward is not**, by definition.

**DB read verdict:** CI's only URL is quota-refused while production's own DB read serves — see
`.ai/context/payment.md`. Still no `payment_events`/`payments`/`orders` row reachable here.

**DB perf (that brief's §12) — investigated, no change made.** The `velrepeat_plans` due-query is
covered by the matching partial index `idx_velrepeat_plans_due (status, next_run_at) WHERE status
= 'active'` in **both** `db/schema.sql` and migration `034`, and it is the FIRST query of every
`startVelRepeatScheduler()` tick: interval **60 s** vs pool `idleTimeoutMillis: 30000`, so each
tick's first query pays a fresh TCP+TLS+Neon handshake (~1.2–1.5 s) over the ~0.2 s baseline. Not
a plan problem and **not** the webhook cause; an index/pool change needs a measurement that
separates connect time from execute time. **That measurement was made in §34 — the diagnosis
above was right about the handshake and was fixed there.**
