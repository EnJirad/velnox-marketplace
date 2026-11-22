# Velnox Rebuild — Milestone 2 Implementation Report
**Date:** 2026-11-22
**Milestone:** Milestone 2: Versioned Database Migration Engine & Ledger Core Foundation
**Status:** COMPLETED & VERIFIED

---

## 1. บทสรุปการดำเนินงาน (Executive Summary)

ใน Milestone 2 ทีมสถาปัตยกรรมได้ดำเนินการยกระดับระบบฐานข้อมูลและการเงินของ Velnox Marketplace ตามแผนงานที่ได้รับอนุมัติใน Master Architecture Blueprint:
1. **Versioned Database Migration Engine:** สร้างระบบ Migration อัตโนมัติที่มีหมายเลขเวอร์ชัน ลำดับการรันที่แน่นอน และการตรวจสอบ Checksum (SHA-256) เพื่อป้องกันการแก้ไข Migration ย้อนหลัง (Anti-tampering) พร้อมระบบ Atomic Transaction Rollback เมื่อเกิดข้อผิดพลาด
2. **Authoritative Baseline Migration (`0001_initial_schema.sql`):** ย้ายและสแนปช็อตโครงสร้าง 62 ตารางเดิมจาก `db/schema.sql` สู่ Migration แรกของระบบ โดยยังคงรักษาความสอดคล้องกับ `db/run-sqleditor.sql` ตามกฎระเบียบของระบบเดิม 100%
3. **Double-Entry Ledger Core (`@velnox/ledger`):** สร้างแพ็กเกจกลางสำหรับระบบบัญชีแยกประเภทคู่ (Double-entry bookkeeping) โดยบังคับใช้กฎ Invariants:
   - ผลรวมเดบิตต้องเท่ากับผลรวมเครดิตเสมอ ($\sum \text{Debits} == \sum \text{Credits}$)
   - ทุกยอดเงินคำนวณด้วย `bigint` Minor Satang (ห้ามใช้ Floating-point number โดยเด็ดขาด)
   - ป้องกันการบันทึกยอดเงินเป็น 0 หรือติดลบ
   - มีระบบ Idempotency Key ป้องกันการบันทึกรายการซ้ำ
4. **Ledger Database Service (`LedgerService`):** สร้าง Service เลเยอร์ใน `backend/src/core/ledger/` เพื่อบันทึกธุรกรรมลงตาราง `ledger_entries` ใน Neon PostgreSQL แบบ Atomic พร้อมรองรับ Unique Constraint Violation `23505` ให้ทำงานแบบ Idempotent อย่างปลอดภัย

---

## 2. รายละเอียดสถาปัตยกรรมระบบ Migration Engine

### 2.1 ตารางบันทึกสถานะการย้ายข้อมูล (`_velnox_migrations`)
```sql
CREATE TABLE IF NOT EXISTS _velnox_migrations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) UNIQUE NOT NULL,
  checksum VARCHAR(64) NOT NULL,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  execution_time_ms INTEGER NOT NULL
);
```

### 2.2 คุณสมบัติด้านความปลอดภัย (Security & Integrity Guarantees)
- **Deterministic Checksum (SHA-256):** คำนวณ Checksum ของทุกไฟล์ `.sql` โดยปรับค่า Line endings (`\r\n` -> `\n`) เพื่อให้ได้ค่าแฮชเดียวกันในทุกระบบปฏิบัติการ
- **Tampering Detection:** หากไฟล์ Migration ที่เคยรันไปแล้วถูกดัดแปลงแก้ไขในภายหลัง ระบบจะโยน `MigrationTamperedError` และปฏิเสธการทำงานทันที
- **Transactional Atomicity:** แต่ละ Migration จะถูกรันภายใต้ `BEGIN; ... COMMIT;` หากมีคำสั่งใดผิดพลาด ระบบจะทำ `ROLLBACK;` และบันทึกข้อผิดพลาดอย่างละเอียด
- **CLI Management:** พัฒนาสคริปต์ [database/migrate.ts](file:///workspace/quiet-hopper/database/migrate.ts) รองรับคำสั่ง:
  - `status`: แสดงรายการ Migration ที่รันแล้วและที่ค้างอยู่
  - `up`: ดำเนินการรัน Migration ที่ค้างอยู่ตามลำดับ
  - `check-files`: ตรวจสอบไฟล์ Migration ในเครื่องและแสดงค่า SHA-256

---

## 3. รายละเอียดสถาปัตยกรรม Ledger Core (`@velnox/ledger`)

### 3.1 ผังบัญชี (Chart of Accounts)
- **`platform_cash` (สินทรัพย์):** บัญชีเงินสด/เงินฝากของแพลตฟอร์มใน Payment Gateway (เดบิตเพิ่มขึ้น, เครดิตลดลง)
- **`platform_revenue` (รายได้):** รายได้ค่าคอมมิชชันและค่าธรรมเนียมของแพลตฟอร์ม (เครดิตเพิ่มขึ้น, เดบิตลดลง)
- **`seller_payable` (หนี้สิน):** ยอดเงินสุทธิที่แพลตฟอร์มต้องจ่ายให้แก่ผู้ขาย (เครดิตเพิ่มขึ้น, เดบิตลดลงเมื่อโอนเงิน)
- **`refund_clearing` (บัญชีพักหนี้สิน):** บัญชีพักสำหรับการคืนเงินลูกค้า

### 3.2 ตัวอย่างธุรกรรมมาตรฐาน (Standard Transaction Postings)
1. **การชำระเงินของลูกค้า (Customer Charge):**
   - **DEBIT:** `platform_cash` (ยอดชำระเต็มจำนวน Gross Amount)
   - **CREDIT:** `seller_payable` (ยอดสุทธิที่ผู้ขายจะได้รับ Net Amount)
   - **CREDIT:** `platform_revenue` (ค่าธรรมเนียมแพลตฟอร์ม Platform Fee)
   - *สมดุล:* $\text{Debit(Cash)} = \text{Credit(Seller)} + \text{Credit(Fee)}$
2. **การโอนเงินให้ผู้ขาย (Seller Settlement / Payout):**
   - **DEBIT:** `seller_payable` (ลดยอดหนี้สินที่ค้างจ่าย)
   - **CREDIT:** `platform_cash` (เงินสดออกจากบัญชีแพลตฟอร์ม)
3. **การคืนเงินลูกค้า (Customer Refund):**
   - **DEBIT:** `refund_clearing`
   - **CREDIT:** `platform_cash`

---

## 4. ผลการทดสอบ (Quality Gate & Test Verification)

การทดสอบแบบ Automated ผ่านการรับรอง 100% (18/18 tests passed):

1. **`packages/ledger/tests/ledger.test.ts` (8 passed):**
   - ตรวจสอบความถูกต้องของธุรกรรมที่สมดุล
   - ปฏิเสธธุรกรรมที่ไม่สมดุล (Debits != Credits)
   - ปฏิเสธยอดเงิน 0 และยอดเงินติดลบ
   - ปฏิเสธชนิดข้อมูลตัวเลขทศนิยม (Float) โดยบังคับใช้ `bigint` เท่านั้น
   - ปฏิเสธ Idempotency Key ที่ว่างเปล่า
   - ตรวจสอบการสร้างธุรกรรม Customer Payment, Seller Settlement, และ Refund
2. **`database/tests/migrator.test.ts` (7 passed):**
   - คำนวณค่า SHA-256 Checksum สอดคล้องข้ามระบบปฏิบัติการ
   - อ่านและจัดเรียงไฟล์ Migration ตามลำดับตัวเลข
   - วางแผนรัน Migration บนฐานข้อมูลว่างเปล่าได้อย่างถูกต้อง
   - ตรวจสอบกรณีฐานข้อมูลอัปเดตเป็นปัจจุบันแล้ว
   - ดักจับการแก้ไขไฟล์ย้อนหลัง (`MigrationTamperedError`)
   - ทดสอบการรันแบบ Transactional และการทำ Rollback เมื่อเกิดข้อผิดพลาด
3. **`backend/tests/ledger-service.test.ts` (3 passed):**
   - บันทึกธุรกรรมลงฐานข้อมูลแบบ Multi-leg Atomic Insert
   - รองรับการบันทึกซ้ำ (Idempotency Handling เมื่อเกิด Error 23505) โดยคืนค่าเดิมโดยไม่เกิดข้อผิดพลาด
   - ตรวจสอบการ Rollback เมื่อเกิดปัญหาในการเชื่อมต่อฐานข้อมูล
4. **`backend/tests/packages-contracts.test.ts`:**
   - รวมการทดสอบของ `@velnox/ledger` เข้ากับ Contract Quality Gate ใน Backend Runner เพื่อให้ CI ตรวจสอบทุกครั้งที่มีการ Push โค้ด
