# LATEST — 2026-11-11 · แก้ Google Login (SameSite cookie)

**Branch:** `main` · **Status:** DONE · deploy live `9f987fa`

## 1. อาการ

- ล็อกอินด้วย **อีเมล + รหัสผ่าน → เข้าได้**
- กด **Continue with Google → ไม่ได้** (เด้งกลับหน้าล็อกอิน)

## 2. Root Cause — cookie ข้ามโดเมนถูกเบราว์เซอร์ทิ้ง

Google flow ต้องผ่าน proof cookie 1 ใบ:

```
POST  /api/auth/preauth   (fetch จาก velxxx.vercel.app → velnox-api.onrender.com)
      → Set-Cookie velnox_preauth
GET   /auth/google        (top-level navigation) → อ่าน cookie นี้
```

`preAuthCookieOptions()` ตั้ง **`SameSite=Lax`** → การเรียก `/api/auth/preauth` เป็น
**third-party request** (คนละ registrable domain: `vercel.app` vs `onrender.com`)
→ เบราว์เซอร์ **ไม่เก็บ cookie** จาก response ข้ามไซต์ที่มี `Lax`
→ `/auth/google` ไม่เห็น proof → ตอบกลับ `?error=preauth_required`

**หลักฐานชี้ชัด:** session cookie (`velnox_session`) ใช้ **`SameSite=None`**
จึงล็อกอินอีเมลได้ตามปกติ — ต่างกันแค่ flag นี้

## 3. การแก้

`backend/lib/preauth-proof.ts`

| สภาพแวดล้อม | sameSite | secure | เหตุผล |
|---|---|---|---|
| production | **none** | true | จำเป็นคู่กันสำหรับ cookie ข้ามโดเมน |
| development | lax | false | localhost เป็น same-site และ http ไม่มี Secure |

- `clearPreAuthCookieOptions` **mirror ค่าเดียวกันทุกตัว** (path/secure/sameSite)
  ไม่งั้นเบราว์เซอร์จะไม่ลบ cookie
- **OAuth state cookie คงไว้ที่ `Lax`** โดยเจตนา — มันถูก set/อ่านระหว่าง
  top-level navigation บน origin ของ API เอง (first-party) จึงถูกต้องแล้ว

## 4. เทสต์

เปลี่ยน assertion เดิมที่ **pin บั๊กไว้** (`sameSite === "lax"`) เป็น:

- production → `none` + `secure: true`
- development → `lax` + `secure: false`
- clear options ต้องตรงกับ set options ทุกค่า

## 5. ผลตรวจ (รันจริง)

| ตรวจ | ผล |
|---|---|
| backend `tsc --noEmit` | ผ่าน |
| `bun test backend/tests` | **1499 pass** / 431 skip / 2 fail (ของเดิม) |
| `git diff --check` | clean |
| Render deploy | `9f987fa` **live** (00:02:14Z) |
| `/api/health` | **200 ok** |
| `POST /api/auth/preauth` body `{}` | **400 TURNSTILE_REQUIRED** (ไม่ใช่ 503) |

## 6. ข้อจำกัด

- **ยังยืนยันด้วยตาไม่ได้** ว่า Google login สำเร็จ — ต้องใช้อีเมล Google จริง +
  เบราว์เซอร์ของผู้ใช้ ซึ่ง agent ทำไม่ได้ ให้ owner กดทดสอบอีกครั้ง
- `SameSite=None` เป็น third-party cookie: เบราว์เซอร์ที่บล็อก 3P cookie ทั้งหมด
  (Safari ITP, Firefox ETP, Chrome incognito) อาจยังปฏิเสธ
  → ถ้าต้องรองรับ 100% ควรย้าย API มาอยู่ subdomain เดียวกัน (เช่น `api.velnox.com`)
  ซึ่งเป็นการเปลี่ยน infrastructure ไม่ใช่โค้ด

## 7. Git

- commit `9f987fa` · push แล้ว · `HEAD = origin/main = 9f987fa` · working tree clean
