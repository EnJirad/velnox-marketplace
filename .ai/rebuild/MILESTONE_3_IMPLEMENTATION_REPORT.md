# Velnox Rebuild — Milestone 3 Implementation Report
**Date:** 2026-11-22
**Milestone:** Milestone 3: Modular Backend Core & Unified Dual-Token Auth
**Status:** COMPLETED & VERIFIED

---

## 1. บทสรุปการดำเนินงาน (Executive Summary)

ใน Milestone 3 ได้ดำเนินการวางรากฐาน **Modular Monolith Core Architecture** และพัฒนาระบบยืนยันตัวตนแบบ **Unified Dual-Token Authentication** ที่สามารถให้บริการทั้ง Web Applications และ Mobile Applications ได้อย่างปลอดภัยและสมบูรณ์แบบ:

1. **Modular Backend Core Architecture (`backend/src/core/`):**
   - พัฒนา Standard Error Hierarchy (`AppError`, `UnauthorizedError`, `ForbiddenError`, `ValidationError`, `ConflictError`, `TokenExpiredError`, `TokenRevokedError`)
   - พัฒนาระบบ Pure Cryptographic HS256 JWT ใน [backend/src/core/security/jwt.ts](file:///workspace/quiet-hopper/backend/src/core/security/jwt.ts) โดยใช้ `node:crypto` แบบ Zero-dependency รองรับ Edge Runtime (Cloudflare Workers / Web Crypto)
   - พัฒนาระบบ Password Hashing ใน [backend/src/core/security/password.ts](file:///workspace/quiet-hopper/backend/src/core/security/password.ts) ด้วย `$scrypt$16384$8$1$salt$hash` สอดคล้องกับมาตรฐานความปลอดภัยเดิมของระบบ 100%
   - พัฒนา Cloudflare Turnstile Verification Gate ใน [backend/src/core/security/turnstile.ts](file:///workspace/quiet-hopper/backend/src/core/security/turnstile.ts) ป้องกันบอทและการโจมตีแบบ Brute-force

2. **ระบบยืนยันตัวตนแบบ Dual-Token Strategy (`DualTokenService`):**
   - **Access Token:** JWT อายุสั้น (15 นาที / 900 วินาที) สำหรับยืนยันตัวตนในการเรียกใช้งาน API ทุกเส้น บรรจุ `userId`, `email`, `role`, และ Unique `jti`
   - **Refresh Token:** JWT อายุยาว (30 วัน / 2,592,000 วินาที) สำหรับการขอต่ออายุ Access Token ใหม่ บรรจุ Unique `jti` และ `familyId`
   - **Refresh Token Rotation:** ทุกครั้งที่มีการใช้ Refresh Token ระบบจะทำการออก Token คู่ใหม่ทันที และเพิกถอน (Revoke) `jti` ของ Refresh Token เดิมลงในฐานข้อมูล [backend/src/modules/identity/repository/token-repository.ts](file:///workspace/quiet-hopper/backend/src/modules/identity/repository/token-repository.ts)
   - **Token Reuse Detection:** หากมีการนำ Refresh Token ที่เคยถูกหมุนเวียนไปแล้วมาใช้งานซ้ำ ระบบจะปฏิเสธด้วย `TokenRevokedError` ทันทีเพื่อป้องกันการโจมตีขโมย Session

3. **โมดูล Identity Domain & Services (`backend/src/modules/identity/`):**
   - โครงสร้าง 4 เลเยอร์ตามกฎ Domain Invariants:
     - `domain/`: User Entity, UserRole (`customer`, `seller`, `admin`, `owner`, `staff`), UserStatus
     - `repository/`: `UserRepository` และ `TokenRepository` (Neon PostgreSQL)
     - `services/`: `IdentityService` จัดการ Register, Login, Refresh, Logout, และ Profile
     - `routes/`: `AuthController` ส่งมอบ **Dual Response**:
       - สำหรับ Web Browsers: ตั้งค่า Cookie `Set-Cookie: velnox_session=<token>; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=900`
       - สำหรับ Mobile Apps: แนบ `AuthTokens` (`accessToken`, `refreshToken`, `tokenType: "Bearer"`, `expiresIn: 900`) ใน JSON Response Body ตามมาตรฐาน API Contract v1

4. **Authentication Middleware (`backend/src/core/middleware/auth-middleware.ts`):**
   - ตรวจสอบ Token จากทั้ง `Authorization: Bearer <token>` และ Cookie `velnox_session` อัตโนมัติ
   - ตรวจสอบความถูกต้องของ Signature, Expiration, และตรวจสอบสถานะใน Token Revocation Database
   - ตรวจสอบสิทธิ์บทบาทผู้ใช้งานด้วย `assertUserRole`

---

## 2. ผลการทดสอบ (Quality Gate & Test Verification)

การทดสอบแบบ Automated ผ่านการรับรอง 100% (29/29 tests passed):

1. **`Core Security — Pure Cryptographic JWT` (5 passed):**
   - ตรวจสอบการ Sign และ Verify Token ถูกต้อง
   - ปฏิเสธ Token ที่ Signature ไม่ตรงหรือ Secret ผิด
   - ตรวจจับ Token ที่หมดอายุอย่างถูกต้อง
   - ปฏิเสธ Malformed Token
   - ตรวจจับการปลอมแปลงแก้ไข Payload กลางทาง
2. **`Core Security — Password Hashing (scrypt)` (4 passed):**
   - แฮชรหัสผ่านในฟอร์แมต `$scrypt$` มาตรฐาน
   - ยืนยันรหัสผ่านที่ถูกต้องสำเร็จ
   - ปฏิเสธรหัสผ่านที่ไม่ถูกต้อง
   - ป้องกัน Timing Attack ด้วย `timingSafeEqual`
3. **`Core Security — DualTokenService` (4 passed):**
   - สร้าง Access Token (15m) และ Refresh Token (30d) ถูกต้อง
   - ปฏิเสธการนำ Access Token ไปใช้เป็น Refresh Token
   - ปฏิเสธการนำ Refresh Token ไปใช้เป็น Access Token
   - รักษาค่า `familyId` ต่อเนื่องในการทำ Rotation
4. **`Identity Module — IdentityService` (6 passed):**
   - สมัครสมาชิกใหม่และส่งมอบ Dual Tokens สำเร็จ
   - ปฏิเสธการสมัครด้วยอีเมลซ้ำ (`EMAIL_EXISTS`)
   - ล็อกอินด้วยอีเมลและรหัสผ่านสำเร็จ
   - ปฏิเสธรหัสผ่านที่ไม่ถูกต้อง
   - ทดสอบ Refresh Token Rotation สำเร็จ และปฏิเสธ Token ที่ถูกใช้ซ้ำ
   - ทดสอบ Logout และเพิกถอน Token ใน TokenRepository
5. **`Identity Module — Auth Middleware` (6 passed):**
   - ถอดรหัส Token จาก Header `Authorization: Bearer`
   - ถอดรหัส Token จาก Cookie `velnox_session`
   - ยืนยันตัวตนสำเร็จทั้งสองช่องทาง
   - ปฏิเสธ Token ที่ถูก Revoke แล้ว
   - ตรวจสอบสิทธิ์ Role Guard (`assertUserRole`) สำเร็จ
6. **`Identity Module — AuthController` (4 passed):**
   - ทดสอบ Register: ตั้งค่า Cookie สำหรับ Web และส่ง `AuthTokens` ใน Body สำหรับ Mobile
   - ทดสอบ Login: ตอบกลับรูปแบบ Standard ApiResponse
   - ทดสอบ Refresh: ทำ Token Rotation และออก Cookie ใหม่
   - ทดสอบ Logout: เคลียร์ Cookie และ Revoke Token
