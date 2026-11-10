# VELNOX-UNIFIED-DOMAIN-MIGRATION — Unified Domain Migration & Infrastructure Configuration

**Task ID:** VELNOX-UNIFIED-DOMAIN-MIGRATION
**Level:** T3 CRITICAL (production DNS / auth / payment surfaces)
**Owner:** project owner · **Executor:** AI 01 · **Reviewer:** AI 02
**Updated:** 2026-11-10
**Unified domain:** `velnox.live` *(changed from the brief's `velnox.com` — see §1)*

| System | Target URL |
|---|---|
| Corporate | `https://velnox.live` |
| VelShop | `https://shop.velnox.live` |
| VelSeller | `https://seller.velnox.live` |
| VelCenter | `https://center.velnox.live` |
| Backend API | `https://api.velnox.live` |

> **Status legend:** PASS = verified by real behaviour · FAIL = operation failed ·
> BLOCKED = needs access or owner approval · NOT TESTED = not verified yet ·
> N/A = not relevant to the actual architecture.

---

## PHASE 0 — Audit and Baseline (read-only) — **COMPLETE**

### 0.1 Repository

| Item | Value | Status |
|---|---|---|
| Remote / branch | `github.com/EnJirad/velnox-marketplace` · `main` → `origin/main` | PASS |
| Local HEAD | `33905402f077bb906268a4cc8748b20e70f50310` | PASS |
| origin/main (after `git fetch origin`) | `33905402f077bb906268a4cc8748b20e70f50310` — equal, not diverged | PASS |
| Uncommitted changes at start | none | PASS |
| App dirs | `apps/velnox` (Corporate) · `apps/velshop` · `apps/velseller` · `apps/velcenter` · `backend` · `packages/shared` | PASS |

### 0.2 Vercel — team `team_oF9vBJ82fB9IlhUyKQxS2KqY`

| Project | Project ID | Production deployment | Domains |
|---|---|---|---|
| `velnox` (Corporate) | `prj_20hpTiCJeHH5OihSy4bOzj6KaEoD` | `dpl_7cyJm7ZFZjpfa5ehSMkKrGFiZMn8` READY | `velnox-theta.vercel.app` |
| `velshop` | `prj_HKsSszYCpPx7SeWyspoBykBagj5s` | `dpl_9TRECEvNYXFPXAdgCHvsKt2HoiK8` READY | `velnox.live`, `www.velnox.live` (308→www), `velshop.vercel.app` |
| `velseller` | `prj_0rpRQPfA9nbvmDVdbs3PLPf1L7GQ` | `dpl_63QpERGW8QJHkMvuXEp9oi3aLfCH` READY | `velseller.vercel.app` |
| `velcenter` | `prj_TSN2heezRqjIeU40l6XGnCIRvnpE` | `dpl_3z3kY5hivTD9fZVpp7exZnLFtYcF` READY | `velcenter.vercel.app` |

All four exist → no project was created or duplicated. All `framework: vite`, `nodeVersion: 24.x`,
`ssoProtection: all_except_custom_domains` (preview only — custom domains are not gated).

**DNS targets, read from `get_domain_config` (provider-supplied, not guessed):**

| Rank | CNAME | A (apex) |
|---|---|---|
| 1 | `b04e1ed0b385c8f3.vercel-dns-017.com.` | `216.198.79.1`, `64.29.17.1` |
| 2 | `cname.vercel-dns.com.` | `76.76.21.21` |

`VITE_API_URL` = `https://velnox-api.onrender.com` (decrypted read, `velshop` + `velnox`).
Encrypted env **key names are redacted** by the MCP output; env writes use `upsert`, so an absent key
is safe. Per-project key inventory: NOT TESTED.

### 0.3 Render — workspace `tea-d4fln60gjchc73e5sn5g`

| Item | Value | Status |
|---|---|---|
| Service | `velnox-api` · `srv-da5dg76417fc73f3krkg` · web_service | PASS |
| Repo / branch / root | `EnJirad/velnox-marketplace` · `main` · `""` (repo root — correct) | PASS |
| Build / start | `bun install` · `bun run api:start` | PASS |
| Plan / region | free · ohio · 1 instance | PASS |
| URL | `https://velnox-api.onrender.com` | PASS |
| Health | `GET /api/health` → `200 {"status":"ok"}` | PASS |
| Custom domains | **NOT TESTED** — `get_service` exposes no such field; absence of data ≠ none | NOT TESTED |

### 0.4 Cloudflare — account `4de3c2e38b2968c6a5f7317efbeaebc3`

| Item | Value | Status |
|---|---|---|
| Zones in account | **0** | FAIL |
| Token write permissions | **none** — `POST /zones` → `403` (`com.cloudflare.api.account.zone.create`); `PUT …/r2/buckets/{b}/cors` → `403`; `GET /user/tokens` → `403` | FAIL — **read-only connection** |
| R2 bucket | `velnox-storage` · `01da4cea98c140f98d0c20ec14acb608` | PASS (read) |
| R2 public domain | `https://pub-01da4cea98c140f98d0c20ec14acb608.r2.dev` | PASS |
| R2 CORS (current) | `PUT,GET,HEAD` · headers `*` · expose `ETag` · maxAge 3600 · origins: `velshop.vercel.app`, `velseller.vercel.app`, `velcenter.vercel.app`, `velnox-group.vercel.app`, `velnox.vercel.app`, `localhost:5173-5176` | PASS (read) |

**Live CORS defect (pre-existing, still unfixed — the write is `403`):** the storefront customers
actually use is `https://www.velnox.live` (verified: apex `308` → `www`). **Neither `velnox.live` nor
`www.velnox.live` nor `velnox-theta.vercel.app` is in the R2 origin list**, so browser uploads from the
live storefront are rejected at preflight. Upload failure itself: NOT TESTED (needs an authenticated session).

### 0.5 Neon

| Item | Value | Status |
|---|---|---|
| Project | `wandering-glitter-94857012` · ap-southeast-1 · pg18 | PASS |
| Branch | `production` · `br-frosty-sea-az7kagpe` · `ready` · primary/default | PASS |
| Logical size | 39,608,320 bytes | PASS |
| Connectivity | proven through `GET /api/health` (Render → Neon) | PASS |

### 0.6 Stripe — `acct_1UKCn2Kp4iwMdWLy` ("แซนด์บ็อกซ์ Velnox")

| Item | Value | Status |
|---|---|---|
| Mode | `livemode: false` → sandbox | PASS |
| Webhook | 1 endpoint `we_1UKSNuKp4iwMdWLydX57ivxS` → `https://velnox-api.onrender.com/api/payments/stripe/webhook`, `enabled` | PASS |
| API version | `2026-08-26.dahlia` | PASS |

### 0.7 Convex — **N/A**

Zero `convex` references in `*.ts`/`*.tsx`, no dependency, no `convex/` directory. Realtime is
`backend/realtime/index.ts` (native WebSocket on the same Express process — `.ai/context/realtime.md`).
The architecture description in the brief does not match the repository. **Nothing to migrate.**

### 0.8 Configuration names found in source (authoritative — no new names invented)

`DATABASE_URL` · `JWT_SECRET` · `OAUTH_STATE_SECRET` · `GOOGLE_CLIENT_ID` · `GOOGLE_CLIENT_SECRET` ·
`GOOGLE_REDIRECT_URI` · `CORS_ORIGINS` · `VITE_API_URL` · `VITE_VELSHOP_URL` · `VITE_VELSELLER_URL` ·
`VITE_VELCENTER_URL` · `VITE_CORPORATE_URL` · `STRIPE_MODE` · `STRIPE_SECRET_KEY` ·
`STRIPE_PUBLISHABLE_KEY` · `STRIPE_WEBHOOK_SECRET` · `R2_ACCOUNT_ID` · `R2_ACCESS_KEY_ID` ·
`R2_SECRET_ACCESS_KEY` · `R2_BUCKET` · `R2_PUBLIC_DOMAIN` · `TURNSTILE_SECRET_KEY` ·
`BOOTSTRAP_OWNER_SECRET`

Behaviour that decides the migration shape:

- `backend/server.ts` merges `CORS_ORIGINS` + the four `VITE_*_URL` values + dev origins, and feeds the
  **same** list to `createOriginGuard` (CSRF). → one env change covers CORS **and** CSRF.
- `backend/routes/auth.ts`: session cookie `sameSite: "none"`, `secure` in prod, **no `domain`** attr.
- `getFrontendUrl()` (`auth.ts:895-931`) drives OAuth post-login returns from `VITE_<APP>_URL`, then falls
  back to `CORS_ORIGINS[0]` and `/shop/`, `/seller/`, `/center/` regex matches.
- `backend/routes/stripe.ts:848,2410`: `frontendUrl = VITE_VELSHOP_URL || "https://velshop.vercel.app"`.
- `packages/shared/src/lib/sites.ts`: `SITE_URLS` uses `??` (empty string ⇒ broken link);
  `apiUrl` uses `||` (empty string ⇒ `http://localhost:3001`). Never write `""` into either.
- **One** `STRIPE_WEBHOOK_SECRET` (`payment-config.ts:177,254` → `stripe.ts:2605,2657`).

### 0.9 MCP capability matrix (measured, not assumed)

| MCP | Read | Write | Gap |
|---|---|---|---|
| GitHub | ✅ | ✅ | — |
| Vercel | ✅ | ✅ domains, env, DNS records, deployments | encrypted env key names redacted |
| Render | ⚠️ partial | env update only | **no custom-domain tool**, **no env read** |
| Cloudflare | ✅ | ❌ **read-only token** | zone create, DNS write, R2 CORS write all `403` |
| Neon | ✅ | ✅ | not needed — no schema/data change authorized |
| Stripe | ✅ | ✅ | — |

### 0.10 AI 02 independent review — verdict **REJECT** → corrections applied

AI 02 re-verified the infrastructure and source independently. It confirmed the DNS diagnosis and the
stop-at-owner-checkpoint, but rejected the plan on execution order and PHASE 9. R1–R8 are now folded in:

| # | Correction | Evidence | Applied |
|---|---|---|---|
| R1 | DNS/TLS of a host must be live **before** `VITE_*_URL` is switched | `auth.ts:895-931`, `stripe.ts:848,2410` | PHASE 5 |
| R2 | One `whsec` ⇒ **edit** the existing webhook's URL, do not add a second endpoint | `payment-config.ts:177,254`; `stripe.ts:2605,2657` | PHASE 9 |
| R3 | 3 hardcoded legacy hosts → `SITE_URLS` | `SellerProfile.tsx:287`; `ShopProfile.tsx:93-94` | **DONE** (§5b) |
| R4 | Session cookie is host-only ⇒ one forced logout when the API host changes | `auth.ts:263-272` | PHASE 5 |
| R5 | Old zone unreadable over DNS ⇒ export records before any NS change | DoH `REFUSED` | PHASE 4 |
| R6 | `velnox.live` must never be moved — it is the live storefront | apex → `www` → VelShop | PHASE 4 / ROLLBACK |
| R7 | Repo verification gates are mandatory | `ESSENTIAL_RULES.md` §7 | CHECKLIST |
| R8 | Env writes are production deploys (rebuild / restart) ⇒ explicit authorization | `ESSENTIAL_RULES.md` §2 | PHASE 5 |

Also confirmed by that review (no action needed): no test pins the legacy default URLs; the `/ws`
client derives its URL from `VITE_API_URL` with no hardcoded host; R2 presigning targets
`r2.cloudflarestorage.com` and public assets come from `R2_PUBLIC_DOMAIN` (`*.r2.dev`), so **no stored
object or URL breaks** when a page domain changes.

---

## PHASE 1 — Domain readiness — **RESOLVED, with a change of domain**

**`velnox.com` is not available to this project.** RDAP (Verisign) shows it registered at GoDaddy on
2018-03-07, expires 2032-03-07, nameservers `NS1/NS2.RENEWYOURNAME.NET` (GoDaddy parking) which answer
`REFUSED` — it has no working DNS and is not in the owner's Cloudflare account. The owner confirmed they
only bought **`velnox.live`**.

**`velnox.live` is owned by the project owner at GoDaddy** and is therefore the unified domain.

Current zone contents (enumerated over DoH — the only way to read it, since GoDaddy DNS is not exposed
by any MCP):

| Type | Name | Value |
|---|---|---|
| A | `@` | `216.198.79.1` |
| CNAME | `www` | `b04e1ed0b385c8f3.vercel-dns-017.com` |
| TXT | `_dmarc` | `v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net;` |
| NS | `@` | `ns09.domaincontrol.com`, `ns10.domaincontrol.com` |

No `MX`, no SPF, no DKIM selector, no other subdomain → **migrating this zone loses no mail or
verification record.** `shop`, `seller`, `center`, `api` do not exist yet.

**Also found — FIXED 2026-11-10:** the Corporate site published `support@ / privacy@ / legal@ /
careers@velnox.com` (`content.ts:165,207,230`, `Contact.tsx:8,70`) plus a `somchai@velnox.com`
placeholder (`EmployeeManager.tsx:599`) on a domain the project does not own — those addresses could
never receive mail. All user-facing strings now use `@velnox.live`, and the canonical domain in source
comments (`main.tsx:2`, `origin-guard.ts:8`, `auth-flow.ts:168-169`, `sites.ts:9,62-69`,
`vite-env.d.ts:10-19`, `security-hardening.test.ts:234,238`) matches reality. `velnox.com` no longer
appears anywhere in source.

**Caveat, still true:** `velnox.live` has no `MX` record, so mail to these addresses does **not**
deliver yet either. The change aligns the address with the owned domain so that adding MX later makes
them work; it does not by itself create a mailbox.

**Owner decision taken:** route the zone through Cloudflare (owner changes the nameservers at GoDaddy
personally). **Blocked in practice** by the read-only Cloudflare token (§0.9) — see the decision gate.

---

## PHASE 2 — Vercel custom domains — **PARTIALLY DONE**

Mapping approved (owner delegated the choice). Rationale: `velnox.live` was attached to the storefront
only on 2026-11-09 (`createdAt 1794246693`), so SEO equity is ~0 and the apex swap costs nothing — while
the subdomain layout is the structure the platform is documented for (`sites.ts`).

| Application | Project | Domain | Status |
|---|---|---|---|
| VelShop | `prj_HKsSszYCpPx7SeWyspoBykBagj5s` | `shop.velnox.live` | **PASS** — added, `verified: true` |
| VelSeller | `prj_0rpRQPfA9nbvmDVdbs3PLPf1L7GQ` | `seller.velnox.live` | **PASS** — added, `verified: true` |
| VelCenter | `prj_TSN2heezRqjIeU40l6XGnCIRvnpE` | `center.velnox.live` | **PASS** — added, `verified: true` |
| Corporate | `prj_20hpTiCJeHH5OihSy4bOzj6KaEoD` | `velnox.live` | BLOCKED — still bound to `velshop`; the swap must not happen before `shop.velnox.live` serves traffic |

`www.velnox.live` must eventually move to Corporate as well; today it is the working storefront URL.
No root directory, framework or branch was changed.

## PHASE 3 — Render custom domain `api.velnox.live` — BLOCKED

Two blockers: no DNS write path (§0.9) and **Render MCP has no custom-domain operation**. The service
must not be recreated. Target CNAME is the service host itself: `velnox-api.onrender.com`
(documented Render custom-domain procedure). Steps the owner must take are in §Owner actions.
`velnox-api.onrender.com` stays operational throughout.

## PHASE 4 — Cloudflare DNS — BLOCKED (read-only token)

Planned records — every target is provider-supplied:

| Host | Type | Value | Source |
|---|---|---|---|
| `@` | A | `216.198.79.1` (and `64.29.17.1`) | Vercel `recommendedIPv4` rank 1 |
| `www` | CNAME | `b04e1ed0b385c8f3.vercel-dns-017.com` | Vercel `recommendedCNAME` rank 1 |
| `shop` | CNAME | `b04e1ed0b385c8f3.vercel-dns-017.com` | Vercel, per-project target |
| `seller` | CNAME | `b04e1ed0b385c8f3.vercel-dns-017.com` | Vercel, per-project target |
| `center` | CNAME | `b04e1ed0b385c8f3.vercel-dns-017.com` | Vercel, per-project target |
| `api` | CNAME | `velnox-api.onrender.com` | Render service host |
| `_dmarc` | TXT | existing value, copied verbatim | current zone |

Start DNS-only. Enable the proxy only after the app is proven compatible (Vercel + Render both warn
that proxying their TLS termination can cause redirect loops / certificate mismatch).

**R6:** only `velnox.live`'s nameservers may change. Never touch a second domain in the same GoDaddy
account during this operation.

## PHASE 5 — Environment configuration — BLOCKED until PHASE 4

Order (R1): `CORS_ORIGINS` (additive) → verify `api.velnox.live` TLS + `/api/health` → `VITE_API_URL`
on the 4 projects → `VITE_*_URL` on Render. Never write `""`. Never blank a secret.
R8: each write triggers a production rebuild/restart ⇒ needs its own authorization.
R4: changing the API host logs every user out once (host-only cookie) — announce a window.

## PHASE 5b — Code fix (R3) — **DONE, verified**

| File | Change |
|---|---|
| `apps/velseller/src/pages/SellerProfile.tsx:17,287` | import `SITE_URLS`; shop link uses `${SITE_URLS.velshop}` |
| `apps/velshop/src/pages/ShopProfile.tsx:18,93-94` | import `SITE_URLS`; terms/privacy use `${SITE_URLS.corporate}` |

Behaviour is unchanged today (the `SITE_URLS` defaults are byte-identical to the replaced hosts).
The `/shops/` vs `/shop/` path in `SellerProfile.tsx` is a **pre-existing** defect — deliberately untouched.

Gates: `git diff --check` clean · `bun run typecheck` 4/4 exit 0 · `bun run i18n:check` th/en/my 2235 at
parity · `bun run test` **1420 pass / 425 skip / 0 fail** (1845 tests, 101 files).

## PHASE 6 — CORS and authentication — BLOCKED (needs PHASE 5)

- CORS + CSRF share one list ⇒ one env change covers both. No wildcard with credentials.
- Do **not** remove legacy origins from `CORS_ORIGINS` before PHASE 10 — `getFrontendUrl()` still falls
  back to `origins[0]` and to `/shop|seller|center/` regex matches.
- `GOOGLE_REDIRECT_URI` must be updated in the Google Console **before** the env value changes.
  Whether it points at the API host today: NOT TESTED (Render env unreadable — §0.9).
- Known pre-existing weakness, not worsened here: the `/ws` upgrade accepts any origin. Security debt.

## PHASE 7 — Cloudflare R2 — BLOCKED (read-only token)

Required additive edit to `velnox-storage` CORS, preserving every current origin/method/header/ETag/maxAge:
1. **Fix the live defect:** add `https://velnox.live`, `https://www.velnox.live`, `https://velnox-theta.vercel.app`.
2. **Migration:** add `https://shop.velnox.live`, `https://seller.velnox.live`, `https://center.velnox.live`.

No bucket, key, credential, or upload-path change.

## PHASE 8 — Neon / Convex — N/A

Neon: no schema/data/connection-string change is authorized or needed. Convex: not part of this system.
Realtime (native WebSocket) verification is part of PHASE 10.

## PHASE 9 — Stripe — BLOCKED until PHASE 3

**Do not add a second endpoint** (one `whsec` ⇒ it would fail verification).
Edit the URL of `we_1UKSNuKp4iwMdWLydX57ivxS` to
`https://api.velnox.live/api/payments/stripe/webhook` after `api.velnox.live` is proven, then verify with
`GET /api/stripe/configured` → `webhookSecretHealth`, `selfTestWebhookSignature()`, and real deliveries.
`livemode: false` unchanged. PromptPay and Card untouched.

## PHASE 10 — Deployment and verification — NOT STARTED

Sequence: API → Corporate → VelShop → VelSeller → VelCenter, one at a time, each verified before the next.

## PHASE 11 — Legacy transition — NOT STARTED

`velshop.vercel.app`, `velseller.vercel.app`, `velcenter.vercel.app`, `velnox-api.onrender.com` and
`velnox.live` stay live until the owner accepts the migration.

---

## CHECKLIST

### Phase 0
- [x] `git fetch origin`; HEAD == origin/main; tree clean
- [x] 4 Vercel projects mapped to Corporate/Shop/Seller/Center; all READY
- [x] Render `velnox-api` found; `/api/health` 200
- [x] Cloudflare account, zero zones, R2 bucket + CORS captured
- [x] Neon project/branch recorded
- [x] Stripe mode + webhook recorded
- [x] Convex proven absent → N/A
- [x] Env names harvested from source
- [x] MCP capability matrix measured (Cloudflare read-only proven by 403)
- [x] AI 02 review → REJECT, R1–R8 applied
- [x] Task file written

### Phase 1
- [x] `velnox.com` ownership disproven (RDAP); owner confirmed only `velnox.live`
- [x] `velnox.live` zone enumerated from DoH; no MX/SPF/DKIM at risk
- [x] Owner chose Cloudflare as the DNS authority
- [ ] Cloudflare zone created for `velnox.live` — **BLOCKED: token is read-only**
- [ ] Nameservers changed at GoDaddy — **owner action**

### Phase 2
- [x] `shop.velnox.live` → `velshop`
- [x] `seller.velnox.live` → `velseller`
- [x] `center.velnox.live` → `velcenter`
- [ ] `velnox.live` → `velnox` (Corporate) — only after `shop.*` serves traffic
- [ ] `www.velnox.live` moved to Corporate

### Phase 3
- [ ] `api.velnox.live` attached in Render dashboard — **owner action (MCP gap)**
- [ ] `velnox-api.onrender.com` kept live

### Phase 4
- [ ] 6 records written; `_dmarc` preserved; DNS-only
- [ ] Propagation + TLS verified

### Phase 5
- [ ] `CORS_ORIGINS` extended additively
- [ ] `api.velnox.live` TLS + health verified
- [ ] `VITE_API_URL` switched on 4 projects (never `""`)
- [ ] Render `VITE_*_URL` switched after each host answers
- [ ] Owner authorization for production builds/restarts (R8)
- [ ] Maintenance window + forced-logout notice (R4)

### Phase 5b
- [x] `SellerProfile.tsx` host → `SITE_URLS.velshop`
- [x] `ShopProfile.tsx` hosts → `SITE_URLS.corporate`
- [x] typecheck / test / i18n / `diff --check` all green

### Phase 6
- [ ] CORS allows the 4 new origins with credentials
- [ ] Origin guard allows them
- [ ] OAuth post-login redirect resolves to new hosts
- [ ] `GOOGLE_REDIRECT_URI` updated in the Google Console first

### Phase 7
- [ ] Live R2 CORS defect fixed (`velnox.live`, `www`, `velnox-theta`)
- [ ] 3 new origins added; all previous preserved
- [ ] Upload smoke-tested from a new host

### Phase 8
- [ ] Neon reads/writes verified through app flows
- [ ] Realtime `/ws` verified against the new API host

### Phase 9
- [ ] Existing webhook URL switched (not a second endpoint)
- [ ] `webhookSecretHealth` + self-test + real deliveries confirmed

### Phase 10
- [ ] API → Corporate → VelShop → VelSeller → VelCenter, one at a time

### Phase 11
- [ ] Legacy hosts preserved; redirects only after approval

---

## OWNER ACTIONS (cannot be performed by an agent)

1. **Cloudflare zone** — dashboard → Add a site → `velnox.live` → note the two assigned nameservers.
   *Optional:* re-issue the MCP API token with `Zone:Edit`, `Zone.DNS:Edit`, `R2:Edit` so the remaining
   steps can be automated. Current token: read-only (proven by `403`).
2. **GoDaddy nameservers** — for `velnox.live` only, replace `ns09/ns10.domaincontrol.com` with the
   Cloudflare pair. Do **not** touch any other domain in that account.
3. **Render custom domain** — service `velnox-api` → Settings → Custom Domains → add `api.velnox.live`
   (no MCP operation exists for this).
4. **Google Cloud Console** — add `https://velnox.live`, `https://shop.velnox.live`,
   `https://seller.velnox.live`, `https://center.velnox.live` to Authorized JavaScript origins, and set
   the Authorized redirect URI to the new `GOOGLE_REDIRECT_URI` on `api.velnox.live` — **before** the env
   value changes.
5. **R2 CORS** — bucket `velnox-storage` → Settings → CORS, add the 6 origins listed in PHASE 7.

---

## ROLLBACK

Prerequisites that must exist before the first env write:
1. **Env baseline snapshot** — neither MCP can read Render env, and Vercel encrypted values are
   write-only, so the current values must be saved by the owner first. Without it there is nothing to restore.
2. **DNS record snapshot** — GoDaddy DNS is not exposed by any MCP; the table in PHASE 1 is the snapshot.

| Layer | Rollback |
|---|---|
| Env (Vercel/Render) | Re-apply the snapshot value **and** redeploy — reverting the value alone changes nothing live |
| DNS | Restore previous record values; **nameserver revert is an owner action at GoDaddy** |
| Vercel domain | Remove the added `add_project_domain` entry |
| Cloudflare zone | Delete the pending zone |
| R2 CORS | Re-apply the §0.4 rule set |
| Stripe | Point the endpoint URL back to `velnox-api.onrender.com`; `whsec` never changed |
| Deployment | `request_rollback` / Render rollback |

Never deleted: Neon data, R2 objects, the Render service, the four Vercel projects, or any legacy host.
