# VelCenter Real-time Chat Sync Resolution (2026-11-22)

## ปัญหาที่พบ
ผู้ใช้แจ้งปัญหาว่าเมื่อส่งข้อความจาก mobile view หรือ app มือถือ ข้อความไม่ขึ้นแสดงผลแบบ Real-time บนหน้าจอ VelCenter (`apps/velcenter/src/components/ChatManagement.tsx`) หรือไม่ขึ้นข้อความเลย

## สาเหตุที่ตรวจสอบพบ (Root Causes)
1. **`tabRef.current` Initial State Mismatch**:
   - ใน `ChatManagement.tsx` state `tab` เริ่มต้นเป็น `"support"` แต่ `tabRef` ถูก initialize ด้วย `"customer"`
   - เมื่อมี WebSocket event `chat:message` เข้ามา ตัว handler จะสั่ง `loadList(tabRef.current)` ซึ่งดึงรายการแท็บ `"customer"` แทนแท็บ `"support"` ที่ผู้ใช้กำลังเปิดอยู่ ทำให้ห้องที่เพิ่งได้รับข้อความใหม่ไม่ปรากฏในแท็บปัจจุบัน
2. **Missing In-Memory / Optimistic State Update for Inbox List (`items`)**:
   - `ChatManagement.tsx` ไม่มี reactive state update ให้กับ `items` ใน memory ทันทีที่ event เข้ามา (ต่างจาก `ShopChat.tsx` ที่อัปเดตทันที) ทำให้ข้อความล่าสุด (`lastMessage`), เวลา (`lastMessageAt`), และ `unreadCount` ในแถบด้านซ้ายไม่อัปเดตทันที ต้องรอ API round-trip จาก network request
3. **Socket Connection Reliability**:
   - `ChatManagement.tsx` ไม่ได้เรียก `connectChatSocket(userId)` ใน lifecycle ของตัวเอง ทำให้หากเปิดหน้า chat โดยตรงหรือเกิด reconnection failure จะไม่มีการการันตีว่า socket เปิดอยู่
4. **Conversation Lookup Resilience**:
   - การตรวจสอบ `belongsToConversation` พึ่งพาเพียง `message.conversationId` ซึ่งหาก payload มี `conversationId` อยู่ที่ root `data.conversationId` อาจทำให้ตรวจไม่ตรงกัน ปรับให้รองรับทั้ง `data.conversationId` และ `message.conversationId`
5. **Support Conversation Creation Broadcast**:
   - ใน `backend/routes/chat.ts` เมื่อลูกค้าสร้างหรือเปิด Support Conversation ผ่าน `POST /api/customer/support/conversation` ไม่มีการส่ง `sendToCenter(CHANNELS.CHAT_CONVERSATION, ...)` ทำให้ VelCenter ไม่ทราบว่ามีห้อง Support ใหม่จนกว่าจะรีเฟรชหน้า

## การแก้ไขที่ดำเนินการ
1. **`apps/velcenter/src/components/ChatManagement.tsx`**:
   - ปรับ `tabRef` ให้ initialize จาก `tab` (`useRef<ChatTab>(tab)`)
   - เพิ่ม `connectChatSocket(userId)` เมื่อคอมโพเนนต์เมานต์
   - ปรับปรุง `onChatEvent("chat:message")`:
     - ดึง `conversationId` จาก `data?.conversationId || message?.conversationId`
     - ตรวจสอบ `isActive` อย่างแม่นยำ
     - อัปเดต `items` (inbox list ทางซ้าย) ใน memory ทันที ปรับ `lastMessage`, `lastMessageAt`, `updatedAt`, `unreadCount` และเรียงลำดับห้องใหม่ล่าสุดขึ้นบนสุดทันที
     - อัปเดต `active` state ทันทีหากเป็นห้องที่เปิดอยู่
     - ดึง `loadList` และ `loadCounts` จาก server ควบคู่กัน
2. **`backend/routes/chat.ts`**:
   - เพิ่ม `sendToCenter(CHANNELS.CHAT_CONVERSATION, ...)` เมื่อมีการสร้างห้อง Support ใหม่
