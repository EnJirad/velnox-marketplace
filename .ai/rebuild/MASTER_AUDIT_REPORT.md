# Velnox Marketplace — Full Repository Audit Report (Phase 1)
**Date:** 2026-11-22  
**Auditor:** Principal Software Architect & QA Engineer  
**Baseline Commit:** `ab5792565d469046eb236408a190b13306d79092` (branch `main`)  
**Scope:** Complete Codebase, Applications, Backend, Database, Security, Storage, API, CI/CD, and Mobile Compatibility.

---

## 1. Executive Summary (บทสรุปสำหรับผู้บริหาร)

การตรวจสอบระบบ Velnox Marketplace อย่างละเอียดรอบด้านพบว่า ระบบปัจจุบันมีรากฐานข้อมูลที่ดีในส่วนของ **Neon PostgreSQL Schema** (62 ตารางพร้อม Foreign Keys และ Constraints) และการคำนวณทางการเงินบางส่วนที่มีความเข้มงวดสูง อย่างไรก็ตาม ระบบเผชิญกับ **ปัญหาคอขวดเชิงโครงสร้างและหนี้ทางเทคนิคขั้นวิกฤต (Critical Architectural Debt)** หลายประการที่ขัดขวางการเติบโต การรองรับ Mobile App และการสเกลสู่ Production:

1. **Monolithic Route Files:** โค้ด Backend ใน `backend/routes/` มีขนาดใหญ่ผิดปกติ (เช่น `products.ts` ~4,009 บรรทัด, `stripe.ts` ~3,122 บรรทัด, `cart.ts` ~2,152 บรรทัด) ซึ่งอัดแน่นไปด้วย Business Logic, Direct SQL Queries, Validation, Push Notification, และ State Formatting ผสมปนเปกันอย่างไร้ระเบียบ
2. **Frontend Mega-Components:** หน้าจอสำคัญมีขนาดใหญ่เกินกว่าจะบำรุงรักษาได้อย่างปลอดภัย เช่น `Center.tsx` (2,384 บรรทัดในไฟล์เดียว) และ `ShopProductDetail.tsx` (1,792 บรรทัด)
3. **Fragmented Authentication & Cookie Dependency:** ระบบ Web Auth ผูกติดกับ Cloudflare Turnstile และ `httpOnly` cookies บนเบราว์เซอร์อย่างเหนียวแน่น ในขณะที่ Mobile App ต้องใช้เอนด์พอยต์แยกใน `mobile-auth.ts` ที่ขาด Refresh Token Rotation และ Token Blocklist แบบ Distributed
4. **Stateful In-Memory Realtime:** ระบบ WebSocket ใช้ `ws` ผูกกับ Node.js Process เดียวใน Render ไม่สามารถสเกลแบบ Multi-instance ได้ และหากเซิร์ฟเวอร์รีสตาร์ท การเชื่อมต่อและสถานะจะหลุดทันที
5. **Vendor Sprawl & Latency:** ระบบกระจายอยู่บน 4 ผู้ให้บริการ (Vercel สำหรับ Frontend 4 ตัว, Render สำหรับ Backend, Neon สำหรับ PostgreSQL, Cloudflare สำหรับ R2) ก่อให้เกิด Network Hops และ Latency สะสม
6. **Lack of Automated Migrations:** การจัดการฐานข้อมูลพึ่งพาการคัดลอกไฟล์ SQL ขนาดใหญ่ (`db/run-sqleditor.sql` 4,592 บรรทัด) ไปรันด้วยมือใน Neon SQL Editor ขาดระบบ Version-controlled Database Migration Engine ที่ปลอดภัย
7. **Missing Monorepo Standards:** `packages/shared` ขาด Entry Point (`packages/shared/src/index.ts` ไม่มีอยู่จริง) ขาด OpenAPI Spec กลาง และไม่มี Shared Validation / API Contract Package

---

## 2. Comprehensive Subsystem Audit (การตรวจสอบรายระบบ)

### 2.1 Applications Architecture (Frontend Web)

| Application | Path | Tech Stack | Status & Findings |
|---|---|---|---|
| **Velnox Shop** | `apps/velshop` | React 19, Vite 7, Tailwind v4, React Router v7 | Storefront หลัก มี 23 หน้าจอ UI/UX มี Mobile Tab Bar ที่ดี แต่หน้าจอเช่น `ShopProductDetail.tsx` (1,792 บรรทัด) และ `ShopCheckout.tsx` (1,238 บรรทัด) ซับซ้อนเกินไป มี Business Logic ปะปน |
| **Velnox Seller** | `apps/velseller` | React 19, Vite 7, Tailwind v4, React Router v7 | ระบบจัดการสำหรับผู้ขาย มี Dashboard, MyShop (825 บรรทัด), Orders, Income แยกหมวดหมู่ดี แต่ขาด Real-time Order Action Polling และเชื่อมต่อ Socket แบบ Manual |
| **Velnox Center** | `apps/velcenter` | React 19, Vite 7, Tailwind v4, React Router v7 | Admin Portal ที่รวมทุกอย่างไว้ในไฟล์ยักษ์ `Center.tsx` (2,384 บรรทัด) ทำให้ Render ช้า แก้ไขเสี่ยงต่อ Regression ขาดการแยกโมดูลย่อย |
| **Velnox Corporate**| `apps/velnox` | React 19, Vite 7, Tailwind v4, React Router v7 | เว็บประชาสัมพันธ์องค์กร เป็น Static content เหมาะสมดี ไม่จำเป็นต้องมี State ซับซ้อน |

### 2.2 Backend Architecture & APIs

- **Framework:** Express 4.21 + tsx รันบน Node.js 24 (Render Web Service)
- **Routes Inspection:**
  - `products.ts`: 4,009 บรรทัด — จัดการทั้ง Product CRUD, Categories, Option Groups, Attributes, Banners, Search
  - `stripe.ts`: 3,122 บรรทัด — รวม Checkout Sessions, Webhooks, Refunds, Plan subscriptions, Replay guards
  - `cart.ts`: 2,152 บรรทัด — รวม Cart management, Stock reservation, Multi-shop grouping, Direct SQL mutations
  - `center.ts`: 1,554 บรรทัด — Admin mutations, Moderation, Settlements, Staff management
- **Realtime:** โมดูล `backend/realtime/index.ts` ใช้ WebSocket Server ผูกกับ Node HTTP Server การส่งข้อความใช้ in-memory client map ไม่รองรับ Horizontal Scale
- **Background Jobs:** ใช้ `setInterval` ใน `backend/jobs/payment-reservation-scheduler.ts` (รันทุก 60 วินาที) เสี่ยงต่อ Duplicate Execution หาก Render รันมากกว่า 1 Container

### 2.3 Database & Data Integrity (Neon PostgreSQL)

- **จำนวนตาราง:** 62 ตารางใน `db/schema.sql` (1,779 บรรทัด)
- **จุดแข็ง:**
  - มี Foreign Keys ครบถ้วน พร้อม ON DELETE RESTRICT / CASCADE อย่างมีเหตุผล
  - การจัดการเงินใช้ `NUMERIC(12,2)` และ `BIGINT amount_minor` ในตาราง `ledger_entries`
  - มี Transaction Isolation ในขั้นตอน Checkout และ Payment Webhooks
  - มีตารางตรวจสอบการทุจริตและการทำซ้ำ: `checkout_requests` (Idempotency Key), `payment_events`, `payment_incidents`
- **จุดอ่อนและหนี้ทางเทคนิค:**
  - `orders.status` รองรับ 12 ค่าที่ผสมผสาน 3 โดเมน (Payment, Order State, Fulfillment) ทำให้สถานะคลุมเครือ
  - ขาด Database Migration CLI (ใช้ไฟล์ additive reconciler `run-sqleditor.sql` 4,592 บรรทัด ซึ่งต้องก๊อปปี้ไปรันด้วยมือ)
  - สต็อกสินค้าแยกเป็นสองจุด: `inventory.quantity` สำหรับสินค้าทั่วไป และ `product_variants.stock` สำหรับ Variants ซึ่งยังไม่มี Trigger หรือ Entity บังคับความสอดคล้อง

### 2.4 Authentication & Security Architecture

- **Web Flow:** Google OAuth 2.0 พร้อม Nonce verification ส่ง Cookie `velnox_session` (JWT) แบบ `httpOnly`, `Secure`, `SameSite=None`
- **CSRF Protection:** มี `createOriginGuard` ตรวจสอบ Origin Header เทียบกับ Whitelist
- **Rate Limiting:** มี Token-bucket / Sliding window ใน `backend/middleware/rate-limit.ts` ป้องกันการ Brute force
- **Mobile Gap:** `backend/routes/mobile-auth.ts` รองรับ Google ID Token (`oauth2.googleapis.com/tokeninfo`) และส่ง Bearer Token แต่ขาด:
  - Refresh Token Rotation และ Session Expiration Policy ที่ชัดเจน
  - Device Fingerprinting & Revocation ต่อเครื่อง
  - Multi-Factor Authentication (MFA) สำหรับสิทธิ์ Admin/Center

### 2.5 Storage Infrastructure (Cloudflare R2)

- ใช้ AWS S3 SDK (`@aws-sdk/client-s3`) เพื่อสร้าง Presigned PUT URLs
- อัปโหลดจาก Client โดยตรงไปที่ R2 แล้วกดยืนยัน (`/api/upload/confirm`)
- Backend มีการใช้ `HeadObjectCommand` ตรวจสอบว่ามีไฟล์อยู่จริงและขนาดไม่เกินกำหนด ก่อนบันทึกลงตาราง `media`
- **หนี้ทางเทคนิค:** รัน Node.js บน Render แล้วเชื่อมต่อ R2 ผ่าน S3 Protocol ข้าม Region ทำให้เกิด Overhead และหน่วงเวลา หากย้าย Backend ไปยัง Cloudflare Workers จะสามารถใช้ Native R2 Bindings ที่รวดเร็วกว่า ปลอดภัยกว่า และไร้ค่า Data Egress

### 2.6 Mobile Compatibility Analysis (`velnox-mobile`)

จากการตรวจสอบโครงสร้างแอป Android ใน `velnox-mobile` (Kotlin, Jetpack Compose, Retrofit, Hilt):
1. **API Envelope Inconsistency:** Backend เดิมตอบผลลัพธ์บางเส้นเป็น Array บางเส้นเป็น `{ success: true, data: ... }` และ Error บางเส้นเป็น `{ error: string }` ส่งผลให้ Moshi/Retrofit ใน Android parse ข้อมูลผิดพลาดได้ง่าย
2. **Push Notification:** ระบบปัจจุบันส่งเฉพาะ Web Realtime Socket แต่ไม่มี Push Notification Architecture (FCM สำหรับ Android) เมื่อมีคำสั่งซื้อใหม่หรืออัปเดตสถานะพัสดุ
3. **Session Lifecycle:** Mobile ไม่สามารถใช้ Browser Cookies ได้อย่างมีเสถียรภาพ จำเป็นต้องมี Dual-Token Strategy (Access Token 15 นาที + Refresh Token 30 วัน)
4. **Deep Linking:** ยังไม่มีการกำหนด URL Scheme / App Links Mapping ที่เป็นมาตรฐานเพื่อเปิดจากหน้าเว็บไปยังแอปพลิเคชัน

---

## 3. Reusability Matrix (การประเมินส่วนที่นำมาใช้ซ้ำ vs สร้างใหม่)

| โมดูล / ระบบ | สถานะ | ข้อแนะนำทางสถาปัตยกรรม |
|---|---|---|
| **Database Relational Schema** | นำกลับมาใช้ได้ 90% | คง 62 ตารางเดิมไว้ ยกระดับระบบ Migration ให้เป็น Version-controlled Scripts |
| **Financial & Ledger Logic** | นำกลับมาใช้ได้ 95% | โมดูล `money.ts`, `ledger.ts`, `order-lock.ts` มีความถูกต้องสูง คง Business Invariants ไว้ |
| **Inventory State Machine** | นำกลับมาใช้ได้ 85% | ผนวก `product_variants.stock` เข้าสู่ `inventory_movements` และ `inventory` ให้สมบูรณ์ |
| **UI Components (packages/shared)** | นำกลับมาใช้ได้ 80% | ดีไซน์โทเคน `VELNOX_DESIGN_THEME.md` และ Radix UI Primitives สวยงามและถูกต้อง นำมาจัดโครงสร้างแพ็กเกจใหม่ |
| **Backend Express Server** | **REBUILD** | สลายไฟล์ยักษ์ 4,000 บรรทัด แปลงเป็น Modular Monolith รองรับ Cloudflare Workers API |
| **Realtime WebSockets** | **REBUILD** | ย้ายจาก in-memory Node `ws` ไปเป็น Cloudflare Durable Objects / Server-Sent Events |
| **Shared Packages Structure** | **REBUILD** | สร้าง `packages/api-contract` (OpenAPI/Zod), `packages/shared-types`, `packages/api-client` |
| **Center Frontend Monolith** | **REBUILD / REFACTOR** | แยก `Center.tsx` ออกเป็นแท็บและฟีเจอร์ย่อยเพื่อความ Maintainable |

---

## 4. สรุปผล Phase 1

การตรวจสอบใน Phase 1 สิ้นสุดลงโดยสมบูรณ์ ไม่มีการแก้ไขโค้ดที่ทำลายระบบเดิม ข้อมูลและข้อเท็จจริงทั้งหมดถูกรวบรวมเพื่อนำไปจัดทำ **Architecture Blueprint** และ **Development Roadmap** ในขั้นตอนถัดไป

---

## 5. Hosting Alignment & Architectural Decision (ADR-001)

### 5.1 สรุปการตัดสินใจเลือก Cloudflare-first Hosting (ADR-001)
เพื่อแก้ไขปัญหาความซับซ้อนของการกระจายตัวหลายผู้ให้บริการ (Vendor Sprawl: Vercel + Render + Neon + Cloudflare) และลด Latency สะสม โครงการได้รับการอนุมัติให้ปรับสถาปัตยกรรมสู่ **Cloudflare-first Platform**:
1. **Cloudflare Pages:** โฮสต์ Frontend Web Applications ทั้งหมด 4 แอปพลิเคชัน (`shop.velnox.live`, `seller.velnox.live`, `center.velnox.live`, `velnox.live`)
2. **Cloudflare Workers:** รัน API Gateway & Modular Monolith (`api.velnox.live`)
3. **Cloudflare R2:** จัดเก็บสื่อและไฟล์สินค้า ไร้ค่า Data Egress พร้อม Native Worker Bindings
4. **Cloudflare KV, Queues & Durable Objects:** Distributed Cache, Asynchronous Queues, และ Realtime WebSocket Hub
5. **Neon PostgreSQL (คงเดิม):** ยังคงเป็น Single Source of Truth เพียงหนึ่งเดียวสำหรับธุรกรรมการเงิน สต็อก และข้อมูลหลัก ไม่อนุญาตให้ใช้ Cloudflare D1 เนื่องจากข้อจำกัดด้าน ACID Transactions และ Concurrency Isolation

### 5.2 ผลการตรวจสอบความเข้ากันได้ของ Frontend กับ Cloudflare Pages (Pages Compatibility Audit)
- **สถาปัตยกรรม Frontend ทั้ง 4 แอป (`apps/velshop`, `apps/velseller`, `apps/velcenter`, `apps/velnox`):**
  - พัฒนาด้วย React 19 + Vite 7 + Tailwind CSS v4 + React Router v7
  - Build Output เป็น 100% Client-side Static SPA Bundles (`index.html`, `assets/*.js`, `assets/*.css`)
  - **ไม่มี Node.js Server Runtime, SSR หรือ Middleware เฉพาะของ Vercel:** เข้ากันได้กับ Cloudflare Pages 100%
  - การกำหนดค่า Routing บน Cloudflare Pages ทำผ่านไฟล์ `_routes.json` หรือกติกา SPA Routing (`/* /index.html 200`) ได้อย่างราบรื่นและมีประสิทธิภาพสูงสุด

### 5.3 ผลการตรวจสอบความเข้ากันได้ของ Backend กับ Edge Runtime (Backend Runtime Audit)
- **Backend ปัจจุบัน (Express 4.21 บน Node.js 24):**
  - มีการใช้ In-memory WebSocket (`ws`), Node `http.Server`, Node `crypto` แบบเก่า, และ `@aws-sdk/client-s3`
  - ไม่สามารถย้ายไปรันบน Cloudflare Workers ได้โดยตรงทันทีโดยไม่ปรับสถาปัตยกรรม
- **แผนการปรับปรุงสู่ Edge Runtime (Target Workers Architecture):**
  - พัฒนา API Gateway และ Route Handlers ใหม่ด้วย **Hono** (Web Standards `Request`/`Response`)
  - แทนที่ In-memory WebSocket ด้วย **Cloudflare Durable Objects** สำหรับ Real-time Chat
  - แทนที่ AWS S3 SDK ด้วย **Cloudflare R2 Native Bindings** (`env.R2_BUCKET`)
  - เชื่อมต่อ Neon PostgreSQL ผ่าน **`@neondatabase/serverless`** (HTTP/WebSocket driver)
  - ในระหว่างการ Rebuild ระบบ Express บน Render จะยังคงทำหน้าที่เป็น Production Backend ควบคู่ไปจนกว่า Milestone 5 และ 8 จะแล้วเสร็จ

### 5.4 นโยบายการปลดระวาง Vercel (Vercel Retirement Policy)
- **สถานะ:** ตัด Vercel ออกจากสถาปัตยกรรมเป้าหมายใหม่ (Target Architecture)
- **การคงไว้เพื่อความต่อเนื่องของบริการ (Zero Downtime Policy):**
  - ห้ามลบไฟล์ `vercel.json` หรือการตั้งค่า Vercel เดิมในระหว่าง Milestone 1 ถึง Milestone 7 เพื่อป้องกันไม่ให้เว็บโปรดักชันเดิม (`velshop.vercel.app`, ฯลฯ) เกิดขัดข้อง
- **ขั้นตอนการสลับระบบ:**
  1. ติดตั้งและทดสอบ Preview Deployments บน Cloudflare Pages ใน Milestone 6
  2. ดำเนินการ E2E Testing และสลับ Cloudflare DNS Records ใน Milestone 8
  3. ปลดระวางและลบการเชื่อมต่อ Vercel อย่างเป็นทางการหลังระบบ Cloudflare Pages เสถียร 100%
