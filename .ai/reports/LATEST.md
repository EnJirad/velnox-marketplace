# LATEST — 2026-11-11 · Turnstile Final Hardening

**Branch:** `main` · **Status:** โค้ด + tests เสร็จ · ⚠️ **Production ยังไม่พร้อม** — ต้องรัน migration + ตั้ง env

## 1. สิ่งที่แก้ไข

### 1.1 ปุ่ม Google Login ไม่ถูก Gate (ยืนยันแล้วว่าเป็นบั๊กจริง)

patch รอบก่อนใช้ `replace(..., count=1)` กับ `disabled={busy}` จึงไปโดน **ช่อง Name** (บรรทัด 592)
แทนที่จะเป็น **ปุ่ม Google** (บรรทัด 543) ผลคือ:

| องค์ประกอบ | ก่อนรอบนี้ | หลังรอบนี้ |
|---|---|---|
| ปุ่ม Google Sign-In | `disabled={busy}` ❌ กดได้ก่อนยืนยัน | `disabled={busy \|\| !turnstileReady}` ✅ |
| ช่อง Name (register) | `disabled={busy \|\| !turnstileReady}` ❌ พิมพ์ชื่อไม่ได้ระหว่างรอ | `disabled={busy}` ✅ |
| ปุ่ม Submit | ✅ gate แล้ว | ✅ คงเดิม |
| Member Login (VelCenter) | ✅ gate แล้ว | ✅ คงเดิม |
| ช่อง Email/Password | `disabled={busy}` ✅ | ✅ คงเดิม |

Handler ยังตรวจซ้ำอีกชั้น (ไม่พึ่ง UI): `handleGoogleSignIn` / `handleEmailPasswordLogin` /
`handleEmailPasswordRegister` / `handleMemberLogin` ทุกตัวมี
`if (!turnstileReady || !turnstile.token) return`

### 1.2 Pre-auth Proof ยังไม่เป็น One-time จริง

**ปัญหา:** proof เป็น HMAC-signed cookie อายุ 3 นาที การลบ cookie หยุด replay ได้เฉพาะ
**เบราว์เซอร์เดิม** แต่ไม่หยุด:
- cookie ที่ถูกดักไปใช้ **พร้อมกัน** (concurrent)
- การใช้กับ **backend instance ที่สอง** ซึ่งไม่เคยเห็น request แรก

→ signed cookie อย่างเดียว = bearer token ที่มี TTL ไม่ใช่ one-time token

## 2. Security Issues ที่พบ

| # | ระดับ | ปัญหา |
|---|---|---|
| 1 | **High** | Google button ไม่ถูก gate (กดได้ก่อนยืนยัน) |
| 2 | **High** | Proof ไม่มี server-side atomic consumption → replay ข้าม instance ได้ |
| 3 | Medium | ช่อง Name ถูก disable ผิด (UX regression จาก patch เดิม) |
| 4 | Info | ไม่มี Redis/Upstash ในระบบ → ต้องเลือก distributed store |

## 3. One-time Proof Implementation

```
POST /api/auth/preauth
   Turnstile verify → createPreAuthProof() → nonce
   → recordNonce(scope, nonce, ttl)   ← ถ้าล้มเหลว = 503 (ไม่ยอมออก proof)
   → Set-Cookie velnox_preauth (httpOnly, /auth, Lax, 3 นาที)

GET /auth/google
   clearCookie (ทุกกรณี)
   → validatePreAuthProof (HMAC + expiry)
   → consumeNonce(...)  ← DELETE … RETURNING (atomic)
        ok          → เริ่ม OAuth (createOAuthState เดิมทั้งหมด)
        replayed    → redirect ?error=preauth_required
        expired     → redirect ?error=preauth_required
        unavailable → redirect ?error=preauth_required
```

**ทำไม Postgres:** ระบบนี้ **ไม่มี Redis / Upstash / Key Value เลย**
(`backend/package.json` ไม่มี redis client และ `middleware/rate-limit.ts` ระบุว่า
"the backend runs on Render with no shared store (no Redis)") → Postgres คือ
distributed store เดียวที่ทุก instance ใช้ร่วมกันอยู่แล้ว

**Atomicity:** `DELETE FROM preauth_nonces WHERE nonce_hash=$1 RETURNING expires_at`
เป็น statement เดียว → มีผู้ชนะได้คนเดียวเสมอ ไม่ว่าจะกี่ instance/concurrency

**ไม่เก็บของลับ:** เก็บเฉพาะ `sha256(scope + ":" + nonce)` — raw nonce อยู่ใน signed cookie เท่านั้น
และโมดูลนี้ **ไม่มี** `console.log` / `console.warn` (มีเทสต์ยืนยัน)

**Schema:** ตารางเดียว `preauth_nonces (nonce_hash TEXT PK, created_at, expires_at)` + index
เพิ่มใน `db/schema.sql` **และ** `db/run-sqleditor.sql` (วางใน table/column/index pass
ตาม contract ของ reconciler)

## 4. Authentication Coverage

| Endpoint | Gate | หมายเหตุ |
|---|---|---|
| `POST /api/auth/password-login` | ✅ | handler + UI |
| `POST /api/auth/password-register` | ✅ | handler + UI |
| `POST /api/auth/member-login` | ✅ | handler + UI (เดิมไม่มีเลย) |
| `POST /api/auth/preauth` | ✅ | verify → record nonce → cookie |
| `GET /auth/google` | ✅ | proof + atomic consume ก่อน OAuth ทุกกรณี |
| `GET /auth/google/callback` | ✅ | OAuth state เดิม (ไม่แตะ) |

**Fail closed ตรวจแล้ว:** missing site key (UI unavailable) · missing secret (prod ปฏิเสธ) ·
wrong hostname · invalid token · expired token · replayed token · concurrent replay ·
Cloudflare timeout · network failure — ทั้งหมดมี unit test

## 5. Test Results (รันจริง)

| คำสั่ง | ผล |
|---|---|
| `bun run typecheck` | **ผ่าน 4/4** |
| `bun run i18n:check` | **OK — 2294 × 3 parity** |
| `bun run build:velshop` | **ผ่าน** |
| `bun run build:velseller` | **ผ่าน** |
| `bun run build:velcenter` | **ผ่าน** |
| `bun test backend/tests` | **1484 pass** / 431 skip / 2 fail (ของเดิม) |
| `git diff --check` | **clean** |

**เทสต์ใหม่รอบนี้:**
- `preauth-nonce.test.ts` 15 เคส — single use, **concurrent 10 พร้อมกัน (ชนะ 1)**, expired,
  production ไม่มี store = fail-closed, production **ไม่แตะ memory**, scope แยกกัน,
  proof/nonce เป็นค่าเดียวกัน, ไม่เก็บ secret
- `auth-turnstile-gate.test.ts` +6 เคส — ปุ่ม Google disabled/enabled, submit gated,
  member gated, **input ไม่ถูก lock**, preauth record ก่อน cookie, google consume ก่อน OAuth
- `oauth-route.test.ts` +2 เคส — proof เดียวกันเริ่ม flow สองครั้งไม่ได้, proof ที่ไม่เคยถูก record ถูกปฏิเสธ

**ข้อจำกัดที่ต้องรายงานตรง ๆ:** การทดสอบข้าม **process/instance จริง** ต้องใช้
`TEST_DATABASE_URL` (ไม่มีในเครื่องนี้) — เทสต์ที่รันได้ตอนนี้พิสูจน์ atomicity ของ logic
ด้วย in-memory fallback + source contract; path Postgres จริงยังไม่ถูก execute ในเครื่องนี้

**Failure 2 ตัวที่เหลือ (ของเดิมก่อนงานนี้):** chat transport contract, verification exports

## 6. Production Environment Requirements (domain จริงจาก repo)

ดึงจาก `packages/shared/src/lib/sites.ts` และ `docs/DEPLOYMENT.md` (ไม่ใช่ placeholder):

### Vercel — 4 โปรเจกต์
| Project | Production domain |
|---|---|
| VelShop | `https://velshop.vercel.app` |
| VelSeller | `https://velseller.vercel.app` |
| VelCenter | `https://velcenter.vercel.app` |
| Velnox (corporate) | `https://velnox.vercel.app` |

### Render backend
`https://velnox-api.onrender.com`
(หมายเหตุ: ใน `.ai/history/archive/` มีชื่อเก่าที่พิมพ์ผิด `velnx-api.onrender.com` ซึ่งบันทึกว่า
ตอบ 404 ทุก request — **ห้ามใช้**)

### Environment ที่ต้องตั้ง
**Vercel (3 โปรเจกต์ที่มี auth):**
```
VITE_TURNSTILE_SITE_KEY=<site key>      # public, ต้อง Redeploy
```

**Render:**
```
TURNSTILE_SECRET_KEY=<secret key>                                  # บังคับ
TURNSTILE_HOSTNAMES=velshop.vercel.app,velseller.vercel.app,velcenter.vercel.app
PREAUTH_PROOF_SECRET=<random 32+ chars>                            # optional
```

**Cloudflare Turnstile → Allowed hostnames:**
```
velshop.vercel.app
velseller.vercel.app
velcenter.vercel.app
```

### Migration ที่ต้องรันก่อนเปิดใช้ (สำคัญ)
ตาราง `preauth_nonces` ยังไม่มีใน production Neon → **Google login จะ fail closed (503)**
จนกว่าจะรัน `db/run-sqleditor.sql` (หรือ workflow **Production DB Reconcile**)

### Preview domains
Vercel preview URL เป็นแบบ dynamic (`<project>-<branch>-<team>.vercel.app`) —
**ระบุตายตัวไม่ได้จาก repo** ต้องเพิ่ม hostname ของ branch ที่ต้องการทดสอบใน
`TURNSTILE_HOSTNAMES` และใน Cloudflare Dashboard มิฉะนั้น preview จะถูกปฏิเสธ

## 7. Remaining Risks

1. **ยังไม่ได้ตรวจ environment จริงบน Vercel/Render/Cloudflare** — ไม่มีสิทธิ์เข้าถึงจากเครื่องนี้
   จึง **ไม่สามารถยืนยันได้ว่า production เปิดใช้งานแล้ว**
2. **ต้องรัน migration** `preauth_nonces` ก่อน ไม่งั้น Google login ล่ม (fail-closed โดยเจตนา)
3. **ทดสอบข้าม instance จริงไม่ได้** (ไม่มี `TEST_DATABASE_URL`) — พิสูจน์ด้วย logic + contract test
4. **AI 02 Independent Review ไม่ได้รัน** (subagent: API key no active plan)
5. **ยังไม่ทดสอบ UI บนเบราว์เซอร์จริง** — ไม่มี DB/env; ตรวจด้วย typecheck/build/unit/static
6. Preview deployments จะถูกปฏิเสธจนกว่าจะเพิ่ม hostname

## 8–9. Git

- commit `00d67e7` · push แล้ว · `HEAD = origin/main = 00d67e7` · working tree clean
