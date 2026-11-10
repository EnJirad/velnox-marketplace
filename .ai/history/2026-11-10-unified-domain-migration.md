# 2026-11-10 — Unified Domain Migration (VELNOX-UNIFIED-DOMAIN-MIGRATION)

**Status:** IN PROGRESS — infra blocked, safe work landed
**Branch:** `main` · **Base HEAD:** `33905402f077bb906268a4cc8748b20e70f50310`
**Task file:** `.ai/tasks/active/unified-domain-migration.md`

## What was asked

Migrate the whole platform onto one apex domain with subdomains (brief said `velnox.com`:
Corporate at apex, `shop.` / `seller.` / `center.` / `api.`), across Vercel, Render, Cloudflare,
Neon, Convex and Stripe. Read-only audit first, then execute phase by phase, no architecture rebuild.

## What was actually found (facts, not assumptions)

- **`velnox.com` is not the project's.** RDAP (Verisign) → GoDaddy, registered 2018-03-07, expires
  2032-03-07, nameservers `NS1/NS2.RENEWYOURNAME.NET` (GoDaddy parking) answering `REFUSED`. The owner
  confirmed they only bought **`velnox.live`**. The task's main domain was therefore re-based to
  `velnox.live`; every phase in the task file is written against it.
- **Corporate copy already advertises mailboxes on a domain the project does not own**
  (`support@ / privacy@ / legal@ / careers@velnox.com` — `apps/velnox/src/pages/corporate/content.ts:165,207,230`,
  `Contact.tsx:8,70`). Undeliverable. Reported, not silently changed.
- **`velnox.live` zone is almost empty:** A `@` → `216.198.79.1`, CNAME `www` →
  `b04e1ed0b385c8f3.vercel-dns-017.com`, TXT `_dmarc`. No MX, no SPF, no DKIM selector. Moving the zone
  loses nothing — an unusually safe migration.
- **Convex does not exist in this repo.** Zero references, no dependency, no `convex/`. Realtime is a
  native WebSocket inside the Render Express process. The brief's Convex phase is N/A.
- **Cloudflare MCP is read-only.** `POST /zones` → `403` (`com.cloudflare.api.account.zone.create`),
  `PUT …/r2/buckets/{b}/cors` → `403`, `GET /user/tokens` → `403`. Zone creation, DNS writes and the R2
  CORS fix all need the owner's dashboard or a re-scoped token. This was discovered by *attempting* the
  operations, not by assuming.
- **Render MCP exposes no custom-domain operation and no env read.** `api.velnox.live` must be attached
  in the Render dashboard by the owner.
- **Live R2 CORS defect (pre-existing):** the storefront customers use is `https://www.velnox.live`
  (apex 308 → www, verified over HTTP). Neither `velnox.live`, `www.velnox.live` nor
  `velnox-theta.vercel.app` is in the bucket origin list ⇒ uploads from the live site are blocked at
  preflight. Still unfixed because the token cannot write.

## AI 02 review — REJECTED the first plan

AI 02 independently re-verified repo + infra and rejected the plan: verify-before-switch order,
Stripe webhook mechanism, hardcoded URLs, cookie/logout consequence, zone export, verification gates,
and the production-deploy implication of env writes (R1–R8). All corrections were applied to the task file.

Two of its findings were re-verified here before acceptance:

- **One `STRIPE_WEBHOOK_SECRET` only** (`backend/lib/payment-config.ts:177,254` → `stripe.ts:2605,2657`).
  A second endpoint with its own `whsec` would fail verification, so PHASE 9 was rewritten to **edit the
  existing endpoint's URL** instead of adding one.
- **Three hardcoded legacy hosts** (`SellerProfile.tsx:287`, `ShopProfile.tsx:93-94`).

## What was executed

- Added three Vercel custom domains, all returning `verified: true`:
  `shop.velnox.live` → `velshop`, `seller.velnox.live` → `velseller`, `center.velnox.live` → `velcenter`.
  The apex was deliberately **not** moved: `velnox.live` is still the live storefront on `velshop`.
- Read the authoritative DNS targets from Vercel `get_domain_config`:
  CNAME rank 1 `b04e1ed0b385c8f3.vercel-dns-017.com`, A rank 1 `216.198.79.1` / `64.29.17.1`.
  No target was guessed.
- Fixed the three hardcoded hosts to use `SITE_URLS` (R3). Behaviour is identical today because the
  `SITE_URLS` defaults equal the strings that were removed.
- Verification: `git diff --check` clean · `bun run typecheck` 4/4 exit 0 · `bun run i18n:check`
  th/en/my 2235 at parity · `bun run test` **1420 pass / 425 skip / 0 fail** (1845 tests, 101 files).

## What is blocked and why

| Blocker | Owner action needed |
|---|---|
| Cloudflare zone for `velnox.live` | create zone in dashboard (token lacks `zone.create`); optional: re-scope token |
| Nameservers | change at GoDaddy for `velnox.live` **only** — never another domain in that account |
| `api.velnox.live` | add the custom domain in Render (no MCP operation) |
| R2 CORS (live defect + new origins) | edit the bucket CORS rule in the dashboard |
| Google OAuth origins/redirect | update the Google Console before the env value changes |

## Deliberate decisions

- **Apex mapping = Corporate, storefront → `shop.`** (owner delegated the choice). Justified because
  `velnox.live` was attached to the storefront only on 2026-11-09 (`createdAt 1794246693`), so SEO
  equity is ~0 and the swap costs nothing now, while a later swap would not.
- **No env value was written.** Switching `VITE_*_URL` before the new hosts resolve would send OAuth and
  Stripe returns to a host that does not exist (R1). Env writes also rebuild/restart production (R8).
- **No Neon, R2 object, Stripe mode, or service was touched.** Nothing destructive was attempted.

## Rollback readiness

Every change so far is additive and reversible: remove the three Vercel custom domains, revert the two
code edits. No DNS, env, R2, Stripe or database state has changed. The DNS record table in the task file
(PHASE 1) is the only snapshot that exists, because GoDaddy DNS is not exposed by any MCP — an env
baseline must be captured by the owner before PHASE 5 or rollback of that layer is impossible.

## Addendum — canonical domain aligned in source

The Corporate site advertised `support@ / privacy@ / legal@ / careers@velnox.com`, and the VelCenter
employee form used a `somchai@velnox.com` placeholder — all on a domain the project does not own.
Every `velnox.com` occurrence in `apps/`, `backend/` and `packages/` source was changed to `velnox.live`
(user-facing strings and the doc comments that named the canonical domain), so the codebase no longer
asserts a domain that is not under the owner's control.

This is what made the original brief wrong about the main domain; leaving it in comments would let the
same false premise be reintroduced.

**Honest caveat:** `velnox.live` publishes no `MX` record, so mail to these addresses still does not
deliver. The change makes the address correct-by-domain so that adding mail later works; it does not
create a mailbox.

Re-verified after the change: `git diff --check` clean · typecheck 4/4 exit 0 · i18n parity 2235×3 ·
`bun run test` 1420 pass / 425 skip / 0 fail.

Cloudflare zone creation was retried once after the owner said to proceed: still `403`
`com.cloudflare.api.account.zone.create`. The blocker is the token scope, not the request.
