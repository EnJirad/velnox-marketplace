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

### 2.1 Cloudflare Edge Stack
1. **Cloudflare Pages:** โฮสต์เว็บแอปพลิเคชัน SPA/SSR ทั้ง 4 ตัว รวดเร็ว รองรับ Global CDN Caching และ Automatic Preview Deployments
2. **Cloudflare Workers (Backend API):** ย้าย API Gateway และ Modular Monolith สู่ Workers Runtime ไร้ปัญหา Cold Start ของ Container, รองรับ V8 Isolates ทำงานได้ทั่วโลกด้วย Latency ต่ำ
3. **Cloudflare R2 Storage:** สำหรับจัดเก็บรูปภาพและเอกสารทั้งหมด เชื่อมต่อผ่าน Worker Direct Bindings ไร้ค่า Egress Fees
4. **Cloudflare KV:** แคชสำหรับ System Settings, Global Annoucements, Category Tree และ Token Revocation Blocklist ที่ต้องการความเร็วระดับ Sub-millisecond
5. **Cloudflare Queues:** จัดการ Asynchronous Background Workflows เช่น:
   - Webhook Retries & Dead Letter Queue
   - Email / Push Notification Dispatch (FCM)
   - Daily Financial Reconciliation Jobs
   - Media Post-Processing
6. **Cloudflare Durable Objects:** จัดการการเชื่อมต่อ WebSocket Real-time สำหรับระบบแชทและการแจ้งเตือน เพื่อรักษา In-Memory State เฉพาะห้องหรือกลุ่มผู้ใช้โดยสามารถสเกลได้อย่างอิสระทั่วโลก

### 2.2 Neon PostgreSQL (The Single Source of Truth)
- ทุกธุรกรรมพาณิชย์ การเงิน และความปลอดภัยต้องอยู่ใน Neon PostgreSQL เท่านั้น
- เชื่อมต่อผ่าน `@neondatabase/serverless` (WebSocket/HTTP driver) ป้องกันปัญหา Connection Exhaustion บน Serverless
- บังคับใช้ Foreign Keys, Check Constraints, Row Locking (`FOR UPDATE NOWAIT`) และ Database Transactions อย่างเคร่งครัด

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