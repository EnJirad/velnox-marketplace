# Task Report: Synthetic Cutover Verification & Live Smoke Test Automation

## สรุปงาน
ได้ดำเนินการสร้างเครื่องมือทดสอบอัตโนมัติสำหรับการสลับระบบสู่ Production (Phase 2 & Phase 3 ของ [CLOUDFLARE_CUTOVER_RUNBOOK.md](file:///workspace/quiet-hopper/docs/CLOUDFLARE_CUTOVER_RUNBOOK.md)):

1. **เครื่องมือ Synthetic Cutover Verification (`scripts/verify-cutover.ts`):**
   - พัฒนาสคริปต์ตรวจวัดสถานะระบบจริงผ่านคำสั่ง `bun run cutover:verify`
   - ตรวจสอบความพร้อมของ Edge Resolution, HTTP/2 SSL Handshake, และ HTTP Status ของทุกโดเมน (`velnox.live`, `shop.velnox.live`, `seller.velnox.live`, `center.velnox.live`, `api.velnox.live`)
   - ตรวจสอบ SPA Client-Side Routing Fallback (`_redirects`) เพื่อยืนยันว่า Deep Link คืนค่า HTTP 200 พร้อม HTML เสมอ
   - ตรวจสอบ Backend API Health และ WebSocket Gateway Handshake
   - ออกแบบให้รองรับการทดสอบข้าม Environment (เช่น Staging, Local, หรือ Production Live) ผ่าน Environment Variables: `API_URL`, `SHOP_URL`, `SELLER_URL`, `CENTER_URL`, `LANDING_URL`
2. **การทดสอบรันจริง:**
   - ทดสอบรัน `bun run cutover:verify` สำเร็จเรียบร้อย โดยโดเมนหลัก `https://velnox.live` ตอบกลับ HTTP 200 OK (PASS)
   - โดเมนย่อย (`shop`, `seller`, `center`, `api`) รายงานสถานะ `WARN` (ENOTFOUND) ตามความจริง เนื่องจากรอการชี้ CNAME Record ใน Cloudflare DNS Dashboard
3. **การลงทะเบียนคำสั่งใน Monorepo:**
   - เพิ่ม script `"cutover:verify": "bun scripts/verify-cutover.ts"` ใน `package.json` เพื่อให้ทีมงานและเจ้าของโครงการสามารถกดรันเพื่อ Verify ได้ทันทีเพียงพิมพ์คำสั่งเดียว

## ไฟล์ที่สร้างและเปลี่ยนแปลง
- `scripts/verify-cutover.ts` (สร้างใหม่)
- `package.json` (เพิ่มคำสั่ง `cutover:verify`)
- `.ai/reports/LATEST.md` (อัปเดตรายงานสถานะ)
- `.ai/AI_HANDOFF.md` (อัปเดตสถานะโครงการ)

## ผลการทดสอบ
- **`bun run cutover:verify`:** รันสำเร็จ 0 ข้อผิดพลาดร้ายแรง (0 Critical Failures)
- **Monorepo Typecheck:** ผ่านสะอาด 100%
- **Full Rebuild Tests (`test:rebuild`):** ผ่าน 87/87 tests
- **`git diff --check`:** สะอาดเรียบร้อย ไม่มีข้อผิดพลาด
