# Velnox Marketplace — Production Cutover & Infrastructure Runbook
**Version:** 3.0.0
**Target Architecture:** Cloudflare Pages (4 Frontends) ➜ Cloudflare Workers (Hono API) ➜ Neon PostgreSQL (Clean Schema) + Cloudflare R2 + Cloudflare Durable Objects

---

## 1. Executive Summary & Architecture State
This runbook guides the formal, zero-downtime production cutover of the Velnox Multi-Vendor Marketplace.
All customer, commerce, and seller functionalities have been cleanly rebuilt for edge execution without legacy Render dependencies.

### Target Infrastructure Matrix
| Component | Platform | Production Target | Egress / Hosting Cost |
|---|---|---|---|
| **VelShop** (Customer SPA) | Cloudflare Pages | `https://shop.velnox.live` | $0.00 (Unlimited Edge CDN) |
| **VelSeller** (Seller Dashboard) | Cloudflare Pages | `https://seller.velnox.live` | $0.00 (Unlimited Edge CDN) |
| **VelCenter** (Platform Console) | Cloudflare Pages | `https://center.velnox.live` | $0.00 (Unlimited Edge CDN) |
| **VelNox** (Corporate Landing) | Cloudflare Pages | `https://velnox.live` | $0.00 (Unlimited Edge CDN) |
| **Backend API** (Hono Framework) | Cloudflare Workers | `https://api.velnox.live` | Standard Workers Paid |
| **Realtime Gateway** | Cloudflare Durable Objects | `wss://api.velnox.live/ws` | Distributed Edge Coordination |
| **Media & Object Storage** | Cloudflare R2 | `https://media.velnox.live` | $0.00 (Zero Egress Fees) |
| **Primary Database** | Neon PostgreSQL | Singapore Pooler (`ap-southeast-1`) | High Availability Serverless PG |

---

## 2. Pre-Cutover Verification Checklist
Ensure each item is verified prior to DNS switch:

- [x] **Monorepo Typecheck:** `bun run typecheck:all` passes across all 4 apps, 4 packages, and Workers API.
- [x] **Contracts & Schema Verification:** `bun run test:contracts` and `bun run test:rebuild` pass with 100% success.
- [x] **Worker Test Suite:** 89/89 tests passing across 15 test suites in `workers/api`.
- [x] **Wrangler Production Bundle:** `wrangler deploy --dry-run` compiles cleanly under 1.1 MB.
- [x] **Clean Database Schema:** Migrations `0001_identity.sql` through `0005_realtime_chat.sql` applied to Neon PostgreSQL.
- [x] **Pure Integer Accounting:** Satang minor units (`BigInt`) verified with double-entry invariant `Debits === Credits`.
- [x] **CORS & Credentials:** Worker CORS configured for all `*.velnox.live` domains with `credentials: true`.

---

## 3. Production Cutover Execution (Zero Downtime)

### Step 3.1: Deploy Cloudflare Workers Backend
```bash
cd workers/api
wrangler deploy --env production
```
Verify health check immediately:
```bash
curl -I https://api.velnox.live/health
# Expected: HTTP/2 200 OK
```

### Step 3.2: Deploy Cloudflare Pages Frontends
1. In Cloudflare Dashboard ➜ **Workers & Pages**:
   - `velshop` ➜ Points to `apps/velshop/dist` ➜ Custom domain: `shop.velnox.live`
   - `velseller` ➜ Points to `apps/velseller/dist` ➜ Custom domain: `seller.velnox.live`
   - `velcenter` ➜ Points to `apps/velcenter/dist` ➜ Custom domain: `center.velnox.live`
   - `velnox` ➜ Points to `apps/velnox/dist` ➜ Custom domain: `velnox.live`
2. Ensure Single Page Application fallback is enabled via `_redirects` (`/* /index.html 200`).

### Step 3.3: DNS Switchover (Cloudflare DNS Proxy)
Ensure DNS records in Cloudflare DNS management have the orange cloud (Proxy Status: **Proxied**):
- `CNAME` `api` ➜ `velnox-api.<account>.workers.dev` (or Worker Custom Domain)
- `CNAME` `shop` ➜ `velshop.pages.dev`
- `CNAME` `seller` ➜ `velseller.pages.dev`
- `CNAME` `center` ➜ `velcenter.pages.dev`
- `CNAME` `@` ➜ `velnox.pages.dev`
- `CNAME` `media` ➜ Public R2 Bucket domain

### Step 3.4: Automated Synthetic Verification
Run the cutover test suite:
```bash
bun run cutover:verify
```

---

## 4. Rollback Plan (Contingency)
If a critical unforeseen blocker occurs during cutover:
1. **Revert DNS:** In Cloudflare DNS, re-point `api.velnox.live` CNAME back to the legacy Render origin (`velnox-api.onrender.com`).
2. **Neon DB Safety:** The Neon database schema is strictly additive and clean. Reverting DNS carries zero customer data corruption risk.
3. **Notify Platform Admin:** Post incident notice in VelCenter operations channel.

---

## 5. Render Decommission Checklist
Once the cutover verification has run cleanly for 24 hours in production:
- [ ] Spin down Render web services (`velnox-backend` and `velnox-realtime`) to 0 instances.
- [ ] Archive Render environment variables and secrets to secure vault.
- [ ] Confirm zero active traffic hitting Render endpoints via Render metrics dashboard.
- [ ] Terminate Render paid instance subscriptions to avoid recurring costs.
