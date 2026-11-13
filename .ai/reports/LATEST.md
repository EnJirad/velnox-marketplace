# LATEST — 2026-11-11 · Compact Login + VelCenter Staff-Only

**Branch:** `main` · **Status:** DONE — วัดผลจริงในเบราว์เซอร์แล้ว

## 1. สรุป

ปรับหน้า Login/Register (shared component ใช้ร่วมทั้ง 3 เว็บ) ให้ **กระชับ พอดี 1 จอ**
ตัดข้อความที่ไม่จำเป็นออก และเปลี่ยน VelCenter ให้ล็อกอินได้เฉพาะพนักงาน

## 2. ผลการวัดจริง (dev server + browser)

| สถานะ | ก่อน | หลัง |
|---|---|---|
| การ์ด (login) | ~680 px (ต้องเลื่อน) | **558 px** |
| การ์ด (register) | ~730 px | **591 px** |
| ความกว้างจำลอง | 360 px | 360 px |

วัดด้วย `getBoundingClientRect()` บนหน้า `/auth` จริง ไม่ใช่การประมาณ

## 3. สิ่งที่เอาออก (ตามที่ขอ)

- "ยืนยันว่าไม่ใช่บอทเพื่อดำเนินการต่อ" (บรรทัดเหนือ Turnstile)
- "กำลังรอการยืนยัน…" (สถานะใต้ widget) — widget บอกสถานะเองอยู่แล้ว
- "ป้องกันด้วยการยืนยันตัวตน Cloudflare" (footer)
- โลโก้ + คำอธิบายโหมด (description)
- ช่อง "ชื่อ" ตอนสมัคร
- ปุ่ม "ดำเนินการต่อในฐานะแขก" (เทียบเท่าปุ่มย้อนกลับ ซึ่งยังอยู่)

**เก็บไว้:** สถานะ `expired / error / unavailable` ใต้ widget เพราะเป็นข้อมูลที่ต้องลงมือทำ
(ปุ่มถูก disable และผู้ใช้ต้องรู้ว่าทำไม) — ถ้าตัดออกด้วยจะกลายเป็นปุ่มตายที่ไม่มีคำอธิบาย

## 4. ความกระชับ

- `Card` ของ shadcn มี `py-6` + `gap-6` = **72px ของที่ว่างเปล่า** → override เป็น `py-0 gap-0`
- input/ปุ่ม `h-12` → `h-11` (ยังเป็น 44px ตามเกณฑ์ touch target)
- gap 4 → 2.5, header/card padding ลด, บรรทัดกฎหมายเหลือแค่ 2 ลิงก์ในบรรทัดเดียว

## 5. การสมัครสมาชิก (VelShop + VelSeller)

| ก่อน | หลัง |
|---|---|
| ชื่อ + อีเมล + รหัสผ่าน | **อีเมล + รหัสผ่าน + ยืนยันรหัสผ่าน** |
| ไม่มีปุ่มดูรหัสผ่าน | **ตาทั้ง 2 ช่อง** (เปิด/ปิดแยกกัน) |
| ไม่มีการตรวจรหัสตรงกัน | **ไม่ตรง = ขึ้นข้อความ + ปุ่ม submit disabled** |

- ฝั่ง client: `if (password !== confirmPassword)` ก่อนยิง request
- ฝั่ง server: `name` กลายเป็น optional → derive จาก local part ของอีเมล
  (`users.name` เป็น `NOT NULL DEFAULT ''` จึงปลอดภัย)

## 6. VelCenter — พนักงานเท่านั้น

| องค์ประกอบ | สถานะ |
|---|---|
| ปุ่ม Google | ❌ ไม่แสดง (ลบทางเข้าออก) |
| แท็บสมัครสมาชิก | ❌ ไม่แสดง |
| ฟอร์มอีเมล/รหัสผ่านลูกค้า | ❌ ไม่แสดง |
| ฟอร์ม Member ID/อีเมล + รหัสผ่าน | ✅ เป็นทางเข้าเดียว แสดงทันที (ไม่มี toggle) |
| Turnstile gate | ✅ ยังอยู่ครบ |
| หัวข้อหน้า | "เข้าสู่ระบบพนักงาน" |

## 7. เทสต์

- `auth-turnstile-gate.test.ts` — ปรับให้ยืนยัน **ทีละคอนโทรล** (บทเรียนจากบั๊กปุ่ม Google รอบก่อน
  ที่ assert ทั้งไฟล์แล้วพลาด) + เพิ่มชุดใหม่:
  - ข้อความที่ถูกเอาออกต้องไม่กลับมา
  - เฉพาะสถานะที่ต้องลงมือทำเท่านั้นที่ render
  - สมัคร: มี confirm, ไม่มี name, mismatch บล็อก, request ไม่ส่ง name
  - VelCenter: ไม่มี Google/register/memberMode, ชื่อหน้าเป็นของพนักงาน
- ผลรวม: **1495 pass** / 431 skip / 2 fail (ของเดิม)

## 8. ผลตรวจ (รันจริง หลัง patch สุดท้าย)

| คำสั่ง | ผล |
|---|---|
| `bun run typecheck` | **4/4 ผ่าน** |
| `bun run i18n:check` | **OK — 2295 × 3 parity** |
| `bun run build:velshop` | **ผ่าน** |
| `bun run build:velseller` | **ผ่าน** |
| `bun run build:velcenter` | **ผ่าน** |
| `bun test backend/tests` | **1495 pass** / 431 skip / 2 fail (ของเดิม: chat transport, verification exports) |
| `git diff --check` | **clean** |

## 9. ข้อจำกัด

- **VelCenter ไม่ได้เห็นด้วยตาในโหมดพนักงาน** — `currentSite()` ตรวจจาก hostname
  (`velcenter.vercel.app`) หรือ path `/center` ซึ่งบน dev server localhost จะตกไปเป็น velshop
  → ตรวจด้วยเทสต์ + โค้ดแทน (production จะเข้า branch ที่ถูกต้อง)
- ยังไม่ได้ทดสอบบนเครื่องจริง 360/390/768/1280 — วัดด้วยการจำลองความกว้าง 336px (360 − padding)

## 10. Git

- commit `f4225a9` · push แล้ว · `HEAD = origin/main = f4225a9` · working tree clean
