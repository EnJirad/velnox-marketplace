# Change Report — Production Neon READ-ONLY audit + AI change-audit trail rules

**สรุปภาษาไทย (อ่านตรงนี้ก่อน)**

การตรวจนี้เป็น **READ-ONLY ทั้งหมด** ไม่มีการเชื่อมต่อ Production Neon, ไม่มี DDL/DML,
ไม่มีการแก้โค้ด, ไม่มีการแก้ `db/schema.sql` หรือ `db/run-sqleditor.sql`

- **ฝั่ง repository (ตรวจได้จริงในเครื่อง) = PASS ทุกข้อ** — ไม่มี VelRepeat ในโค้ดที่รันอยู่,
  ไม่มีการอ้าง `db/run-update.sql` ในไฟล์ที่รันได้, ตาราง Marketplace ที่ต้องมีครบทั้ง 19 ตาราง
  ในไฟล์ SQL ทั้งสอง, และมีไฟล์ `.sql` แค่ 2 ไฟล์
- **ฝั่ง Production Neon = BLOCKED / NOT RUN** — workspace นี้ไม่มี credential
  (`freebuff-env list` คืนค่าว่าง) และกฎ A ห้ามให้ AI เชื่อมต่อ Production DB แทนเจ้าของ
  จึงไม่ได้รันแม้แต่ query เดียว ด้านล่างมี **read-only query ให้เจ้าของรันเอง**
- **WARNING 1** — workflow ตรวจ production ที่มีอยู่ (`.github/workflows/production-db-verify.yml`)
  ไม่ได้ probe ตาราง Marketplace ที่กฎ A กำหนด (ตรวจแค่ `checkout_groups`, columns/FK/index/CHECK
  และ `schema_migrations`) จึงยังตอบ checklist ข้อ A ไม่ครบแม้เจ้าของจะรัน workflow แล้ว
- **WARNING 2** — เหลือคำอธิบาย VelRepeat 2 บรรทัดใน `db/run-sqleditor.sql` (comment เท่านั้น)
  และเอกสารประวัติใน `.ai/` + `docs/VELREPEAT_REMOVAL_PLAN.md` (เจตนาเก็บไว้เป็น audit trail)
- **ข้อผิดพลาดที่พบใน checklist ต้นทาง** — ไม่มีตาราง `customers` ในสถาปัตยกรรมนี้ ผู้ซื้อคือแถวใน
  `users` ที่ `role='customer'`; ต้องตรวจด้วย `users` ไม่ใช่รายงานว่า "ตาราง customers หาย"
  (ไม่ใช่ข้อบกพร่องของ repo)

---

## 1. วันที่และเวลา

- 2026-10-25 14:32 (+07, Asia/Bangkok)
- Repository HEAD ที่ใช้ตรวจ: `964156db6241704d61954a52799485d345c6d013` (2026-10-24 08:04:02 +0000)

## 2. AI / Agent ที่ทำงาน

Buffy — Freebuff coding agent (sandbox workspace, repository-scoped credential)

## 3. Git branch

`main`

## 4. Git commit SHA ก่อนแก้

`964156db6241704d61954a52799485d345c6d013` — ตรงกับ `origin/main` (0 ahead / 0 behind),
working tree clean ก่อนเริ่มงาน

## 5. Git commit SHA หลังแก้

`9d3a6418c27cb385c1b8912328cceb8bebc68613` — `docs(ai): §78 — Production Neon read-only audit + permanent change-report rules`
(7 ไฟล์, +572 / −94, ไฟล์ `.ai/*.md` เท่านั้น)

SHA ของ commit ที่บันทึกค่านี้ (metadata-only, ไม่แตะเนื้อหา):
`git log -1 --format=%H -- .ai/history/2026-10-25-production-neon-audit.md`

## 6. จุดประสงค์ของการแก้

1. ทำ audit แบบ **READ-ONLY** ตามกฎ A (Production Neon) แล้วรายงาน PASS / FAIL / WARNING /
   BLOCKED / NOT RUN พร้อม read-only query ที่ใช้
2. ทำให้กฎ B–G (Mandatory AI Change Audit Trail) เป็น **กฎถาวรของ repo** ไม่ใช่คำสั่งครั้งเดียว
   โดยเพิ่มใน `.ai/AI_RULES.md` และชี้จาก `.ai/README.md`
3. สร้าง Change Report นี้ใน `.ai/history/` และอัปเดต `.ai/AI_HANDOFF.md`

## 7. สิ่งที่ตรวจสอบก่อนแก้

| ก่อนแก้ | ค่าที่วัดได้ |
|---|---|
| `git fetch origin` + `git rev-parse --abbrev-ref HEAD` | `main` |
| `git rev-parse HEAD` / `git rev-parse origin/main` | `964156d…` / `964156d…` (เท่ากัน) |
| `git rev-list --left-right --count origin/main...HEAD` | `0  0` |
| `git status --porcelain` | ว่าง (clean) |
| `freebuff-env list` | ไม่มี key ใด ๆ — **ไม่มี** `NEON_PRODUCTION_DATABASE_URL` |
| `git ls-files '*.sql'` | `db/run-sqleditor.sql`, `db/schema.sql` (2 ไฟล์) |

## 8. ไฟล์/โฟลเดอร์ที่ถูกแก้

เพิ่ม:
- `.ai/history/2026-10-25-production-neon-audit.md` (ไฟล์นี้)
- `.ai/history/archive/AI_Handoff-2026-10-24-section-77-audit.md` (ย้าย §77 ออกมาแบบ verbatim)

แก้:
- `.ai/AI_RULES.md` — เพิ่ม §17 (Production database access) และ §18 (Mandatory change report)
- `.ai/README.md` — ชี้ว่าทุกงานที่แก้ repo ต้องมี Change Report
- `.ai/AI_HANDOFF.md` — header + §77 ย่อเป็น pointer + §78 ใหม่
- `.ai/history/AI_Handoff_Archive.md` — เพิ่ม index row

**ไม่แตะเลย:** `apps/`, `backend/`, `packages/`, `db/schema.sql`, `db/run-sqleditor.sql`,
`db/verify-reconciler.sh`, `.github/`, `package.json`, ไฟล์ `.env*`

## 9. สิ่งที่เพิ่ม

- กฎ §17: Production DB เป็น read-only สำหรับ AI; AI ต้องไม่เชื่อมต่อแทนเจ้าของ
- กฎ §18: บังคับ Change Report 20 ฟิลด์ใน `.ai/history/` + อัปเดต handoff + ห้ามรายงานผลที่ไม่ได้รัน
- Read-only query set สำหรับเจ้าของรันกับ Production Neon (อยู่ใน §11 ของรายงานนี้)
- §78 ใน handoff: สถานะ production ที่ยัง BLOCKED + ช่องว่างของ verify workflow

## 10. สิ่งที่ลบ

ไม่มีไฟล์ที่ถูกลบ ไม่มี SQL object ใดถูกลบ ไม่มีโค้ดถูกลบ
(§77 ถูก **ย้าย** ไป `.ai/history/archive/AI_Handoff-2026-10-24-section-77-audit.md` แบบคัดลอกทั้งบล็อก
ไม่มีการตัดทอนเนื้อหา)

## 11. สิ่งที่เปลี่ยน — ผลตรวจโดยละเอียด

### A. Production Neon — READ-ONLY

Pre-flight ตาม checklist:

| # | ข้อกำหนด | ผล | หลักฐาน |
|---|---|---|---|
| A1 | ยืนยันว่าเป็น Production Neon ตัวจริง | **BLOCKED** | ไม่มี credential ใน workspace; กฎ A ห้าม AI เชื่อมต่อแทนเจ้าของ — ต้องให้เจ้าของยืนยัน (project/branch เดียวกับ `DATABASE_URL` ของ Render) |
| A2 | ตรวจ Git `main` + commit ล่าสุด | **PASS** | `main` = `964156d`, `origin/main` = `964156d`, 0/0, clean |
| A3 | ห้ามแก้โค้ด | **PASS** | `git status` ก่อนงานว่าง; diff ของงานนี้มีแต่ไฟล์ `.ai/*.md` |
| A4 | ห้ามแก้ `db/schema.sql` | **PASS** | ไม่อยู่ใน diff |
| A5 | ห้ามแก้ `db/run-sqleditor.sql` | **PASS** | ไม่อยู่ใน diff |
| A6 | ห้าม DROP / DELETE / TRUNCATE / ALTER / UPDATE / INSERT | **PASS** | ไม่ได้รัน SQL ใด ๆ ทั้งสิ้น (ไม่มี connection) |
| A7 | ห้ามให้ AI เชื่อมต่อ Production DB แทนผู้ใช้ | **PASS** | ไม่มีการเชื่อมต่อ; รายงานเป็น NOT RUN |

ผลตรวจรายข้อ — คอลัมน์ "live" คือ Production Neon, คอลัมน์ "static" คือหลักฐานใน repo:

| # | Check | Live Production | Static repo evidence |
|---|---|---|---|
| 1 | ตาราง Marketplace ครบ | **NOT RUN** | PASS — 63 ตารางในทั้งสองไฟล์; รายตัว: `users`, `sellers`, `products`, `orders`, `carts`, `payments`, `refunds`, `shipments`, `inventory` = 1/1 ทั้ง `db/schema.sql` และ `db/run-sqleditor.sql` |
| 2 | ไม่มี VelRepeat object ที่ระบบใช้ | **NOT RUN** | PASS — `velrepeat\|vrepeat` = **0 ไฟล์** ใน `apps/`, `backend/`, `packages/`; `CREATE TABLE … velrepeat` = 0 ในทั้งสองไฟล์ |
| 3 | ไม่มี reference ไปยัง `velrepeat` | **NOT RUN** | **WARNING** — โค้ดที่รันได้ 0; เหลือ 2 บรรทัด comment (`db/run-sqleditor.sql:3757-3758`) + เอกสารประวัติ 38 ไฟล์ใน `.ai/` + `docs/VELREPEAT_REMOVAL_PLAN.md` |
| 4 | ไม่มี reference ไปยัง `run-update.sql` | **NOT RUN** | PASS — ไฟล์ที่รันได้ (`.ts/.sh/.yml/.json`) = 0; ที่เหลือเป็นข้อความใน `.ai/` ที่บอกว่า "deprecated / absent" |
| 5 | `checkout_requests` มีอยู่ | **NOT RUN** | PASS — declared 1/1 ทั้งสองไฟล์ |
| 6 | `conversations` มีอยู่ | **NOT RUN** | PASS — declared 1/1 ทั้งสองไฟล์ (พร้อม `chat_messages`) |
| 7 | `users` (แทน `customers`) | **NOT RUN** | PASS — declared 1/1; **ไม่มีตาราง `customers` โดยเจตนา** — ผู้ซื้อคือ `users.role = 'customer'` |
| 8 | `sellers` | **NOT RUN** | PASS — 1/1 |
| 9 | `products` (+ `product_variants`, `product_images`, `categories`) | **NOT RUN** | PASS — 1/1 ทุกตาราง |
| 10 | `orders` (+ `order_items`, `checkout_groups`) | **NOT RUN** | PASS — 1/1 ทุกตาราง |
| 11 | `carts` (+ `cart_items`) | **NOT RUN** | PASS — 1/1 |
| 12 | `payments` | **NOT RUN** | PASS — 1/1 |
| 13 | `refunds` | **NOT RUN** | PASS — 1/1 |
| 14 | `shipments` | **NOT RUN** | PASS — 1/1 |
| 15 | `inventory` | **NOT RUN** | PASS — 1/1 |
| 16 | ไม่มี object VelRepeat ในสองไฟล์ SQL | **NOT RUN** | PASS — เหลือเฉพาะ comment อธิบายประวัติ |
| 17 | `.sql` ในรีโป = 2 ไฟล์ | — | PASS — `git ls-files '*.sql'` = 2 |
| 18 | โค้ดอ้างเฉพาะสิ่งที่ schema declare | — | PASS — `bun test backend/tests/sql-reference-coverage.test.ts` → **5 pass / 0 fail** |

**Read-only query set สำหรับเจ้าของรันเองกับ Production Neon** (ไม่มี DDL/DML, ไม่มีการเขียนใด ๆ):

```sql
-- ─── 0) Identity: ยืนยันว่านี่คือ production จริง ───────────────────────────
SELECT current_database()            AS database,
       current_user                  AS db_user,
       split_part(version(), ' ', 2) AS pg_version,
       inet_server_addr()::text      AS server_addr,
       pg_postmaster_start_time()    AS started_at;

-- ─── 1) ตาราง Marketplace ที่ต้องมี (FAIL = ขาด) ───────────────────────────
WITH required(tbl) AS (
  VALUES ('users'), ('auth_identities'), ('sellers'), ('categories'),
         ('products'), ('product_variants'), ('product_images'),
         ('orders'), ('order_items'), ('checkout_groups'),
         ('carts'), ('cart_items'),
         ('payments'), ('refunds'), ('shipments'), ('inventory'),
         ('checkout_requests'), ('conversations'), ('chat_messages')
)
SELECT r.tbl,
       CASE WHEN to_regclass('public.' || r.tbl) IS NULL THEN 'FAIL' ELSE 'PASS' END AS status
FROM required r
ORDER BY status DESC, r.tbl;

-- ─── 2) VelRepeat leftovers: relation ใด ๆ (ตาราง/view/sequence/index) ─────
SELECT c.relkind, c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname ~* '(velrepeat|vrepeat)'
ORDER BY c.relname;

-- ─── 3) VelRepeat leftovers: คอลัมน์ ───────────────────────────────────────
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND column_name ~* '(velrepeat|vrepeat)'
ORDER BY table_name, column_name;

-- ─── 4) VelRepeat leftovers: function / trigger ────────────────────────────
SELECT 'function' AS kind, p.proname AS name
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname ~* '(velrepeat|vrepeat)'
UNION ALL
SELECT 'trigger', t.tgname
FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND NOT t.tgisinternal AND t.tgname ~* '(velrepeat|vrepeat)'
ORDER BY kind, name;

-- ─── 5) VelRepeat leftovers ที่ซ่อนใน function body (อ้างชื่อ object เก่า) ──
SELECT p.proname
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prosrc ~* '(velrepeat|vrepeat)'
ORDER BY p.proname;

-- ─── 6) ledger อ้าง run-update หรือไม่ (ต้องได้ 0 แถว) ─────────────────────
SELECT migration_name, applied_at
FROM schema_migrations
WHERE migration_name ILIKE '%run-update%'
ORDER BY applied_at;

-- ─── 7) ตารางที่ boot ตรวจ เผื่อ column หาย (read-only) ────────────────────
SELECT table_name, count(*) AS columns
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name IN ('checkout_requests', 'conversations')
GROUP BY table_name ORDER BY table_name;

-- ─── 8) ความแม่นยำทางการเงิน: numeric precision ของ payments ──────────────
SELECT column_name, numeric_precision, numeric_scale
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'payments' AND data_type = 'numeric'
ORDER BY column_name;
```

**ห้ามรัน `db/run-sqleditor.sql` ในขั้นตอน audit นี้** (เป็นตัวเขียน) — ถ้าพบ FAIL ให้หยุดและรายงาน

### ช่องว่างที่พบในเครื่องมือตรวจเดิม (WARNING)

`.github/workflows/production-db-verify.yml` เป็น read-only จริง และรันโดยเจ้าของได้ (`workflow_dispatch`)
แต่ probe แค่: `checkout_groups`, `orders/payments.checkout_group_id`, provider idempotency columns,
FK `ON DELETE SET NULL`, group indexes, payments CHECKs, `schema_migrations`

→ **ไม่ได้ตรวจ** ตาราง 19 ตัวตาม checklist A, ไม่ได้ตรวจ velrepeat leftovers, ไม่ได้ตรวจ `run-update`
จึงไม่สามารถใช้เป็นหลักฐานปิด checklist A ได้ทั้งหมด (เป็นข้อเสนอ ไม่ได้แก้ในรอบ audit นี้)

## 12. เหตุผลของการเปลี่ยน

- กฎ B–G เป็นคำสั่งถาวร ("กฎบังคับสำหรับทุก AI Agent") จึงต้องอยู่ใน rulebook ไม่ใช่ในแชท
  มิฉะนั้น AI ตัวถัดไปจะไม่เห็น
- handoff อยู่ที่ 53.5 KB ใกล้เพดาน 55 KB ของเครื่องมือแก้ไฟล์ จึงย้าย §77 (ถูก supersede แล้ว)
  ไป archive ตามกลไกที่ `.ai/history/README.md` กำหนด — ไม่ใช่การลบประวัติ
- audit ไม่แตะ DB เพราะทั้งกฎ A และข้อจำกัดของ workspace (ไม่มี credential) ห้ามไว้

## 13. ระบบ/feature ที่ได้รับผลกระทบ

- ไม่มีระบบ runtime ใดได้รับผลกระทบ — diff เป็น Markdown ใน `.ai/` เท่านั้น
- กระบวนการทำงานของ AI เปลี่ยน: ต้องมี Change Report ทุกครั้งที่แก้ repo (§18)

## 14. ระบบที่ยืนยันว่าไม่ได้รับผลกระทบ

- `apps/velshop`, `apps/velseller`, `apps/velcenter`, `apps/velnox` — ไม่มีไฟล์ใน diff
- `backend/**` (routes, services, jobs, lib, middleware, tests) — ไม่มีไฟล์ใน diff
- `packages/shared/**` — ไม่มีไฟล์ใน diff
- `db/schema.sql`, `db/run-sqleditor.sql`, `db/verify-reconciler.sh` — ไม่มีไฟล์ใน diff
- `.github/workflows/**`, `package.json`, lockfile — ไม่มีไฟล์ใน diff
- Production Neon — **ไม่มีการเชื่อมต่อ** จึงไม่มีการเปลี่ยนแปลงใด ๆ

## 15. Tests / checks ที่รัน

```bash
git fetch origin && git rev-parse HEAD && git rev-parse origin/main
git rev-list --left-right --count origin/main...HEAD
git status --porcelain=v1
freebuff-env list
git ls-files '*.sql'
grep -ril 'velrepeat\|vrepeat' apps backend packages --include='*.ts' --include='*.tsx' \
  --include='*.js' --include='*.jsx' --include='*.json' --include='*.sh'
grep -rin 'velrepeat\|vrepeat' db/*.sql
git grep -n 'run-update' -- . ':!.ai/history' ':!docs'
grep -cE '^CREATE TABLE IF NOT EXISTS' db/schema.sql db/run-sqleditor.sql
bun test backend/tests/sql-reference-coverage.test.ts
```

## 16. ผลลัพธ์ของแต่ละ check

| Check | ผล | Output |
|---|---|---|
| `git fetch` / branch | **PASS** | `main` |
| local vs `origin/main` | **PASS** | `964156d…` = `964156d…`, `0  0` |
| working tree | **PASS** | ว่าง |
| `freebuff-env list` | **BLOCKED (ข้อมูล)** | `{"files":{}, …}` — ไม่มี key ใดเลย |
| `git ls-files '*.sql'` | **PASS** | 2 ไฟล์ |
| velrepeat ใน executable | **PASS** | 0 ไฟล์ |
| velrepeat ใน `db/*.sql` | **WARNING** | 2 บรรทัด comment (`3757-3758`) |
| `run-update` ในไฟล์รันได้ | **PASS** | 0 (ที่เหลือเป็นข้อความใน `.ai/`) |
| ตาราง 63 ตัว/ไฟล์ | **PASS** | `63` / `63`; ตารางที่กฎ A กำหนด declared ครบ |
| `sql-reference-coverage.test.ts` | **PASS** | 5 pass / 0 fail, exit 0 |
| Production Neon live checks | **NOT RUN / BLOCKED** | ไม่ได้เชื่อมต่อ — ไม่มี credential และกฎ A ห้าม |
| `git diff --check` | ดู §17 | รันหลังเขียนไฟล์ |

## 17. ปัญหาที่พบ

1. **ไม่มี credential สำหรับ production** และกฎ A ห้าม AI ต่อ DB แทนเจ้าของ → live audit ทำไม่ได้ในรอบนี้
2. **verify workflow ไม่ครอบคลุม checklist A** (ดู §11) — ต้องเพิ่ม probe หรือใช้ query set ใน §11
3. **`customers` ไม่ใช่ตาราง** — checklist ที่เขียนว่า "users/customers" ต้องตีความเป็น `users`
   ไม่ใช่รายงาน FAIL
4. **handoff ใกล้เพดาน 55 KB** — แก้โดยย้าย §77 ไป archive; ถ้าโตอีกต้องย้าย §69/§75 ตามไปด้วย

## 18. ข้อจำกัด / สิ่งที่ยังไม่ได้ตรวจ

- **ไม่ได้ตรวจ Production Neon เลยแม้แต่ query เดียว** — สถานะจริงของ production เป็น **UNKNOWN**
  จนกว่าเจ้าของจะรัน §11 แล้วแนบผลมา
- ไม่ได้รัน test suite เต็ม (ไม่มี `TEST_DATABASE_URL`; ชุดเต็มเป็น DB-gated) — รันเฉพาะ static test
  ที่เกี่ยวข้อง
- ไม่ได้รัน build/typecheck เพราะ diff ไม่มีไฟล์โค้ด (Markdown เท่านั้น)
- ไม่ได้รัน `db:verify` / reconciler scenarios (ต้องใช้ PostgreSQL)
- ไม่ได้ตรวจว่า Neon production ตรงกับ `db/schema.sql` ทุกคอลัมน์ — query set §11 เป็นการตรวจ
  ระดับ existence/precision ไม่ใช่ diff เต็มรูปแบบ

## 19. งานที่ยังค้าง

1. **เจ้าของ** รัน §11 กับ Production Neon แล้วแนบผล (read-only) — ถ้า FAIL ให้หยุด ไม่แก้ทันที
2. **เจ้าของ** ยืนยัน identity ของ production Neon (project/branch เดียวกับ Render `DATABASE_URL`)
3. ถ้าพบ VelRepeat objects ค้างใน DB จริง → ใช้ `docs/VELREPEAT_REMOVAL_PLAN.md` (ต้อง backup +
   owner approval + maintenance window) **ไม่ใช่ในขั้นตอน audit**
4. เสนอ (ยังไม่ทำ): เพิ่ม probe ใน `production-db-verify.yml` ให้ครอบตาราง 19 ตัว + velrepeat leftovers
5. ค้างจากรอบก่อน: production reconcile/verify, Stripe TEST E2E จริง, `bun run lint` (ยังไม่ตั้งค่า)

## 20. สิ่งที่ AI ตัวถัดไปควรรู้

- **ห้ามเชื่อมต่อ Production Neon แทนเจ้าของ** ไม่ว่าจะมี credential หรือไม่ (§17) — ให้เจ้าของรันเอง
- **ห้ามรัน `db/run-sqleditor.sql` ระหว่าง audit** — เป็นตัวเขียน; audit ต้อง read-only
- กฎ §18 บังคับ: ทุกงานที่แก้ repo ต้องมี Change Report ใน `.ai/history/` + อัปเดต handoff
  ห้ามรายงาน PASS ของสิ่งที่ไม่ได้รัน — ใช้ `NOT RUN` / `BLOCKED` / `UNKNOWN`
- `.ai/AI_HANDOFF.md` อยู่ที่ ~52 KB: ก่อนเพิ่มหัวข้อใหม่ให้ย้ายบล็อกเก่าที่ supersede แล้วไป
  `.ai/history/archive/` และเพิ่ม index row — อย่าลบประวัติ
- VelRepeat ที่เหลือใน repo เป็น **เอกสารประวัติเท่านั้น**; 2 บรรทัดใน `db/run-sqleditor.sql`
  เป็น comment อธิบายว่าทำไม legacy definition ยังอยู่ — อย่าลบถ้าไม่เข้าใจผลต่อ DB จริง
- `customers` ไม่มีในสถาปัตยกรรมนี้ — ผู้ซื้อคือ `users.role = 'customer'`
