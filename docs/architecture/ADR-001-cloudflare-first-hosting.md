# Architecture Decision Record (ADR)
## ADR-001: Cloudflare-First Unified Edge Hosting & Deprecation of Vercel Target

**Status:** APPROVED
**Date:** 2026-11-22
**Deciders:** Principal Software Architect, Full-Stack Engineering Team, Project Owner
**Applies To:** Entire Velnox Marketplace Ecosystem (Shop, Seller, Center, Corporate, Backend API)

---

### 1. Context & Problem Statement (บริบทและปัญหา)

ระบบเดิมของ Velnox Marketplace กระจายตัวอยู่บน 4 ผู้ให้บริการอิสระ (Vendor Sprawl):
1. **Frontends (4 แอป):** โฮสต์บน Vercel (`velshop.vercel.app`, `velseller.vercel.app`, `velcenter.vercel.app`, `velnox-theta.vercel.app`)
2. **Backend API:** โฮสต์บน Render Container (`velnox-api.onrender.com` — Express + in-memory WebSockets)
3. **Database:** Neon PostgreSQL Serverless
4. **Media Storage:** Cloudflare R2 (เข้าถึงผ่าน AWS S3 SDK บน Render)

**ปัญหาที่พบ:**
- **Network Latency & Multiple Hops:** ผู้ใช้เรียก Vercel Edge (US) → ยิง Request ไปยัง Render Container (Frankfurt/Oregon) → Render ดึงข้อมูลจาก Neon (AWS us-east-2) และ R2 ก่อให้เกิด Latency สะสมกว่า 500ms–1.5s ต่อ Request
- **In-Memory Realtime Limitation:** WebSocket บน Render ไม่สามารถสเกลแบบ Multi-instance ได้โดยปราศจาก Redis Backplane
- **CORS & Cookie Mismatch:** โดเมนที่ต่างกันระหว่าง Vercel (`.vercel.app`) และ Render (`.onrender.com`) จำเป็นต้องใช้ `SameSite=None` และเสี่ยงต่อปัญหา Third-party Cookie Blocker ในเบราว์เซอร์ยุคใหม่
- **High Operational Costs:** จ่ายค่าบริการแยก 4 ที่ โดย Render คิดค่าคอมพิวต์ตามชั่วโมง Container แม้ไม่มีทราฟฟิก

---

### 2. Decision (การตัดสินใจ)

เราตัดสินใจเลือก **Cloudflare** เป็นแพลตฟอร์มหลักอันดับหนึ่ง (Cloudflare-First Unified Platform) สำหรับการ Rebuild สถาปัตยกรรมใหม่ทั้งหมดของ Velnox:

1. **Frontend Hosting:** ใช้ **Cloudflare Pages** เป็นโฮสติ้งหลักสำหรับเว็บแอปพลิเคชันทั้ง 3 ตัว:
   - Velnox Shop: `shop.velnox.live`
   - Velnox Seller: `seller.velnox.live`
   - Velnox Center: `center.velnox.live`
   - Velnox Corporate: `velnox.live`
2. **Backend API:** ใช้ **Cloudflare Workers (TypeScript + Hono)** เป็น Target API Gateway & Modular Monolith:
   - Target Domain: `api.velnox.live`
   - API Versioning: `/api/v1/*`
3. **Primary Relational Database:** **Neon PostgreSQL** ยังคงเป็น Single Source of Truth สำหรับข้อมูลพาณิชย์และการเงิน ไม่ใช้ Cloudflare D1 แทน Neon และไม่สร้างฐานข้อมูลที่สอง
4. **Storage:** **Cloudflare R2** สำหรับรูปภาพ วิดีโอ และเอกสารทั้งหมด โดยเชื่อมต่อผ่าน Native Worker Bindings
5. **Supporting Infrastructure:**
   - **Cloudflare DNS, SSL/TLS, WAF & CDN:** รวมศูนย์ความปลอดภัยระดับ Edge
   - **Cloudflare KV:** สำหรับ Cache ข้อมูลความเร็วสูง (Category Tree, Announcements, Token Revocation List)
   - **Cloudflare Queues:** สำหรับ Asynchronous Background Jobs (Webhook retries, FCM push notifications)
   - **Cloudflare Durable Objects:** สำหรับ Realtime Chat & State Hub
6. **Vercel Deprecation Policy:** ถอด Vercel ออกจากเป้าหมายสถาปัตยกรรมใหม่ โดยจัดให้ Vercel เป็น **Legacy Infrastructure** เท่านั้น

---

### 3. Alternatives Considered (ทางเลือกอื่นที่พิจารณา)

| ทางเลือก | ข้อดี | ข้อเสีย | ผลการตัดสินใจ |
|---|---|---|---|
| **1. คงเดิม (Vercel + Render + Neon + R2)** | ไม่ต้องย้ายระบบโฮสติ้ง | มี Latency สูง, Vendor Sprawl, WebSocket สเกลไม่ได้, มีค่าใช้จ่ายซ้ำซ้อน | **ปฏิเสธ** |
| **2. ย้ายสู่ AWS (S3, CloudFront, ECS, RDS)** | ฟีเจอร์ครบครัน, มาตรฐานองค์กร | ซับซ้อนเกินความจำเป็น, ค่า Data Egress สูงมาก, ค่าใช้จ่ายเริ่มต้นสูง | **ปฏิเสธ** |
| **3. Cloudflare-First (Pages + Workers + R2 + Neon)** | Edge Latency ต่ำทั่วโลก, ไร้ค่า Egress R2, สเกลได้ทันที, สถาปัตยกรรมเรียบง่ายและเป็นอันหนึ่งอันเดียวกัน | ต้องปรับโครงสร้าง Backend Express ให้เข้ากับ Workers Runtime | **เลือกทางเลือกนี้** |

---

### 4. Compatibility Audit (การตรวจสอบความเข้ากันได้)

จากการตรวจสอบทางเทคนิคพบว่า:
1. **Frontend Applications (Shop, Seller, Center, Corporate):**
   - ทั้ง 4 แอปพลิเคชันพัฒนาด้วย React 19 + Vite 7 + Tailwind v4 + React Router v7
   - ผลลัพธ์จากการ Build เป็น **Pure Static Client Bundles** (`index.html`, `assets/*.js`, `assets/*.css`) ปราศจาก SSR หรือ Node Server Dependencies
   - มีความเข้ากันได้ 100% กับ **Cloudflare Pages Static Hosting** โดยใช้ `/* /index.html 200` สำหรับ SPA Routing
2. **Backend API (Cloudflare Workers):**
   - สามารถใช้งาน Framework Hono ซึ่งมี Latency ต่ำและรองรับ Web Standard Fetch API
   - เชื่อมต่อ Neon PostgreSQL ผ่าน `@neondatabase/serverless` (WebSocket/HTTP driver) ป้องกันปัญหา Connection Limit
   - เข้าถึง R2 ผ่าน Worker Direct Binding (`env.R2_BUCKET`) ไร้ค่า Egress และไร้ Overhead ของ S3 SDK

---

### 5. Vercel Removal & Migration Policy (นโยบายการถอด Vercel)

เพื่อความปลอดภัยสูงสุดของระบบที่กำลังให้บริการอยู่ในปัจจุบัน:
1. **ห้ามลบการตั้งค่า Vercel เดิมทิ้งทันที:** ไฟล์ `vercel.json` ในแอปและ root จะถูกคงไว้ชั่วคราวเพื่อไม่ให้กระทบเว็บโปรดักชันเดิม (`velshop.vercel.app`, ฯลฯ)
2. **ห้ามปิดการทำงานของ Vercel Production เดิม:** เว็บไซต์เดิมบน Vercel จะยังคงให้บริการต่อไปตามปกติจนกว่าระบบใหม่บน Cloudflare Pages จะผ่านการทดสอบ E2E และความปลอดภัยครบ 100%
3. **Phased DNS Cutover:** เมื่อระบบใหม่พร้อมใช้งาน จะทำการสลับ DNS Records ที่ Cloudflare ไปยัง Cloudflare Pages และ Cloudflare Workers
4. **Retirement Plan:** หลังจากยืนยันความเสถียรของระบบใหม่บน Cloudflare แล้ว จึงจะดำเนินการปลดระวาง (Decommission) โปรเจกต์บน Vercel อย่างเป็นทางการ

---

### 6. Rollback Strategy (กลยุทธ์การย้อนกลับ)

- หากพบปัญหาในระหว่างหรือหลังการสลับระบบ สามารถสลับ DNS CNAME Records กลับไปยัง Vercel (`cname.vercel-dns.com`) ได้ทันทีภายใน 60 วินาที
- ข้อมูลธุรกรรมทั้งหมดอยู่ใน Neon PostgreSQL ตัวเดิม จึงไม่มีปัญหา Data Inconsistency ในกรณี Rollback
