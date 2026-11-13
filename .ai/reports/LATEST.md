# LATEST — 2026-11-11 · Fix: "กรุณายืนยันว่าไม่ใช่บอทก่อน" แม้ติ๊ก Turnstile แล้ว

**Branch:** `main` · **Status:** DONE (code) · ⚠️ **สาเหตุฝั่ง production ยังต้องให้ owner ตั้งค่า**

## 1. อาการที่ owner แจ้ง

> "มันก็เช็คถูกแล้วนี่ ทำไมเข้าสู่ระบบไม่ได้ มันขึ้น กรุณายืนยันว่าไม่ใช่บอทก่อน"

Turnstile ติ๊กถูกแล้ว แต่ระบบยังบอกให้ยืนยัน

## 2. Root Cause — มี 2 อย่างซ้อนกัน

### 2.1 ทุก error จาก server ถูกแปลงเป็นข้อความ "ยืนยันก่อน" (บั๊กจริง)

`handleGoogleSignIn` ทำแบบนี้:

```ts
if (!proofRes.ok) {
  const code = payload?.error?.code;
  throw new Error(
    code === "TURNSTILE_UNAVAILABLE" || code === "TURNSTILE_TIMEOUT"
      ? t("auth.turnstile.networkError")
      : t("auth.turnstile.required"),   // ← ทุกอย่างที่เหลือ
  );
}
```

ดังนั้น **503 เพราะไม่มี `TURNSTILE_SECRET_KEY`**, **400 เพราะ hostname ไม่ตรง**,
หรือ **503 เพราะตาราง `preauth_nonces` ยังไม่มี** → ลูกค้าเห็น
"กรุณายืนยันว่าไม่ใช่บอทก่อน" ทั้งที่ทำถูกแล้ว

### 2.2 ข้อความค้าง (stale state)

`setError(t("auth.turnstile.required"))` ถูกตั้งก่อน widget จะถูกติ๊ก และ **ไม่เคยถูกล้าง**
เมื่อผ่านการยืนยัน → ติ๊กแล้วก็ยังเห็นข้อความเดิม

## 3. สิ่งที่แก้

| ไฟล์ | การแก้ |
|---|---|
| `packages/shared/src/pages/Auth.tsx` | map `error.code` → ข้อความที่ตรงความจริง (login/register/member/Google ทั้ง 4 ทาง) + ล้างข้อความ "ยืนยันก่อน" ทันทีที่ได้ token + โลโก้กลับมา |
| `packages/shared/src/hooks/use-turnstile.ts` | เพิ่ม `peek()` อ่าน `turnstile.getResponse()` — token จริงจาก Cloudflare |
| i18n 3 ภาษา | เพิ่ม `auth.turnstile.wrongSite`, `auth.turnstile.notConfigured` (2297×3) |
| test | +13 เคส (compact / signup / VelCenter / error mapping) |

**ตาราง map ที่ใช้ตอนนี้**

| code จาก server | ข้อความที่ลูกค้าเห็น |
|---|---|
| `TURNSTILE_REQUIRED` | กรุณายืนยันว่าไม่ใช่บอทก่อน |
| `TURNSTILE_INVALID` | การยืนยันไม่สำเร็จ กรุณาลองอีกครั้ง |
| `TURNSTILE_EXPIRED` / `REPLAYED` | การยืนยันหมดอายุ — กรุณายืนยันใหม่ |
| `TURNSTILE_HOSTNAME_MISMATCH` / `ACTION_MISMATCH` | การยืนยันนี้ทำบนโดเมนอื่น กรุณาโหลดหน้าใหม่ |
| `TURNSTILE_TIMEOUT` / `UNAVAILABLE` | เชื่อมต่อระบบยืนยันไม่ได้… |
| `TURNSTILE_NOT_CONFIGURED` / `PREAUTH_*` | ระบบยืนยันยังไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแล |

**Token resolution:** `turnstile.token ?? turnstile.peek()` — ถ้า Cloudflare ถือ response อยู่
แต่ React ยังไม่ได้รับ callback ก็ยัง submit ได้ (server ยังตรวจซ้ำ และปฏิเสธ token ที่ใช้แล้ว)
ปุ่มใช้ค่าเดียวกันนี้ → ไม่มีทาง "ปุ่มเทาแต่ widget เขียว"

## 4. โลโก้ (ตามที่ขอ)

เพิ่มกลับในหัวการ์ด ใช้ทั้ง login และ register — วัดจริงที่ความกว้างจำลอง 360px:
**login 598px · register 631px** (ยังพอดี 1 จอบนมือถือทั่วไป)

## 5. ⚠️ สาเหตุฝั่ง Production ที่ต้องแก้ (สำคัญ)

โค้ดแก้ให้ "บอกความจริง" แล้ว แต่ **ต้นเหตุที่ login ไม่ผ่านคือฝั่ง server** ซึ่ง agent
ตรวจสอบแทนไม่ได้ ต้องทำ 2 อย่างนี้:

### (ก) รัน SQL สร้างตาราง (ถ้ายังไม่รัน)
ถ้าไม่รัน → Google login จะตอบ 503 `PREAUTH_STORE_UNAVAILABLE` ทุกครั้ง

```sql
CREATE TABLE IF NOT EXISTS preauth_nonces (
  nonce_hash TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_preauth_nonces_expires ON preauth_nonces (expires_at);
```

หรือรันทั้งไฟล์ `db/run-sqleditor.sql` ใน Neon SQL Editor (idempotent)

### (ข) ตั้ง env บน Render
```
TURNSTILE_SECRET_KEY=<secret key จาก Cloudflare>
TURNSTILE_HOSTNAMES=velshop.vercel.app,velseller.vercel.app,velcenter.vercel.app
```
ถ้าไม่ตั้ง secret → ทุก login ถูกปฏิเสธ (fail-closed) ด้วย `TURNSTILE_NOT_CONFIGURED`
ถ้า hostname ไม่ตรง → `TURNSTILE_HOSTNAME_MISMATCH`

หลังแก้แล้ว อาการจะเปลี่ยนจาก "กรุณายืนยัน…" เป็นข้อความที่บอกสาเหตุจริง —
ถ้ายังไม่ผ่าน ให้ดูข้อความใหม่นั้นแล้วแจ้งกลับมาได้เลย

## 6. ผลตรวจ (รันจริง)

| คำสั่ง | ผล |
|---|---|
| `bun run typecheck` | **4/4 ผ่าน** |
| `bun run i18n:check` | **OK — 2297 × 3** |
| build velShop / velSeller / velCenter | **3/3 ผ่าน** |
| `bun test backend/tests` | **1497 pass** / 431 skip / 2 fail (ของเดิม) |
| `git diff --check` | **clean** |
| วัด UI ในเบราว์เซอร์ | โลโก้แสดง, 598/631px, ไม่มีข้อความที่ถูกเอาออก |

## 7. Git

- commit `f8c5728` · push แล้ว · `HEAD = origin/main = f8c5728` · working tree clean
