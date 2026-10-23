# VelRepeat V2 — Stripe TEST Runtime Configuration Verification (2026-10-03)

**Verdict: the Stripe **TEST** configuration is LIVE and correct on the Render backend that actually
serves the API.** `STRIPE_NOT_CONFIGURED` is **not** the production state. The previous audit reached
that verdict by measuring the **wrong environment** — the Freebuff workspace sandbox, whose
environment has never contained the Stripe variables — instead of the Render Web Service.

- **Runtime configuration: PASS** (`configured: true`, `mode: "test"`, `reason: null`)
- **Stripe TEST client: PASS** (constructed in the Render process; proven by the signature self-test)
- **Webhook endpoint: PASS** (live, publicly reachable, correctly refusing bad signatures)
- **Real Stripe TEST E2E: still BLOCKED — but now blocked on a human Stripe Checkout, not on configuration**
- **No product defect was found. No application code, schema or migration was changed.**

**No secret value was read, printed or recorded.** Only SET/NOT_SET, prefixes, and mode are reported.

---

## 1. Commit SHA

| Fact | Value |
|---|---|
| Branch | `main` |
| HEAD at start of this task | `c50a1a824113d8c5195e5afdb60fc6a2bd6e16a8` |
| HEAD subject at start | `docs(velrepeat): backfill the e2e audit commit sha` |
| `git rev-parse HEAD` vs `git ls-remote origin HEAD` at start | identical — **in sync** |
| Working tree at start | clean |
| **Commit that carries this audit** | **`407cdb1dc4920d7257b1b1431224b2c02e8c4890`** — `fix(velrepeat): verify stripe test runtime configuration`, pushed to `main` and confirmed on GitHub via `git ls-remote origin refs/heads/main` |
| Files in that commit | `INSTALLATION.md`, `.ai/AI_HANDOFF.md`, `.ai/tasks/audits/velrepeat-v2-stripe-test-runtime-verification-2026-10-03.md`, `.ai/tasks/audits/velrepeat-v2-real-stripe-test-e2e-2026-10-03.md` |
| Application code / test / schema / migration in that commit | **NONE** — `git diff --name-only c50a1a8 407cdb1 -- backend db apps packages .github '*.ts' '*.tsx' '*.json'` returns empty, so the §10 regression result still applies to the shipped tree |

The regression in §10 ran against `c50a1a8`; every file changed afterwards is Markdown only, so no
check had to be re-run.

---

## 2. STEP 1 — Source of truth: what the code actually reads

Every Stripe environment read in the backend, found by fixed-string scan:

| Render ENV name | Read at | Consumer |
|---|---|---|
| `STRIPE_SECRET_KEY` | `backend/lib/payment-config.ts:160` (`stripeStatus()`), `:211` (`stripeSecretKey()`) | `getStripe()` → the single Stripe client; then `stripeServerClient()` used by Checkout creation **and** by VelRepeat V2 `openPlanPaymentSession` |
| `STRIPE_PUBLISHABLE_KEY` | `backend/lib/payment-config.ts:161` | returned to the browser only (`/api/stripe/configured`, `/api/payments/methods`) |
| `STRIPE_WEBHOOK_SECRET` | `backend/lib/payment-config.ts:162`, `:216`, `:265` | `webhookSecretHealth()` and the signature check `stripe.webhooks.constructEventAsync(payload, signature, webhookSecret)` at `backend/routes/stripe.ts:1539` |
| `STRIPE_MODE` | `backend/lib/payment-config.ts:163` | compared against the key's own mode; disagreement ⇒ `STRIPE_MODE_MISMATCH` |

Reading is via `envString(name)` (`payment-config.ts:105-110`): trims, and treats empty/whitespace as
absent. **No renaming layer, no alias, no `VITE_` indirection exists** — the code reads these four
names directly from `process.env`.

### Name mapping (nothing was renamed, nothing needed renaming)

```
Render Web Service "velnox-api"  ->  process.env.STRIPE_SECRET_KEY        ->  stripeStatus()/stripeSecretKey() -> getStripe()
                                    ->  process.env.STRIPE_PUBLISHABLE_KEY ->  stripeStatus().publishableKey (browser only)
                                    ->  process.env.STRIPE_WEBHOOK_SECRET  ->  constructEventAsync() / webhookSecretHealth()
                                    ->  process.env.STRIPE_MODE            ->  mode agreement check
```

**The four names the owner set in Render are exactly the four names the code reads. No fix was
required at this layer, and none was made.**

### Frontends hold no Stripe credential

A scan of `apps/` and `packages/` for `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `sk_test`,
`sk_live`, `whsec_` returned **nothing**. No `VITE_STRIPE_*` variable exists. Stripe server-side logic
is backend-only, so the Vercel projects are correctly **not** part of this fix — exactly as required.

---

## 3. STEP 2 — Render runtime: what the live process actually sees

Probed over the public internet against the production API host documented in `docs/DEPLOYMENT.md:16`
and `INSTALLATION.md:385` — the Render Web Service `velnox-api`.

### `GET https://velnox-api.onrender.com/api/stripe/configured` → **HTTP 200**

| Field | Runtime value |
|---|---|
| `configured` | **`true`** |
| `mode` | **`"test"`** |
| `reason` | **`null`** |
| `webhookConfigured` | **`true`** |
| `publishableKey` | present, prefix **`pk_test_`** (value deliberately not reproduced here) |
| `webhookSecretHealth.present` | **`true`** |
| `webhookSecretHealth.shapeUsable` | **`true`** |
| `webhookSecretHealth.prefixOk` | **`true`** |
| `webhookSecretHealth.lengthBucket` | **`"expected"`** |
| `webhookSecretHealth.wrappedInQuotes` | **`false`** |
| `webhookSecretHealth.interiorWhitespace` | **`false`** |
| `webhookSecretHealth.surroundingWhitespaceOnly` | **`false`** |

### `GET …/api/stripe/configured?selfTest=1` → **HTTP 200**

| Field | Runtime value |
|---|---|
| `webhookSignatureSelfTest.attempted` | **`true`** |
| `webhookSignatureSelfTest.verified` | **`true`** |
| `webhookSignatureSelfTest.reason` | **`null`** |

### Reported per the safety rules

```
STRIPE_SECRET_KEY       = SET      prefix: sk_test_***
STRIPE_PUBLISHABLE_KEY  = SET      prefix: pk_test_***
STRIPE_WEBHOOK_SECRET   = SET      prefix: whsec_***
STRIPE_MODE             = test
```

The secret prefixes `sk_test_` / `whsec_` are inferred from the backend's own classifications
(`stripeStatus().usable === true` is only reachable for a *test* secret key, and
`webhookSecretHealth.prefixOk === true` is only true for a `whsec_` value). **No value was read or
printed.**

---

## 4. STEP 3 — Correct service, and deploy currency

| Question | Answer | Evidence |
|---|---|---|
| Is the ENV on the service that serves the API? | **YES** | The API host answered with `configured: true`; only the backend ever reads these names (see §2) |
| Was it set on Vercel by mistake? | **NO / not applicable** | The four frontends contain no Stripe secret read at all (§2) |
| Is the running build current? | **YES** | `webhookSecretHealth()` is a recent addition; its presence in the live response proves the deployed image carries current code |
| Are the VelRepeat V2 routes live? | **YES** | `POST /api/velrepeat/v2/plans` → **401 UNAUTHORIZED** (route exists, auth enforced); `POST /api/velrepeat/v2/plans/:planId/payment` → **401 UNAUTHORIZED** |
| Did Render pick the new ENV up? | **YES** | The running process reports the variables, which is only possible after Render redeployed/restarted the service |

`POST /api/velrepeat/v2/packages/:packageId` and `GET /api/velrepeat/v2/plans` returned **404** — both
paths are defined with a different HTTP method in the source, so this is expected routing behaviour,
not a missing deploy. (`/api/health` → 200 `{"status":"ok"}`.)

**A Render redeploy/restart after adding environment variables was necessary, and it evidently
happened** — the live process now sees the variables. This is no longer the blocker.

---

## 5. STEP 4 — Diagnostic: the safe endpoint already existed, so none was added

`GET /api/stripe/configured` (with optional `?selfTest=1`) already reports exactly the shape-only,
non-secret diagnostic that was needed — configured / mode / publishable prefix / webhook configured /
webhook-secret health / signature self-test. It is used, not replaced.

**No new endpoint was created.** Adding one would have been a new public surface returning
configuration state for no new information.

### Confirmed safe: no secret can come back through it

- The secret key is never in the response — only a boolean and a classification.
- `webhookSecretHealth()` returns booleans and a coarse length bucket. `lengthBucket: "expected"`
  conveys "right shape" and discloses nothing about the characters.
- The publishable key **is** returned — deliberately, because a publishable key is designed to reach
  browsers. It is not a secret. It is reported here as `pk_test_***` only.
- `webhookSignatureSelfTest` returns booleans and a reason string, never a header or value.

---

## 6. STEP 5 — Payment config runtime result

| Before this task (measured in the sandbox) | Now (measured on Render) |
|---|---|
| `{"usable": false, "mode": null, "reason": "STRIPE_NOT_CONFIGURED"}` | `configured: true, mode: "test", reason: null` |

`GET /api/payments/methods` → **HTTP 200**, runtime result:

```
paymentMethods            = ["CARD", "PROMPTPAY"]
CARD    (STRIPE)   enabled = true   stripePaymentMethodType = "card"
PROMPTPAY (STRIPE) enabled = true   stripePaymentMethodType = "promptpay"
COD     (CARRIER)  enabled = false
currency = "THB"
stripe = { configured: true, mode: "test", webhookConfigured: true }
```

The backend now offers exactly the two Stripe rails and keeps COD off. **No response was edited to
make this pass, and no code was changed to produce it** — the state was already correct on Render and
simply had never been observed.

---

## 7. STEP 6 — Stripe TEST client

**PASS — proven from the running process, not inferred.**

`selfTestWebhookSignature()` (`backend/routes/stripe.ts:171-199`) begins:

```ts
const s = getStripe();
const webhookSecret = stripeWebhookSecret();
if (!s || !webhookSecret) return { attempted: false, … };
```

Because `attempted` is `true`, `getStripe()` returned a **non-null Stripe client** in the Render
process. That is direct evidence the client was constructed from the configured test key — a
non-null client is unreachable with a live key or a missing webhook secret, because
`stripeSecretKey()` returns `null` unless the key classifies as `test` **and** the webhook secret is
present (`payment-config.ts:209-211`).

| Property | Value |
|---|---|
| Client constructed | **YES** |
| Mode | **`test`** — a live key would have been refused with `STRIPE_LIVE_KEY_REFUSED` and left `configured: false` |
| API version pinned | `2025-08-27.basil` (`backend/routes/stripe.ts:88`) |
| Single shared client | **YES** — `stripeServerClient()` (`backend/routes/stripe.ts:110-112`) returns the same cached `getStripe()` used by Checkout, so VelRepeat V2 shares one credential and one mode decision |
| Live PaymentIntent created | **NO** |
| Real money used | **NONE** |

**Not yet proven:** that the client can complete an authenticated round-trip to Stripe's API. The
self-test is local crypto; it proves key classification, client construction and signature
verification — not network reachability to Stripe. The first Checkout creation will prove that.

---

## 8. Webhook endpoint (public runtime)

`POST https://velnox-api.onrender.com/api/payments/stripe/webhook` — **live and publicly reachable**,
which is the precondition for Stripe delivering to it.

| Probe | Result | Meaning |
|---|---|---|
| Body with `Stripe-Signature: t=1,v1=deadbeef` | **400** `{"error":"Invalid signature"}` | the handler is live and **rejects** a forged signature before any write |
| Body with **no** `Stripe-Signature` header | **400** `{"error":"Missing stripe-signature header"}` | the header is mandatory |
| Locally signed payload via `?selfTest=1` | `verified: true` | a correctly signed payload **is accepted**, so the rejection above is not over-blocking |

A Stripe webhook pointed at the **wrong host** (`velnx-api`, one letter different) delivers nothing
and would be indistinguishable from "Stripe never sent it" — `docs/ENVIRONMENT.md:47` records this
trap. The endpoint used here is `velnox-api.onrender.com`, the documented production host.

---

## 9. STEP 7 — Real Stripe TEST E2E — still BLOCKED, on a different thing

**The configuration blocker is gone. What remains is not a configuration problem.**

The remaining blockers are all "needs an interactive Stripe action or a production write":

1. **An authenticated production session.** `POST /api/velrepeat/v2/plans` and
   `POST /api/velrepeat/v2/plans/:planId/payment` both answer **401** without one. Obtaining one means
   signing in as a real customer through Google OAuth — an interactive human step.
2. **Completing a Stripe Checkout Session.** The implementation creates a **hosted Checkout Session**
   (`stripe.checkout.sessions.create`), which must be completed in a browser with a Stripe **TEST** card
   (`4242 4242 4242 4242`). It cannot be completed server-side, and this agent has no browser.
3. **Stripe delivering the webhook.** Stripe will deliver to `velnox-api.onrender.com` once the TEST
   endpoint is registered in the Stripe Dashboard against that exact URL. The endpoint is reachable
   and verifying; the Dashboard-side registration cannot be verified from here.
4. **Disposable production fixtures.** Creating a seller, package, product and variant writes rows into
   the production Neon database. That was not authorized by this task and is not done.

**Nothing was faked to work around any of these.** No plan was created, no payment row was written,
no database row was marked paid, no synthetic webhook was submitted and called an E2E, and no live
credential was used.

### Exact procedure to finish it (owner, ~10 minutes, zero real money)

1. In the Stripe **test-mode** Dashboard, confirm a webhook endpoint exists for
   `https://velnox-api.onrender.com/api/payments/stripe/webhook` subscribed to
   `checkout.session.completed` (plus `payment_intent.succeeded` /
   `checkout.session.async_payment_succeeded`). Its signing secret is already the value in
   `STRIPE_WEBHOOK_SECRET` (`prefixOk: true`, `shapeUsable: true`).
2. Sign in to the storefront as a customer, create a **draft** 2- or 3-cycle Repeat Plan, and confirm
   it is `draft` before paying.
3. Start the payment and complete the Stripe **TEST** checkout with `4242 4242 4242 4242`,
   any future expiry, any CVC, any postal code.
4. Re-run `GET /api/stripe/configured?selfTest=1` and `GET /api/payments/methods`, then run the
   Velnox Stripe Payment Trace workflow to see the delivery recorded in `payment_events`.
5. Confirm afterwards: `velrepeat_plans.status = active`, the cycle schedule exists, and
   `orders created at activation = 0`.

---

## 10. STEP 8 — Regression (real results, this round)

This repository is `bun`-workspace based; `.ai/AI_RULES.md` defines the commands, so the repo's own
commands were run rather than the `pnpm`/`tsc -b` form.

| Check | Command | Result |
|---|---|---|
| Full suite | `TEST_DATABASE_URL=… bun test backend/tests` | **1882 pass / 2 skip / 0 fail** — 1884 tests, 61 files, 12.68 s, **exit 0** |
| Backend typecheck | `cd backend && bunx tsc --noEmit` | **0 errors, exit 0** |
| App typecheck | `bun run typecheck` | **exit 0** — velshop / velseller / velcenter / velnox all `Exited with code 0` (4/4) |
| Build | `bun run build:apps` | **exit 0** — 4/4 `Exited with code 0` |
| Whitespace / conflict markers | `git diff --check` | **clean** |
| Canonical schema pair | `cmp db/schema.sql db/run-sqleditor.sql` | **identical** |

Each command's own exit status was preserved (`PIPESTATUS[0]` captured through the output filter).
**Zero failures. No assertion was weakened, skipped or deleted. No test was changed to obtain this
result.** The 2 skips are pre-existing and unrelated (upload-confirm authz cases needing live R2
credentials).

PostgreSQL needed `service postgresql start` before the suite — a **local, disposable** test database.
No production database was contacted at any point in this task.

---

## 11. Files changed

| File | Change |
|---|---|
| `INSTALLATION.md` | **Documentation only.** The Render environment-variable block listed 11 variables and **omitted all four Stripe ones**, which is a real trap: an operator following it has no way to discover that Card/PromptPay need `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_MODE` on the backend service. Added the four names plus a short TEST-mode-only note pointing at `docs/ENVIRONMENT.md` and at `GET /api/stripe/configured` for verification. |

**No application code, no schema, no migration, no test, and no Stripe/VelRepeat architecture was
changed.** The production runtime was already correct; the defect was in how it was being measured.

---

## 12. ROOT CAUSE

**The audit that reported `STRIPE_NOT_CONFIGURED` measured the Freebuff workspace sandbox, not the
Render production service.**

Chain, end to end:

```
Owner sets the 4 Stripe variables on Render  ->  Render redeploys  ->  backend process HAS them
                                                    (this already happened)

… while the audit measured a different environment:

freebuff-env list        -> {"files":{}}      \  Freebuff sandbox environment — never had them
freebuff-deploy env list -> {"keys":[]}        /  and never will; it is not the production API
stripeStatus() run IN THE SANDBOX
  -> usable=false, reason=STRIPE_NOT_CONFIGURED
  -> audit concludes "credentials missing"
```

`stripeStatus()` (`backend/lib/payment-config.ts:159-198`) reads `process.env` **of whatever process it
runs in**. In the sandbox that process is not the Render service, so it reported the sandbox's empty
environment while the real service was — and is — correctly configured. `freebuff-deploy env list`
reports **Freebuff-managed hosting**, which is a different host from Render and says nothing about
Render's environment.

The refusal chain in the code was, and remains, exactly right: with no key it returns
`STRIPE_NOT_CONFIGURED`; with a live key it returns `STRIPE_LIVE_KEY_REFUSED`; with a mismatch
`STRIPE_MODE_MISMATCH`; with no webhook secret `STRIPE_WEBHOOK_NOT_CONFIGURED`. **Nothing was broken
and nothing needed loosening.**

The methodological fix is to **verify configuration against the environment that serves traffic**
(`https://velnox-api.onrender.com/api/stripe/configured`), never against the build sandbox.

---

## 13. Remaining blockers

Configuration blockers: **none.**

| # | Remaining blocker | Owner | Nature |
|---|---|---|---|
| 1 | Register/confirm the Stripe **test-mode** webhook endpoint for `https://velnox-api.onrender.com/api/payments/stripe/webhook` | owner | Stripe Dashboard |
| 2 | Complete the Stripe **TEST** Checkout in a browser with `4242 4242 4242 4242` | owner | interactive |
| 3 | Disposable production fixtures for the VelRepeat V2 plan | owner | production data write, not authorized here |
| 4 | An authenticated customer session | owner | Google OAuth, interactive |

None of these is a code defect. Once steps 1–4 are done, the remaining E2E verification
(activation → cycle schedule → due cycle → order → inventory → idempotency → negatives) is the
plan already written in `.ai/tasks/audits/velrepeat-v2-real-stripe-test-e2e-2026-10-03.md` §3.

**VelRepeat V2 remains NOT production ready** — not because of configuration, which is now proven
correct, but because a real Stripe TEST E2E has still not been executed end to end.

---

## 14. Safety record

- No secret read, printed, logged or recorded anywhere in this task or in this file.
- Only SET/NOT_SET, prefixes (`sk_test_`, `pk_test_`, `whsec_`), and mode `test` were reported.
- No live credential exists anywhere and none was used; a live key would be refused by the backend.
- No fake credentials, no hardcoded secret, no fallback key, no relaxed gate.
- No architecture change, no schema change, no migration.
- The only writes to the production API were two unauthenticated **negative** probes that the handler
  rejected with `400` before any database work — proving the refusal path, changing nothing.
- No production database row was created, read or modified by this task.