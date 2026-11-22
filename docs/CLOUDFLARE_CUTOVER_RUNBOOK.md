# CLOUDFLARE PRODUCTION CUTOVER RUNBOOK & VERCEL RETIREMENT PLAN
**Velnox Marketplace Platform Rebuild — Milestone 8 Production Transition**
*Document Version: 1.0.0 | Date: 2026-11-22 | Status: Production Ready*

---

## 1. Executive Summary & Architecture Topology

This runbook outlines the zero-downtime production cutover of the Velnox Marketplace platform from legacy Vercel hosting to the modernized Cloudflare-first edge architecture (approved under ADR-001).

### Modernized Target Architecture

```
                                  [ Cloudflare Global Edge Network ]
                                                  │
                      ┌───────────────────────────┼───────────────────────────┐
                      ▼                           ▼                           ▼
            Cloudflare Pages (SPA)      Cloudflare DNS Proxy        Cloudflare R2 Storage
         ┌────────────────────────┐    ┌────────────────────────┐  ┌─────────────────────────┐
         │ shop.velnox.live       │    │ api.velnox.live        │  │ pub-01da4cea98c140f9... │
         │ seller.velnox.live     │    │ (SSL/TLS Termination,  │  │ (Product Images,        │
         │ center.velnox.live     │    │  WAF, Rate Limiting)   │  │  KYC Documents, Media)  │
         │ velnox.live (Landing)  │    └───────────┬────────────┘  └─────────────────────────┘
         └────────────────────────┘                │
                                                   ▼
                                        Backend API Gateway
                                    (Cloudflare Workers + Hono)
                          [Legacy during transition: Render Monolith]
                                                   │
                         ┌─────────────────────────┴─────────────────────────┐
                         ▼                                                   ▼
                 Neon PostgreSQL                                    Stripe Payment Rail
              (Single Source of Truth)                            (Satang Minor / Webhooks)
         - Multi-Shop Orders (`checkout_groups`)                - Pure HMAC-SHA256 Verification
         - Double-Entry Ledger (`ledger_entries`)               - Replay Protection (< 300s)
         - Inventory Conditional Reservations                   - Automated Settlement Engine
```

---

## 2. DNS Record Mapping Matrix

All DNS records are managed within Cloudflare DNS under zone `velnox.live`. Proxy status must be set to **Proxied (Orange Cloud)** to leverage Cloudflare DDoS protection, Edge SSL termination, Brotli compression, and HTTP/3 QUIC.

| Subdomain | Record Type | Target Destination | Proxy Status | Origin Service |
| :--- | :--- | :--- | :--- | :--- |
| `shop.velnox.live` | CNAME | `velnox-shop.pages.dev` | **Proxied (Orange)** | Cloudflare Pages (VelShop SPA) |
| `seller.velnox.live` | CNAME | `velnox-seller.pages.dev` | **Proxied (Orange)** | Cloudflare Pages (VelSeller SPA) |
| `center.velnox.live` | CNAME | `velnox-center.pages.dev` | **Proxied (Orange)** | Cloudflare Pages (VelCenter SPA) |
| `velnox.live` | CNAME | `velnox-landing.pages.dev` | **Proxied (Orange)** | Cloudflare Pages (Landing SPA) |
| `api.velnox.live` | CNAME / Worker Route | Cloudflare Workers Route (`api.velnox.live/*`) | **Proxied (Orange)** | Cloudflare Workers (Target Backend API) |
| `api.velnox.live` *(interim)* | CNAME | `velnox-api.onrender.com` | **Proxied (Orange)** | Render Monolith (Legacy/Transition only) |

---

## 3. SPA Client-Side Routing Configuration

All frontend SPA applications have been equipped with standard `_redirects` files in their `public/` directory to guarantee proper HTML5 pushState routing on Cloudflare Pages:

```
/*    /index.html   200
```

### Verified Target Paths:
- `apps/velshop/public/_redirects`
- `apps/velseller/public/_redirects`
- `apps/velcenter/public/_redirects`
- `apps/velnox/public/_redirects`

> [!NOTE]
> `vercel.json` files remain preserved side-by-side in each application root directory during the coexistence and soak period.

---

## 4. Zero-Downtime Cutover Checklist

### Phase 1: Pre-Cutover Preparation (T - 24 Hours)

- [ ] **TTL Reduction**: Lower DNS TTL on all existing DNS records to `300` seconds (5 minutes) 24 hours prior to cutover to ensure rapid propagation.
- [ ] **Edge SSL/TLS Pre-Issuance**:
  - In Cloudflare Dashboard > **SSL/TLS** > **Edge Certificates**, verify that Universal SSL certificates covering `velnox.live` and `*.velnox.live` are in `Active` status.
  - Set Minimum TLS Version to `TLS 1.2` or `TLS 1.3`.
- [ ] **Cloudflare Pages Custom Domains**:
  - In Cloudflare Dashboard > **Workers & Pages** > Select Project > **Custom Domains**:
    - VelShop -> Add `shop.velnox.live`
    - VelSeller -> Add `seller.velnox.live`
    - VelCenter -> Add `center.velnox.live`
    - VelNox -> Add `velnox.live`
  - Verify that Cloudflare verifies ownership and validates DNS records.
- [ ] **Environment Variables Audit**:
  - Verify that all production variables in `.env` are configured on Cloudflare Pages and Render:
    - `DATABASE_URL` (Neon PostgreSQL pooler connection string)
    - `JWT_SECRET` (Minimum 32 bytes cryptographically secure secret)
    - `STRIPE_SECRET_KEY` & `STRIPE_WEBHOOK_SECRET`
    - `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`
    - `APP_URL`, `SELLER_APP_URL`, `CENTER_APP_URL`, `SHOP_APP_URL`
- [ ] **Automated Test Gate**:
  - Run `npm run test:rebuild` — All 85 unit, integration, payment, realtime, and security tests must pass (100% PASS).

---

### Phase 2: DNS Cutover Execution Window (T - 0)

1. **Activate Cloudflare Proxied Records**:
   - Update `shop.velnox.live` CNAME to `velnox-shop.pages.dev` with Cloudflare Proxy enabled.
   - Update `seller.velnox.live` CNAME to `velnox-seller.pages.dev` with Cloudflare Proxy enabled.
   - Update `center.velnox.live` CNAME to `velnox-center.pages.dev` with Cloudflare Proxy enabled.
   - Update `velnox.live` CNAME to `velnox-landing.pages.dev` with Cloudflare Proxy enabled.
   - Ensure `api.velnox.live` routes through Cloudflare Proxy to Backend.

2. **Verify Edge Resolution & SSL Handshake**:
   ```bash
   # Test DNS resolution
   dig +short shop.velnox.live
   dig +short api.velnox.live

   # Test SSL handshake & HTTP/2
   curl -Iv https://shop.velnox.live
   curl -Iv https://api.velnox.live/health
   ```

3. **Verify SPA Fallback Routing**:
   ```bash
   # Deep link routing check (must return 200 and index.html, NOT 404)
   curl -s -o /dev/null -w "%{http_code}" https://shop.velnox.live/products/sample-id
   curl -s -o /dev/null -w "%{http_code}" https://seller.velnox.live/orders/order-id
   curl -s -o /dev/null -w "%{http_code}" https://center.velnox.live/dashboard
   ```

4. **Verify Dual-Token Session Cookie Delivery**:
   ```bash
   # Test cookie response attributes
   curl -i https://api.velnox.live/api/v1/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"test@example.com","password":"ValidPassword123!"}'
   # Check Set-Cookie headers for HttpOnly; Secure; SameSite=None
   ```

---

### Phase 3: Post-Cutover Live Health Verification (T + 0 to T + 4 Hours)

Execute synthetic end-to-end smoke tests against production endpoints:

1. **User Auth**: Register new user -> verify dual token and cookie -> login -> refresh token rotation.
2. **Cart & Multi-Shop Split**: Add items from 2 sellers -> execute checkout -> verify 2 distinct orders created under 1 `checkout_group_id`.
3. **Stripe Payment**:
   - Create Stripe checkout session.
   - Deliver Stripe webhook `checkout.session.completed`.
   - Verify raw body HMAC-SHA256 signature verification.
   - Verify stock commit and double-entry ledger postings in Neon.
4. **Realtime WebSocket**:
   - Connect client socket to `wss://api.velnox.live`.
   - Verify channel subscription (`order:<group_id>`).
   - Verify order update event delivery.
   - Verify presence tracking and chat notification suppression.
5. **Ledger Integrity**:
   - Run `LedgerDomainService.verifyLedgerIntegrity` -> confirm 0 satang discrepancy.

---

### Phase 4: Vercel Retirement & Decommissioning Plan (T + 48 to T + 72 Hours)

After a mandatory **48 to 72-hour soak period** with zero traffic anomalies or customer impact:

1. **Traffic Drain Verification**:
   - Open Vercel Dashboard for `velshop`, `velseller`, `velcenter`, and `velnox`.
   - Inspect Analytics > Requests over the last 48 hours.
   - Confirm request rate has dropped to 0 (all traffic routed via Cloudflare Pages).

2. **Detach Custom Domains in Vercel**:
   - In Vercel Project Settings > **Domains**:
     - Remove `shop.velnox.live`
     - Remove `seller.velnox.live`
     - Remove `center.velnox.live`
     - Remove `velnox.live`

3. **Archive Vercel Deployments**:
   - Pause or disable automatic Git deployment integrations in Vercel.
   - Mark Vercel projects as Archived.

4. **Rollback Safety Buffer**:
   - Keep `vercel.json` files in the repository for **30 calendar days** following successful cutover.
   - If an unforeseen edge issue arises during the first 30 days, rolling back requires only re-pointing DNS CNAMEs to `cname.vercel-dns.com`.
   - After 30 days of verified stable operation, remove `vercel.json` files as a final cleanup task.
