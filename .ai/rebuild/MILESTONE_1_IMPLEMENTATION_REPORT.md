# Milestone 1: Monorepo Foundation & Shared API Contract — Implementation Report
**Date:** 2026-11-22  
**Status:** COMPLETED  
**Scope:** Monorepo Workspace, Shared Packages, Zod Validation, API Contracts, OpenAPI 3.1.0 Foundation, Type-Safe API Client  

---

## 1. Executive Summary (บทสรุปการดำเนินงาน)

ใน Milestone 1 นี้ เราได้ดำเนินการจัดตั้งรากฐาน Monorepo และ Shared Packages กลางของระบบ Velnox Marketplace ใหม่ เพื่อรองรับทั้ง Web Applications (Shop, Seller, Center) และ Native Android Apps ในอนาคต โดยยึดหลัก **API-First, Platform-Agnostic, Type-Safe Contracts**:

1. **Missing Entry Point Resolved:** แก้ไขปัญหาการขาดหายไปของ `packages/shared/src/index.ts` ทำให้สามารถ Import จาก `@velnox/shared` ได้อย่างถูกต้องตามสเปก
2. **Dedicated Validation Package (`@velnox/validation`):** สร้างแพ็กเกจกลางสำหรับ Zod Validation Primitives และ Business Inputs (UUID, Phone, Money minor/decimal, Slugs, Shipping Address, Authentication, Token Exchange)
3. **Central API Contract (`@velnox/api-contract`):** สร้างมาตรฐาน Envelope สากล (`ApiResponse<T>` และ `ApiErrorResponse`) พร้อมนิยาม Schemas สำหรับ Domain v1 (Health, Auth, Categories, Products, Cart) ปราศจากการผูกติดกับ Web หรือ Mobile Framework
4. **OpenAPI 3.1.0 Specification Generator:** พัฒนาเครื่องมือสร้าง OpenAPI 3.1.0 Spec จาก Zod Contracts โดยตรง ป้องกันปัญหา Schema Drift ระหว่าง Documentation, Backend และ Mobile Clients
5. **Platform-Agnostic API Client (`@velnox/api-client`):** สร้าง Client กลางที่มี Typed Request/Response, Automatic Token Injection, Timeout Handling และ Error Envelope Unwrapping พร้อม Unit Tests ครบถ้วน
6. **Tooling & CI Quality Gates:** อัปเดต `package.json`, `bun.lock` และ `.github/workflows/test.yml` เพื่อให้ CI ตรวจสอบ Typecheck และ Unit Tests ของ Packages ใหม่ทั้งหมดโดยอัตโนมัติ

---

## 2. โครงสร้าง Packages ที่สร้างขึ้นจริง (Created Packages Structure)

```
packages/
├── shared/                     # Existing UI & Shared Components
│   └── src/index.ts            # (NEW) Canonical entry point exporting clean utils & components
│
├── config/                     # (NEW) @velnox/config
│   ├── package.json
│   ├── tsconfig.base.json      # Base TypeScript compiler settings
│   └── src/index.ts            # Shared platform constants, cookies, pagination defaults
│
├── validation/                 # (NEW) @velnox/validation
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── primitives.ts       # UUID, email, strong password, phone, money minor, slug, pagination
│   │   ├── address.ts          # Thai shipping address validation schema
│   │   ├── auth.ts             # Login, register, token refresh, mobile token exchange
│   │   └── index.ts
│   └── tests/
│       └── validation.test.ts  # Rigorous unit tests for all schemas
│
├── api-contract/               # (NEW) @velnox/api-contract
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── common/
│   │   │   ├── envelope.ts     # ApiResponse<T>, ApiErrorResponse, PaginationMeta
│   │   │   ├── errors.ts       # ApiErrorCode enum & HTTP status mapping
│   │   │   └── pagination.ts   # Paginated request/response helpers
│   │   ├── v1/
│   │   │   ├── health.ts       # Health check contract
│   │   │   ├── auth.ts         # Login, register, session, tokens, exchange contracts
│   │   │   ├── categories.ts   # Category tree & detail contracts
│   │   │   ├── products.ts     # Catalog search, filter & detail contracts
│   │   │   ├── cart.ts         # Multi-shop partitioned cart contracts
│   │   │   └── index.ts
│   │   ├── openapi/
│   │   │   ├── generator.ts    # Pure TypeScript OpenAPI 3.1.0 document builder
│   │   │   └── spec.ts         # Pre-compiled velnoxOpenApiSpec & validator
│   │   └── index.ts
│   └── tests/
│       └── contract.test.ts    # Contract validation & OpenAPI 3.1 spec tests
│
└── api-client/                 # (NEW) @velnox/api-client
    ├── package.json
    ├── tsconfig.json
    ├── src/
    │   ├── types.ts            # Client options & request configurations
    │   ├── errors.ts           # ApiClientError & classification helpers
    │   ├── client.ts           # VelnoxApiClient with typed domain resources
    │   └── index.ts
    └── tests/
        └── client.test.ts      # Client fetch, token header, error & timeout tests
```

---

## 3. รายละเอียดสัญญา API และ OpenAPI Specification (API Contracts & OpenAPI)

### 3.1 Standard JSON Response Envelope
ทุก Endpoint ในสถาปัตยกรรมใหม่ถูกบังคับใช้รูปแบบผลลัพธ์เดียวกัน:
- **Success:** `{ success: true, data: T, meta?: PaginationMeta }`
- **Error:** `{ success: false, error: { code: string, message: string, details?: unknown } }`

### 3.2 Endpoints ที่มี Contract พร้อมใช้งาน
- `GET /api/v1/health`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/token/refresh`
- `POST /api/v1/auth/token/exchange` (รองรับ Google/LINE Token จาก Android Apps)
- `GET /api/v1/auth/me`
- `GET /api/v1/categories`
- `GET /api/v1/categories/{slug}`
- `GET /api/v1/products`
- `GET /api/v1/products/{id}`
- `GET /api/v1/cart`
- `POST /api/v1/cart/items`
- `PATCH /api/v1/cart/items/{id}`
- `DELETE /api/v1/cart/items/{id}`

### 3.3 OpenAPI 3.1.0 Status
- มี `velnoxOpenApiSpec` ที่คอมไพล์จาก Zod Schemas พร้อม Security Schemes (`bearerAuth` สำหรับ Mobile/API และ `cookieAuth` สำหรับ Web)
- ผ่านการตรวจสอบความสมบูรณ์ใน `packages/api-contract/tests/contract.test.ts`

---

## 4. ความปลอดภัยและความเข้ากันได้ (Safety & Compatibility)

- **Production Database:** ไม่มีการแก้ไข หรือรันสคริปต์กระทบ Neon PostgreSQL (Zero DB Impact)
- **Existing Web Apps:** `apps/velshop`, `apps/velseller`, `apps/velcenter`, `apps/velnox` ยังคงทำงานได้ตามปกติ ไม่มีการเปลี่ยนแปลง Breaking Changes ใดๆ
- **Existing Backend:** Express Server ใน `backend/` ยังคงให้บริการตามเดิม ไม่มีการลบหรือแก้ไขโค้ดธุรกรรมเดิม
- **Mobile Compatibility:** วางรากฐาน OpenAPI และ Token Exchange Contract สำหรับแอป Android โดยไม่ต้องแตะต้อง Repository `velnox-mobile`

---

## 5. แนะนำสำหรับขั้นตอนถัดไป (Milestone 2 Recommendation)

พร้อมก้าวเข้าสู่ **Milestone 2: Versioned Database Migration Engine & Ledger Core**:
- จัดทำระบบ Automated Database Migration Scripts ที่มีหมายเลขกำกับ (เช่น `V001__baseline.sql`, `V002__ledger_extension.sql`)
- วางรากฐาน Double-Entry Ledger Core โดยคงความเข้ากันได้กับฐานข้อมูล Neon 100%