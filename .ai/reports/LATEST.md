# LATEST — 2026-11-11 · Neon: สร้างตาราง preauth_nonces (แก้ login ไม่ได้)

**Branch:** `main` · **Status:** DONE · **Production DB แก้แล้ว**

## 1. อาการ

> "ระบบยืนยันการเข้าสู่ระบบยังไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแล"

## 2. Root Cause — พบจาก log จริงของ Render

```
message: 'relation "preauth_nonces" does not exist'
[auth] pre-auth nonce store unavailable — refusing to issue a proof
```

**ตาราง `preauth_nonces` ไม่มีใน production Neon** → `recordNonce()` ล้มเหลว →
`POST /api/auth/preauth` ตอบ 503 `PREAUTH_STORE_UNAVAILABLE` → frontend แสดง
`auth.turnstile.notConfigured`

### สิ่งที่ log พิสูจน์เพิ่มเติม (สำคัญ)

โค้ดไปถึงบรรทัด `recordNonce()` ได้ แปลว่า **Turnstile verification ผ่านแล้ว**:

| ตรวจ | ผล |
|---|---|
| `TURNSTILE_SECRET_KEY` | ✅ ตั้งแล้ว (ถ้าไม่มีจะ fail ก่อนถึงขั้นนี้) |
| `TURNSTILE_HOSTNAMES` | ✅ ตรง (hostname check ผ่าน) |
| `VITE_TURNSTILE_SITE_KEY` | ✅ ตั้งแล้ว (widget แสดงและติ๊กได้) |
| **ตาราง `preauth_nonces`** | ❌ **ไม่มี** ← ต้นเหตุเดียว |

## 3. การแก้ไข (ทำบน production Neon แล้ว)

```sql
CREATE TABLE IF NOT EXISTS preauth_nonces (
  nonce_hash TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_preauth_nonces_expires ON preauth_nonces (expires_at);
```

### ยืนยันหลังสร้าง

```
columns: nonce_hash text NOT NULL (PK)
         created_at timestamptz NOT NULL DEFAULT now()
         expires_at timestamptz NOT NULL
indexes: preauth_nonces_pkey, idx_preauth_nonces_expires
```

### ทดสอบ SQL เส้นทางเดียวกับ backend (บน production)

| ขั้น | คำสั่ง | ผล |
|---|---|---|
| 1. record (ตอน mint proof) | `INSERT … ON CONFLICT DO NOTHING RETURNING` | ✅ คืนแถว |
| 2. consume ครั้งแรก | `DELETE … RETURNING expires_at` | ✅ คืนแถว → ผ่าน |
| 3. consume ครั้งที่สอง | `DELETE … RETURNING` | ✅ คืน **ว่าง** → ถูกปฏิเสธ (replay block) |
| 4. ตรวจว่าตารางว่าง | `SELECT count(*)` | ✅ 0 แถว |

## 4. ทดสอบ endpoint จริงบน production

```
POST https://velnox-api.onrender.com/api/auth/preauth  body {}
→ HTTP 400 { "code": "TURNSTILE_REQUIRED" }
```

**ไม่ใช่ 503** → secret ถูกตั้งค่า และ route ทำงาน (ถ้า secret หายจะได้ 503
`TURNSTILE_NOT_CONFIGURED`) และการส่ง token ว่างถูกปฏิเสธ (ไม่มี bypass)

## 5. Deploy ที่ใช้งานอยู่

- Render `velnox-api` (srv-da5dg76417fc73f3krkg) · live deploy `b27d40b0` · 1 instance
- ไม่ต้อง redeploy หลังสร้างตาราง — backend query ตอน runtime

## 6. ขั้นตอนถัดไป (owner)

1. ลองล็อกอินอีกครั้ง — ควรผ่านแล้ว
2. ถ้ายังไม่ผ่าน ให้ดูข้อความใหม่ (ตอนนี้บอกสาเหตุจริงแล้ว) แล้วแจ้งกลับ:
   - "การยืนยันนี้ทำบนโดเมนอื่น" → hostname ไม่อยู่ใน `TURNSTILE_HOSTNAMES`/Cloudflare
   - "การยืนยันหมดอายุ" → ติ๊กช้าเกิน 3 นาที หรือ token ถูกใช้แล้ว
   - "ระบบยืนยันยังไม่พร้อม" → ยังมีปัญหาฝั่ง server (ส่ง log มาให้ดู)

## 7. Git

- ไม่มีการเปลี่ยนโค้ดในรอบนี้ — แก้เฉพาะฐานข้อมูล production
- repo ล่าสุด: `b27d40b` (= deploy ที่ live)
