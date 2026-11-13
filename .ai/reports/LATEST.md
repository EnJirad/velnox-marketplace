# LATEST — 2026-11-11 · Cloudflare Turnstile Authentication Gate

**Branch:** `main` · **Status:** DONE (code + tests) — **production ยังไม่เปิดใช้งานจริง** จนกว่าจะตั้งค่า env

## 1. Root Cause ที่พบ (Phase 0 Audit)

| # | ระดับ | ปัญหา | หลักฐาน |
|---|---|---|---|
| 1 | **Critical** | `useTurnstile` คืนค่า token ปลอม `"bypass"` เมื่อไม่มี site key → ทุกปุ่มผ่านได้ | `use-turnstile.ts` เดิม (ลบแล้ว) |
| 2 | **Critical** | `POST /api/auth/member-login` **ไม่มีการตรวจสอบเลย** (รหัสพนักงานคือเป้าที่มีค่าที่สุด) | `auth.ts` ไม่มี turnstile ใน handler |
| 3 | **Critical** | `GET /auth/google` **ไม่มีการตรวจสอบ** — เรียกตรงได้ ข้าม challenge ทั้งหมด | ไม่มี gate ใน route |
| 4 | **Critical** | password-login / password-register ข้ามการตรวจสอบทั้งหมดถ้าไม่มี `TURNSTILE_SECRET_KEY` | `if (turnstileSecret && turnstileToken)` |
| 5 | **High** | `reset()` ไม่ได้ reset widget จริง (แค่ set state null) → หลัง login ผิด 1 ครั้ง widget ตายถาวร | คอมเมนต์เดิมอ้างว่า Turnstile reset เอง |
| 6 | **High** | ไม่มี hostname check, action check, replay check, timeout → fail-open เมื่อ network ค้าง | ไม่มีใน siteverify block |
| 7 | **High** | ข้อความไทย hardcode 2 จุดใน Auth.tsx | "ยืนยันว่าไม่ใช่บอท…", "ป้องกันด้วย Cloudflare…" |
| 8 | **Medium** | ไม่มี language selector | — |
| 9 | **High** | my locale ขาด 16 key ของ login/register → ผู้ใช้พม่าอ่าน raw key | shallow merge ใน `locales/index.ts` |

## 2. Turnstile Architecture ใหม่

```
Browser                    Backend                        Cloudflare
  │ widget ──token──► verifyTurnstile() ──siteverify──►
  │                        │
  │                        ├─ secret? (prod: ไม่มี = ปฏิเสธ)
  │                        ├─ token shape (ปฏิเสธ "" / "bypass")
  │                        ├─ replay cache (single use)
  │                        ├─ timeout 5s + network = fail closed
  │                        ├─ success?
  │                        ├─ hostname ∈ allowlist (จาก server config)
  │                        └─ action ตรง (ถ้า widget ส่งมา)
  │
  ├─ password login/register ──► POST /api/auth/password-*  (gate)
  ├─ member login ─────────────► POST /api/auth/member-login (gate)
  └─ Google ──► POST /api/auth/preauth ──► one-time proof cookie
                    └─► GET /auth/google (ต้องมี proof, consume ทันที)
                            └─► OAuth state เดิมทั้งหมดยังทำงานเหมือนเดิม
```

### Frontend state machine (`use-turnstile.ts`)
`loading → verifying → verified | expired | error | unavailable`

- `ready` = `state === "verified" && token !== null` — ไม่มีทาง bypass
- script loader ใช้ promise เดียวร่วมกัน + ref count (ไม่ inject ซ้ำ, ไม่ลบตอนตัวอื่นใช้)
- `reset()` เรียก `turnstile.reset(widgetId)` จริง
- `consume()` เรียกหลัง login ล้มเหลว → token ที่ใช้แล้วไม่ถูกส่งซ้ำ
- cleanup: remove widget ทุกครั้ง, remove script เมื่อ ref count = 0

## 3. Authentication Paths ที่ได้รับการป้องกัน

| Endpoint | ก่อน | หลัง |
|---|---|---|
| `POST /api/auth/password-login` | gate แบบ fail-open | ✅ fail-closed |
| `POST /api/auth/password-register` | gate แบบ fail-open | ✅ fail-closed |
| `POST /api/auth/member-login` | ❌ ไม่มีเลย | ✅ fail-closed |
| `GET /auth/google` | ❌ เรียกตรงได้ | ✅ ต้องมี one-time proof |
| Google callback | ✅ state เดิม | ✅ **ไม่แก้ไข** (HMAC/nonce/cookie/timing-safe/single-use/returnTo) |

## 4. ภาษา TH / EN / MY

- เพิ่ม key ใหม่: `auth.turnstile.*` 10 ตัว + `auth.languageSelector`
- ลบข้อความไทย hardcode ออกจาก `Auth.tsx` ทั้งหมด (ตรวจด้วย regex `[ก-๙]` แล้ว)
- **แก้บั๊ก shallow merge**: `myAuthPatch.login/register` เคยทับ block ทั้งก้อน → เติม 16 key ที่ขาด ( Burmese )
- **ผล: `bun run i18n:check` ผ่านครั้งแรก — th=2294 en=2294 my=2294 parity**

## 5. Security Tests (ใหม่ 58 เคส)

`backend/tests/turnstile-verification.test.ts` — 24 เคส:
valid · invalid · empty · `"bypass"` · `"null"` · missing secret (prod=ปฏิเสธ, dev=skip) ·
expired · reused · wrong hostname · 3 hosts ที่อนุญาต · production ไม่มี hostnames = ปฏิเสธ ·
hostname มาจาก config ไม่ใช่ header · action mismatch · action ไม่ส่งมาก็ผ่าน ·
timeout (abort จริง) · network error · JSON พัง · status mapping

`backend/tests/auth-turnstile-gate.test.ts` — 34 เคส:
preauth proof (mint/validate/forge/tamper/expire/no-secret/cookie flags) ·
ทุก endpoint เรียก gate · ไม่มี siteverify ซ้ำใน route · ไม่มี fail-open branch เดิม ·
`/auth/google` validate+consume ก่อน `createOAuthState` · OAuth state เดิมครบ ·
ไม่มี token/secret ใน URL · frontend ไม่มี bypass · 6 states · reset จริง ·
ปุ่ม disabled จริง 4 จุด · consume หลัง fail · preauth ก่อน redirect · ไม่มีไทย hardcode ·
language selector ไม่ reload/reset form · i18n ครบ 3 ภาษา

`backend/tests/oauth-route.test.ts` — อัปเดตให้แนบ proof cookie + เพิ่ม 2 เคส:
start โดยไม่มี proof ถูกปฏิเสธ, proof ปลอมถูกปฏิเสธ

## 6. Build Results (รันจริง)

| คำสั่ง | ผล |
|---|---|
| `bun run typecheck` | ผ่าน 4/4 แอป |
| backend `tsc --noEmit` | ผ่าน |
| `bun run build:velshop` | ผ่าน |
| `bun run build:velseller` | ผ่าน |
| `bun run build:velcenter` | ผ่าน |
| `bun run i18n:check` | **OK — 2294×3 parity** |
| `bun test backend/tests` | **1461 pass / 431 skip / 2 fail (ของเดิม)** |
| `git diff --check` | clean |

Failure 2 ตัวที่เหลือเป็นของเดิมก่อนงานนี้: chat transport contract, verification exports

## 7. Environment ที่ผู้ใช้ต้องตั้งค่า

### Vercel (ทั้ง 3 โปรเจกต์) — PUBLIC
```
VITE_TURNSTILE_SITE_KEY=<site key>
```
ต้อง Redeploy หลังตั้งค่า (Vite ฝังตอน build)

### Render (backend) — SECRET
```
TURNSTILE_SECRET_KEY=<secret key>
TURNSTILE_HOSTNAMES=velnox-shop.vercel.app,velnox-seller.vercel.app,velnox-center.vercel.app
PREAUTH_PROOF_SECRET=<random 32+ chars>   # optional; fallback OAUTH_STATE_SECRET → JWT_SECRET
TURNSTILE_TIMEOUT_MS=5000                 # optional
```

### Cloudflare Dashboard → Turnstile
เพิ่ม hostname ของทั้ง 3 โดเมน (production + preview ถ้าต้องการทดสอบ preview)
Widget mode: **Managed** (visible checkbox)

> ⚠️ ถ้าไม่ตั้ง `TURNSTILE_SECRET_KEY` บน Render: **production login จะถูกปฏิเสธทั้งหมด** (fail-closed ตามข้อกำหนด) — นี่คือพฤติกรรมที่ต้องการ ไม่ใช่บั๊ก

## 8. Production Deployment Status

**ยังไม่เปิดใช้งานจริง** — ผมตรวจสอบค่าจริงบน Vercel/Render ไม่ได้จาก environment นี้
จึงไม่สามารถยืนยันได้ว่าระบบทำงานบน production แล้ว ต้องให้เจ้าของตั้งค่า env ข้างต้นก่อน

## 9. Git

- commit `ac7d701` · push แล้ว · `HEAD = origin/main = ac7d701` · working tree clean

## 10. Remaining Risks

1. **ผู้ใช้ต้องตั้ง env เอง** — ถ้าตั้ง site key แต่ไม่ตั้ง secret → login ล่มทั้งหมด (โดยเจตนา)
2. **Preview deployment** ใช้ hostname ต่างจาก production → ต้องเพิ่มใน `TURNSTILE_HOSTNAMES` หรือจะถูกปฏิเสธ
3. **ยังไม่ทดสอบ UI บนเบราว์เซอร์จริง** (ไม่มี DB/env ในเครื่อง) — ตรวจด้วย typecheck/build/unit/static tests
4. **AI 02 Independent Review ไม่ได้รัน** — subagent ล้มเหลว (`API key has no active plan`) ผมทำ audit เองแทน
5. Google OAuth ยังต้องพึ่ง `GOOGLE_*` env เดิม — ไม่ได้แก้ไขและไม่ควรแก้
