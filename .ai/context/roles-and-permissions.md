# ROLES & PERMISSIONS — VelCenter

แหล่งความจริงเดียว: `backend/lib/permissions.ts` (catalog) + `roleHoldsPermission` ฝั่ง client
(`packages/shared/src/lib/api-client.ts`) ที่สะท้อนกติกาเดียวกัน

**หลักการ:** ทุก endpoint ตรวจซ้ำฝั่ง server เสมอ การซ่อนแท็บเป็น UX ไม่ใช่ authorization
และ **deny by default** — พนักงานที่ไม่มีสิทธิ์ใด ๆ เห็นแค่ภาพรวม

## 3 บทบาท

| บทบาท | เข้าถึงอะไรได้ | เข้าถึงอะไรไม่ได้ |
|---|---|---|
| **owner** | ทุกอย่าง รวมถึงจัดการพนักงาน (สร้าง / รีเซ็ตรหัส / ตั้งสิทธิ์), ตั้งค่าระบบ, หมวดหมู่, marketing | — (ยกเว้นกฎที่ระบบห้าม เช่นอนุมัติตัวเอง) |
| **admin** | ข้อมูลธุรกิจทั้งหมด, ไดเรกทอรีลูกค้า, ดูรายชื่อพนักงาน (อ่านอย่างเดียว), หมวดหมู่, marketing | **จัดการพนักงาน** (สร้าง/รีเซ็ตรหัส/แก้สิทธิ์), ตั้งค่าระบบที่เป็นของ owner |
| **staff** | เฉพาะแท็บที่ได้ `employees.permissions` มา + ภาพรวม (aggregate) + แชทบริษัท | ทุกอย่างที่ไม่ได้ถูกให้สิทธิ์ |

## permission codes (catalog จริงในโค้ด)

| code | ให้อะไร | endpoint ที่บังคับใช้ |
|---|---|---|
| `orders.view` | ดูออเดอร์, เหตุการณ์ชำระเงิน, ติดตามพัสดุ | `GET /api/admin/orders`, `GET /api/admin/payment-incidents`, `/api/admin/tracking/*` |
| `orders.manage` | เปลี่ยนสถานะออเดอร์, resolve payment incident | `PATCH /api/admin/orders/:id/*`, `PATCH /api/admin/payment-incidents/:id` |
| `products.moderate` | อนุมัติ/ปฏิเสธสินค้า | `/api/products/admin/*` (moderation) |
| `sellers.manage` | อนุมัติ/ระงับผู้ขาย + คิวตรวจสอบผู้ขาย | `/api/admin/verifications*`, `PATCH /api/admin/sellers/:id/status` |
| `users.manage` | ดูไดเรกทอรีผู้ใช้/ลูกค้า | `GET /api/admin/users` |
| `staff.manage` | ดูรายชื่อพนักงาน | `GET /api/admin/employees` |
| `audit.view` | ดู audit log | `GET /api/admin/audit-logs` |
| `settings.manage` | ตั้งค่าแพลตฟอร์ม + banner (marketing) | `GET/PATCH /api/admin/settings`, `PUT /api/admin/announcements` |

owner และ admin ถือทุก code โดยปริยาย (`ALL_PERMISSION_CODES`)

## ตัวอย่างจริงในระบบ (2026-11-09)

พนักงาน `000001` (role `staff`) ถือ `orders.view`, `orders.manage`, `products.moderate`
→ เห็น: ภาพรวม, ออเดอร์, เหตุการณ์ชำระเงิน, ติดตามพัสดุ, ตรวจสินค้า, แชท
→ ไม่เห็น: ผู้ขาย, ตรวจสอบผู้ขาย, หมวดหมู่, พนักงาน, audit, ตั้งค่า, marketing

**บั๊กที่แก้รอบนี้:** overview เคยยิงคิวผู้ขาย/ตรวจสอบไม่เลือกสิทธิ์ → พนักงานได้
`403 Admin access required` แล้วหน้าเว็บขึ้น "โหลดตัวเลขคิวงานไม่สำเร็จ"
ตอนนี้แต่ละตัวนับผูกกับสิทธิ์ของตัวเอง (`queueRights`) จึงไม่ยิงสิ่งที่ไม่ได้รับอนุญาต
และเลขที่เห็นเป็นเลขที่กดเข้าไปทำได้จริง

## รหัสพนักงาน (Member ID)

รูปแบบ: เลขลำดับ 4 หลัก (`0001`, `0002`, …) — ออกให้อัตโนมัติเมื่อไม่กรอก
เหตุผล: พนักงานต้องอ่าน/พิมพ์เองได้ (เช่นแจ้งทางโทรศัพท์) ไม่ใช่ token สุ่ม
มี unique index `uq_employees_employee_id` กันซ้ำ และ API ตอบ 409 พร้อมบอกเลขที่ชน

## ตรวจสอบย้อนหลัง

การเปลี่ยนแปลงสิทธิ์พนักงานทุกครั้งเขียน `audit_logs` (`EMPLOYEE_CREATE`,
`EMPLOYEE_PASSWORD_RESET`, `EMPLOYEE_ACCESS_CHANGE`) — ดูได้ที่แท็บ Audit (owner/`audit.view`)
