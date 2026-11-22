# Velnox Marketplace — Master Architecture Blueprint
**Version:** 3.0.0 (Rebuild Blueprint)  
**Date:** 2026-11-22  
**Status:** APPROVED FOR IMPLEMENTATION  
**Pattern:** Modular Monolith + Monorepo + API-First + Edge Native

---

## 1. High-Level System Architecture (ภาพรวมสถาปัตยกรรมระบบ)

```
                            ┌──────────────────────────────────────────────┐
                            │          Cloudflare Global Anycast Edge      │
                            │   (WAF, DDoS Shield, SSL/TLS, CDN, DNS)      │
                            └──────────────────────┬───────────────────────┘
                                                   │
                ┌──────────────────────────────────┴──────────────────────────────────┐
                │                                                                     │
   [ Cloudflare Pages ] (Frontends)                                     [ Cloudflare Workers ] (Backend API)
   ┌──────────────────────────────────┐                                 ┌──────────────────────────────────┐
   │ • VelShop   (velshop.velnox.live)│                                 │ • Velnox Modular Monolith API    │
   │ • VelSeller (seller.velnox.live) │                                 │   (/api/v1/*)                    │
   │ • VelCenter (center.velnox.live) │──── HTTPS (Credentials: Bearer) ───►│ • OpenAPI Contract Enforced    │
   │ • Corporate (velnox.live)        │                                 │ • Hexagonal Domain Routing       │
   └──────────────────────────────────┘                                 └─────────────────┬────────────────┘
                ▲                                                                         │
                │                                                                         │
   [ Mobile Apps (Android) ]                                                              │
   ┌──────────────────────────────────┐                                                   │
   │ • Velnox Shop App (Kotlin)       │──── HTTPS / REST (Authorization: Bearer) ─────────┤
   │ • Velnox Seller App (Kotlin)     │                                                   │
   └──────────────────────────────────┘                                                   │
                                                                                          │
        ┌─────────────────────────────────────────────────────────────────────────────────┴────────┐
        │                                Cloudflare & Neon Data Plane                              │
        ├──────────────────────┬────────────────────────┬───────────────────┬──────────────────────┤
        │  Cloudflare R2       │  Cloudflare KV         │ Cloudflare Queues │  Durable Objects     │
        │  (Media & Documents) │  (Config / Rate Limit) │ (Background Jobs) │  (Realtime / Chat)   │
        └──────────────────────┴────────────────────────┴───────────────────┴──────────────────────┤
                                                                                                   │
                                       ┌───────────────────────────────────────────────────────────┘
                                       ▼
                       ┌───────────────────────────────┐
                       │       Neon PostgreSQL         │
                       │  (Single Source of Truth)     │
                       │  • ACID Financial Ledger      │
                       │  • 62 Relational Tables       │
                       │  • PgBouncer Connection Pool  │
                       └───────────────────────────────┘
```

---

## 2. Infrastructure Specification (เป้าหมายโครงสร้างพื้นฐาน)

> [!IMPORTANT]
> **Hosting & Infrastructure Decision (ADR-001):**
> Cloudflare ได้รับการอนุมัติให้เป็นแพลตฟอร์มหลักอันดับหนึ่ง (Cloudflare-First Unified Platform) สำหรับระบบ Rebuild ใหม่ทั้งหมด Vercel ไม่ได้เป็นส่วนหนึ่งของสถาปัตยกรรมเป้าหมายอีกต่อไป โดยการใช้งาน Vercel ในปัจจุบันถูกจัดเป็น **Legacy Infrastructure** เท่านั้น (อ้างอิง: [`docs/architecture/ADR-001-cloudflare-first-hosting.md`](file:///workspace/quiet-hopper/docs/architecture/ADR-001-cloudflare-first-hosting.md))

### 2.1 Cloudflare Edge Stack
1. **Cloudflare Pages (Frontend Hosting):** โฮสต์เว็บแอปพลิเคชัน SPA ทั้งหมดแบบ Static Hosting รองรับ Global Anycast CDN, Asset Compression, และ SPA Routing (`/* /index.html 200`):
   - **Velnox Shop:** `shop.velnox.live` (Customer Storefront)
   - **Velnox Seller:** `seller.velnox.live` (Seller Operations Dashboard)
   - **Velnox Center:** `center.velnox.live` (Marketplace Admin Control Center)
   - **Velnox Corporate:** `velnox.live` (Corporate Showcase)
2. **Cloudflare Workers (Backend API):** รัน Modular Monolith API Gateway ด้วย TypeScript + Hono ที่ความเร็วระดับ Edge Sub-millisecond:
   - Target Endpoint: `https://api.velnox.live/api/v1/*`
   - ไร้ปัญหา Cold Start ของคอนเทนเนอร์ และรองรับการสเกลแบบ Serverless ทั่วโลก
3. **Cloudflare R2 Storage:** จัดเก็บรูปภาพสินค้า ภาพโปรไฟล์ และเอกสาร ผ่าน Worker Native Bindings (`env.R2_BUCKET`) ไร้ค่า Data Egress และไม่จำเป็นต้องใช้ AWS S3 SDK
4. **Cloudflare KV:** จัดเก็บ Distributed Cache สำหรับ System Settings, Banners, Announcements, Category Tree และ Token Revocation Blocklist
5. **Cloudflare Queues:** จัดการ Asynchronous Background Workflows (Webhook retries, FCM push notifications, Financial reconciliation)
6. **Cloudflare Durable Objects:** จัดการการเชื่อมต่อ WebSocket Stateful Hub สำหรับห้องแชท Real-time และ Presence Synchronization

### 2.2 Neon PostgreSQL (The Single Source of Truth)
- Neon PostgreSQL ยังคงเป็นฐานข้อมูลหลักเพียงหนึ่งเดียว (Single Source of Truth) ของธุรกรรมการเงิน สต็อกสินค้า คำสั่งซื้อ และข้อมูลบัญชี
- **ห้ามแทนที่ Neon ด้วย Cloudflare D1** เนื่องจาก D1 ยังไม่รองรับ ACID Transaction เต็มรูปแบบ, Foreign Keys และ Concurrency Isolation ระดับที่ระบบ Marketplace ต้องการ
- ห้ามสร้างฐานข้อมูลโปรดักชันที่สองเพื่อป้องกันปัญหา Data Inconsistency
- เชื่อมต่อผ่าน `@neondatabase/serverless` (WebSocket/HTTP driver) พร้อม PgBouncer Connection Pooling

### 2.3 Legacy Vercel Retirement Policy (นโยบายปลดระวาง Vercel)
- Vercel ถูกตัดออกจากสถาปัตยกรรมเป้าหมายใหม่ (Target Architecture)
- **การคงไว้ชั่วคราว:** ไฟล์ `vercel.json` และการตั้งค่าในโปรดักชันเดิมจะถูกคงไว้เพื่อไม่ให้กระทบเว็บที่กำลังออนไลน์อยู่ (`velshop.vercel.app`, ฯลฯ)
- **ขั้นตอนการสลับระบบ:** จะย้ายขึ้น Cloudflare Pages ในช่วง Milestone 6 และทำการสลับ Cloudflare DNS เมื่อระบบใหม่ผ่าน E2E Verification 100% หลังจากนั้นจึงจะปลดระวาง Vercel อย่างเป็นทางการ

---

## 3. Modular Monolith Architecture (โครงสร้างโค้ดแบบแยกโดเมน)

เราปฏิเสธทั้ง Sprawling Microservices ที่จัดการยาก และ Spaghetti Monolith ที่ทุกอย่างปนเปกัน โดยเลือกใช้ **Modular Monolith**:

```
backend/src/
├── core/                       # Shared Kernel (Infrastructure, Database, Security, Helpers)
│   ├── database/               # Neon client, transaction wrappers
│   ├── security/               # JWT, password, Turnstile, encryption
│   └── errors/                 # Standardized AppError & Error Codes
│
└── modules/                    # Isolated Business Domains
    ├── identity/               # Users, Profiles, Addresses, Auth, Roles, Permissions
    ├── catalog/                # Categories, Products, Options, Attributes, Reviews
    ├── cart/                   # Carts, Cart Items, Pricing Calculations
    ├── checkout/               # Checkout Groups, Multi-shop split, Idempotency
    ├── orders/                 # Seller Orders, Fulfillment Orders, Line Items
    ├── fulfillment/            # Shipments, Carriers, Tracking Events
    ├── payment/                # Payment Attempts, Stripe/QR Gateways, Webhooks
    ├── ledger/                 # Financial Ledger, Double-entry Bookkeeping, Settlements
    ├── inventory/              # Inventory levels, Reservations, Stock Movements
    ├── media/                  # R2 Uploads, Presign URLs, Media confirmation
    ├── communication/          # Chat, Notifications, Announcements
    └── administration/         # Center moderation, System settings, Audit logs
```

### กฎเหล็กของแต่ละโมดูล (Domain Invariants):
1. แต่ละโมดูลมี 4 เลเยอร์ย่อย:
   - `domain/` — Data Models, Enums, Pure Business Rules (ไร้ Dependency ภายนอก)
   - `services/` — Use Cases, Transaction Coordination, Business Logic
   - `repository/` — Data Access Queries (SQL / Neon)
   - `routes/` — HTTP Controllers, Input Validation, Response Mapping
2. ข้ามโมดูลต้องเรียกผ่าน **Service Interface** ที่เปิดเผยอย่างเป็นทางการเท่านั้น ห้ามข้ามไป Query ตารางของโมดูลอื่นโดยตรงโดยไม่ผ่าน Domain Service

---

## 4. API Contract & Shared Systems (ระบบกลางและสัญญา API)

### 4.1 Monorepo Structure ใหม่
```
velnox-marketplace/
├── apps/
│   ├── shop/                   # Velnox Shop (Customer Storefront)
│   ├── seller/                 # Velnox Seller (Seller Dashboard)
│   ├── center/                 # Velnox Center (Marketplace Admin)
│   └── corporate/              # Velnox Corporate (Static Showcase)
│
├── packages/
│   ├── api-contract/           # OpenAPI Spec, Zod Schemas สำหรับ Request/Response
│   ├── api-client/             # Type-safe Fetcher สำหรับ Web และ Shared Utilities
│   ├── shared-types/           # Domain Enums, Models, Entities
│   ├── validation/             # Reusable Zod Validators (Email, Money, Phone, etc.)
│   ├── ui/                     # Design System Components (Radix, Squircle, Lucide)
│   ├── i18n/                   # Translation strings (TH, EN, MY)
│   └── config/                 # Shared Constants, Feature Flags
│
├── backend/                    # Modular Monolith Backend API (Hono / Cloudflare Workers)
├── database/                   # Version-controlled SQL Migrations & Seeds
└── infrastructure/             # Cloudflare Wrangler configs, CI/CD scripts
```

### 4.2 Standard API Response Envelope
ทุก API Endpoint ทั้งสำหรับ Web และ Mobile จะต้องตอบกลับในรูปแบบ JSON เดียวกัน 100%:

```typescript
// ผลลัพธ์สำเร็จ (Success Response)
export interface ApiResponse<T> {
  success: true;
  data: T;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    hasMore?: boolean;
    timestamp: number;
  };
}

// ผลลัพธ์ผิดพลาด (Error Response)
export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;               // e.g. "INSUFFICIENT_STOCK", "UNAUTHORIZED"
    message: string;            // ข้อความอธิบายที่เข้าใจง่าย
    details?: Record<string, unknown> | Array<{ field: string; issue: string }>;
  };
}
```

---

## 5. Mobile Compatibility Blueprint (`velnox-mobile` First-Class)

### 5.1 Dual-Token Authentication Strategy
- **Access Token:** Short-lived JWT (15 นาที) ส่งผ่าน Header `Authorization: Bearer <token>`
- **Refresh Token:** Opaque Cryptographic Token (30 วัน) บันทึกในตาราง `refresh_tokens` ใน Neon มี `device_id`, `ip_address`, `revoked_at`
- **Web Clients:** ยังคงได้รับ `httpOnly, Secure, SameSite=Lax` Cookie เพื่อความสะดวก แต่เบื้องหลังใช้ Token Engine ตัวเดียวกัน
- **Mobile Native OAuth:** รองรับการแลก Google ID Token และ LINE Token ผ่าน `/api/v1/auth/token/exchange` เพื่อรับ Access/Refresh Tokens โดยไม่ต้องเปิด WebView

### 5.2 Mobile Resilience & Idempotency
- ทุกคำสั่งซื้อและธุรกรรมการเงินต้องแนบ Header `Idempotency-Key: <UUID>`
- ตาราง `checkout_requests` ทำหน้าที่เป็น Idempotency Cache คืนค่าคำสั่งซื้อเดิมทันทีหากมี Network Retry ซ้ำ ป้องกันการตัดเงินหรือหักสต็อกซ้ำซ้อน

### 5.3 Push Notifications Architecture
```
Event Trigger (e.g. Order Paid, Shipped)
       │
       ▼
Cloudflare Queue ("push-notifications")
       │
       ▼
Worker Consumer ──► Firebase Cloud Messaging (FCM) API ──► Android Velnox Apps
```

---

## 6. Financial & Commerce Integrity Blueprint (ความถูกต้องทางการเงิน)

1. **No Floating Point:** การคำนวณทั้งหมดใช้หน่วยสตางค์ (`amount_minor` ในตาราง `ledger_entries`) ร่วมกับ `NUMERIC(12,2)`
2. **Double-Entry Ledger:** ทุกการจ่ายเงิน คืนเงิน ค่าคอมมิชชัน และการถอนเงิน ต้องบันทึกรายการบัญชีคู่แบบ Append-Only ห้ามลบหรือแก้ไขย้อนหลัง
3. **Inventory Isolation:** แยกสถานะสต็อกสินค้าชัดเจนเป็น 5 มิติ:
   - `on_hand`: ของที่มีจริงในคลัง
   - `reserved`: ของที่ถูกจองระหว่างรอชำระเงิน (มีอายุ 30 นาที)
   - `committed`: ของที่ชำระเงินสำเร็จแล้ว รอแพ็ก
   - `fulfilled`: ของที่จัดส่งออกจากร้านแล้ว
   - `returned`: ของที่ตีกลับคืนคลัง
4. **Guarded Lock Order:** ป้องกัน Deadlock ด้วยการเรียงลำดับการ Lock แถวใน Database เสมอ:
   `checkout_groups` → `orders` (ASC) → `payments` (ASC) → `inventory` (ASC)

---

## 7. Migration & Rollout Strategy

1. **Zero Data Loss:** ไม่มีการลบฐานข้อมูล Neon เดิมเด็ดขาด ทุกขั้นตอนใช้คำสั่งที่ตรวจสอบย้อนกลับได้
2. **Backward Compatibility:** ในระหว่างการ Rebuild ระบบเดิม (Vercel + Render Express) จะยังคงให้บริการได้ตามปกติ จนกว่าระบบใหม่ (Cloudflare + Modular Monolith) จะผ่านการทดสอบ E2E และความปลอดภัยครบ 100%
3. **Phased Cutover:** สลับ Traffic ผ่าน Cloudflare DNS เมื่อระบบใหม่พร้อมใช้งานอย่างสมบูรณ์