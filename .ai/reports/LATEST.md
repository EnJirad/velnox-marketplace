# LATEST — 2026-11-22 · สำเร็จ Milestone 2: Versioned Database Migration Engine & Ledger Core
**Branch:** `main` · **Status:** DONE · สร้างระบบ Migration Engine ตรวจสอบ Checksum และ Double-Entry Ledger Core เรียบร้อย 100%

---

## 1. สรุปผลงานที่ดำเนินการใน Milestone 2

1. **ระบบ Versioned Database Migration Engine (`database/`):**
   - พัฒนา Migration Runner อัตโนมัติใน [database/src/migrator.ts](file:///workspace/quiet-hopper/database/src/migrator.ts)
   - จัดการตารางควบคุมสถานะ `_velnox_migrations` ใน PostgreSQL
   - คำนวณ Checksum ด้วย SHA-256 [database/src/checksum.ts](file:///workspace/quiet-hopper/database/src/checksum.ts) เพื่อตรวจจับการดัดแปลงไฟล์ Migration ย้อนหลัง (`MigrationTamperedError`)
   - บังคับใช้การรันแบบ Atomic Transaction (`BEGIN; ... COMMIT;` พร้อม `ROLLBACK;` เมื่อเกิดข้อผิดพลาด)
   - จัดทำ CLI Tool [database/migrate.ts](file:///workspace/quiet-hopper/database/migrate.ts) รองรับคำสั่ง `status`, `up`, และ `check-files`
   - จัดทำ Baseline Migration [database/migrations/0001_initial_schema.sql](file:///workspace/quiet-hopper/database/migrations/0001_initial_schema.sql) สอดคล้องกับ `db/schema.sql` 100%

2. **แพ็กเกจบัญชีแยกประเภทคู่ (@velnox/ledger):**
   - สร้างแพ็กเกจใหม่ [packages/ledger/](file:///workspace/quiet-hopper/packages/ledger/) สำหรับคำนวณและตรวจสอบกฎบัญชีคู่
   - กำหนดผังบัญชี canonical: `platform_cash`, `platform_revenue`, `seller_payable`, `refund_clearing`
   - บังคับใช้กฎ Invariants: $\sum \text{Debits} == \sum \text{Credits}$, ยอดเงินเป็น `bigint` satang เท่านั้น (ห้าม float), ห้ามยอดเงิน 0 หรือติดลบ
   - มี Domain Helpers สร้างธุรกรรม: Customer Charge, Seller Settlement, Customer Refund, Manual Adjustment

3. **บริการบันทึกธุรกรรมทางการเงิน (`LedgerService`):**
   - พัฒนา [backend/src/core/ledger/ledger-service.ts](file:///workspace/quiet-hopper/backend/src/core/ledger/ledger-service.ts)
   - บันทึกธุรกรรมลงตาราง `ledger_entries` ใน Neon แบบ Atomic
   - รองรับ Unique Constraint Violation `23505` บน `idempotency_key` เพื่อคืนค่าเดิมแบบ Idempotent อย่างปลอดภัย

4. **ผลการทดสอบและการประกันคุณภาพ (Quality Gate):**
   - Unit Tests ของ `@velnox/ledger` ผ่าน 8/8 ข้อ
   - Unit Tests ของ `database/migrator` ผ่าน 7/7 ข้อ
   - Unit Tests ของ `LedgerService` ผ่าน 3/3 ข้อ
   - รวมการทดสอบเข้าสู่ Contract Quality Gate ใน [backend/tests/packages-contracts.test.ts](file:///workspace/quiet-hopper/backend/tests/packages-contracts.test.ts)
   - อัปเดต `package.json` และ `bun.lock` ให้ครอบคลุม `@velnox/ledger`

---

## 2. ไฟล์ที่สร้างและเปลี่ยนแปลง

- `database/src/types.ts` *(สร้างใหม่)*: Data types สำหรับ Migration Engine
- `database/src/checksum.ts` *(สร้างใหม่)*: SHA-256 checksum calculator
- `database/src/migrator.ts` *(สร้างใหม่)*: Core Migration Engine with transaction rollback & tamper protection
- `database/migrations/0001_initial_schema.sql` *(สร้างใหม่)*: Canonical baseline schema migration
- `database/migrate.ts` *(สร้างใหม่)*: CLI migration runner (`status`, `up`, `check-files`)
- `database/tests/migrator.test.ts` *(สร้างใหม่)*: Automated unit tests สำหรับ Migration Engine
- `packages/ledger/*` *(สร้างใหม่)*: Package `@velnox/ledger` พร้อม Invariants, Transactions, and Tests
- `backend/src/core/ledger/ledger-service.ts` *(สร้างใหม่)*: Atomic ledger persistence service with idempotency
- `backend/tests/ledger-service.test.ts` *(สร้างใหม่)*: Automated unit tests สำหรับ LedgerService
- `backend/tests/packages-contracts.test.ts` *(แก้ไข)*: เพิ่มการทดสอบ `@velnox/ledger` ใน Quality Gate
- `package.json` *(แก้ไข)*: เพิ่ม scripts `db:migrate`, `db:status`, `db:check`, `test:ledger`, `test:migrations`
- `bun.lock` *(แก้ไข)*: เพิ่มการอ้างอิง workspace สำหรับ `@velnox/ledger`
- `.ai/rebuild/MILESTONE_2_IMPLEMENTATION_REPORT.md` *(สร้างใหม่)*: รายงานผลการดำเนินงาน Milestone 2 ฉบับสมบูรณ์
- `.ai/rebuild/DEVELOPMENT_ROADMAP.md` *(แก้ไข)*: อัปเดตสถานะ Milestone 2 เป็น COMPLETED
- `.ai/AI_HANDOFF.md` *(แก้ไข)*: อัปเดตสถานะล่าสุดของโครงการ

---

## 3. ขั้นตอนถัดไป (Next Step)

ระบบมีความพร้อม 100% ในการดำเนินการ **Milestone 3: Modular Backend Core & Unified Dual-Token Auth**:
- วางรากฐาน Modular Monolith Backend (`backend/src/core/`)
- พัฒนาระบบ Unified Dual-Token Authentication รองรับ Web (httpOnly Cookies) และ Mobile (Bearer Token + Refresh Token Rotation)
