# CHAT — redesign 2026-11-09 (shared thread renderer)

## บัญหาเดิม (วิเคราะห์จากโค้ดจริง)

- แชทถูก render ใน 3 ที่แยกกัน: `ShopChat.tsx` (900 บรรทัด) · `SellerChat.tsx` (873) · `ChatManagement.tsx` (1106)
  → bubble/day separator/ticks/system note/รูป ถูก implement ซ้ำ 3 ชุด และ drift ได้ (เช่น VelCenter เดิมลืมรูปใน bubble ปกติ)
- หน้าตาไม่ใช่ messenger: bubble มี shadow, วันคั่นเป็นข้อความลอย, ข้อความติดกันไม่ถูกจัดกลุ่ม, เวลาซ้ำทุกบรรทัด
- system message ของแพลตฟอร์มใช้กรอบ dashed → แย่งความสนใจจากบทสนทนาจริง

## หลักการออกแบบ

1. **หนึ่ง renderer** — `packages/shared/src/components/chat/chat-conversation.tsx`
   หน้าแต่ละแอปเหลือหน้าที่แค่ "ส่งข้อมูล" (messages, meId, labels, empty state)
2. **เงียบโดยปริยาย** — bubble ของฉัน = emerald-600 ทึบ / ของเขา = ขาวขอบบาง, ไม่มีเงาบนข้อความ
3. **การจัดกลุ่มมองเห็นได้** — ข้อความของผู้ส่งเดียวกันภายใน 5 นาที (`GROUP_WINDOW_MS`) ชิดกัน และเฉพาะอันสุดท้ายของกลุ่มมีหาง
4. **เวลาใน bubble** ครั้งเดียวต่อกลุ่ม + tick ✓/✓✓ (อ่านแล้ว/ส่งแล้ว) และ tick เกิดเฉพาะ `mine`
5. **system note ไม่ใช่ bubble** — บรรทัดกลางจาง + ไอคอน ไม่มี tick
6. **กฎความเป็นเจ้าของไม่เขียนซ้ำ** — ใช้ `lib/chat-message.ts` (`isOwnMessage` / `isSystemMessage`) ที่กันเคส `senderId = NULL`
7. **กฎวัน/กลุ่มมาจาก `lib/chat-timeline.ts`** (pure) — มี unit test ได้

## สถานะที่ทำเสร็จ (commit: feat(chat))

- สร้าง `chat-conversation.tsx`: `ChatConversation`, `ChatBubble`, `ChatDaySeparator`, `ChatSystemNote`
- เปลี่ยนทั้ง 3 แอปให้ใช้ renderer เดียวกัน (ลบ markup ซ้ำ ~90 บรรทัดต่อแอป)
- อัปเดต source-contract tests ให้ตรวจ "ที่เดียว" แทนการตรวจ markup ในแต่ละหน้า (แข็งแรงกว่าเดิม)

## ขั้นต่อไป (ยังไม่ทำ)

- คอมโพเซอร์: ข้อความหลายบรรทัด autosize, Enter ส่ง/Shift+Enter ขึ้นบรรทัด (เดสก์ท็อป)
- Scroll: ย้าย logic "เกาะล่าง + รักษาตำแหน่งตอนโหลดเก่า + ป้ายข้อความใหม่" เข้า shared (ตอนนี้อยู่ที่หน้า)
- ค้นหาในบทสนทนา (jump to message), แนบไฟล์มากกว่า 1 รูป, ตอบกลับ (quote), emoji react
- VelCenter: รวมคิวห้อง (ซัพพอร์ต/ร้านค้า/ภายใน) เป็นสวิตช์เดียว ไม่ใช่แท็บซ้อน
