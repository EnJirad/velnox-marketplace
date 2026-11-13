# แผนงาน: ระบบแบนเนอร์การตลาดบนหน้าสินค้า / หน้าร้าน (velcenter → velshop)

**สถานะ:** ร่างแรก (สำหรับขอความเห็นก่อนเขียนโค้ดจริง)
**ช่องทาง:** VelCenter (ตั้งค่า) → Backend (platform_settings) → VelShop (render)

---

## 1. ปัญหาที่แก้

ปัจจุบันแบนเนอร์มีเฉพาะ **หน้าแรก** (`home_hero`, `home_strip`) เท่านั้น ผู้ขายอยากใส่แบนเนอร์ / โฆษณา / ข้อความประชาสัมพันธ์บน **หน้ารายละเอียดสินค้า** และ **หน้าร้าน** ได้เกือบทุกจุด และอยากเห็นภาพก่อน publish (ตัวจำลองหน้าร้านที่แทรกแบนเนอร์ได้จริง)

---

## 2. แนวทางออกแบบ

ใช้โครงสร้างเดิมที่มีอยู่แล้ว (`platform_settings` key `shop_announcements` JSON array, route `GET/PUT /api/admin/announcements`, `lib/banners.ts` ตรวจกติกา) ไม่สร้างตารางใหม่ ไม่เปลี่ยน DB schema

ขยด contract เดิมให้รองรับ:
- **zone** (`home` | `product` | `store`) — บอกว่าตกอยู่บนหน้าไหน
- **placement** (`home_hero` | `home_strip` | `product_above_gallery` | `product_below_image` | `product_below_price` | `product_above_tabs` | `store_above_products` | `store_between_products` | `store_header`) — จุดแทรกเฉพาะ
- **slot** (number) — ลำดับภายใน placement เดียวกัน (สลับตำแหน่งได้)
- **animation** (`none` | `fade` | `slide-up` | `bounce`) — เอฟเฟกต์เมื่อปรากฏ
- **bgColor / textColor** — สีพื้นหลัง / สีตัวอักษร (สำหรับประเภทข้อความ)

แบนเนอร์ประเภทเดิม (`announcement` = ข้อความล้วน, `promotion` = รูป+ปุ่ม, `ad` = รูป) คงไว้ เพิ่มเฉพาะ field ใหม่ด้านบน

กติกาการแสดง (เหมือนเดิม): แสดงต่อเมื่อ `active = true` และอยู่ในช่วงเวลา `startsAt`–`endsAt` (ถ้ามี)

---

## 3. แผนที่จุดแทรก (placement map)

### 3.1 หน้ารายละเอียดสินค้า (ShopProductDetail)

| placement | จุดแทรก | ลักษณะ | ตัวอย่างเนื้อหา |
|---|---|---|---|
| `product_above_gallery` | เหนือรูปสินค้าหลัก | แถบกว้างเต็มความกว้าง | โปรโมชั่นส่งฟรี, สินค้าใหม่มาแรง |
| `product_below_image` | ใต้รูปสินค้าหลัก (เหนือราคา) | แถบกว้าง | ส่วนลดแค่วันนี้, ผ่อน 0% |
| `product_below_price` | ใต้ราคา (เหนือปุ่มซื้อ/ตะกร้า) | แถบกว้าง | ส่งฟรีเมื่อซื้อครบ 500 |
| `product_above_tabs` | 见탭รายละเอียด/รีวิว | แถบกว้าง | บทความเกี่ยวข้อง, รีวิวจากลูกค้า |
| `product_in_tabs` | แท็บใหม่ในแถบรายละเอียด | แท็บเต็มหน้า | คู่มือการใช้, นโยบายคืนสินค้า |

### 3.2 หน้าร้าน (ShopDetail)

| placement | จุดแทรก | ลักษณะ | ตัวอย่างเนื้อหา |
|---|---|---|---|
| `store_header` | หัวหน้าร้าน (ใต้โลโก้/ชื่อร้าน) | แถบกว้าง | โปรโมชั่นร้าน, ส่วนลดต้อนรับ |
| `store_above_products` | 见รายการสินค้า | แถบกว้าง | สินค้าแนะนำของร้าน |
| `store_between_products` | ระหว่างการ์ดสินค้า (ทุก N ใบ) | แทรกสลับกับการ์ด | แบนเนอร์คั่นกลางสินค้า |

---

## 4. การตั้งค่าแบนเนอร์ (ใน panel ตั้งค่า)

| ฟิลด์ | ประเภท | ค่าเริ่มต้น | หมายเหตุ |
|---|---|---|---|
| type | announcement / promotion / ad | promotion | announcement = ข้อความล้วน, promotion = รูป+ปุ่ม, ad = รูป |
| zone | home / product / store | home | ตัดสินใจว่า render บนหน้าไหน |
| placement | ตาม placement map | home_hero | จุดแทรกเฉพาะ |
| title | ข้อความ | (ว่าง) | หัวข้อแบนเนอร์ |
| subtitle | ข้อความย่อย | (ว่าง) | รายละเอียดประกอบ |
| imageUrl | URL หรือ null | null | รูปแบนเนอร์ (อัปโหลด R2) |
| ctaLabel | ข้อความปุ่ม | (ว่าง) | เช่น "ซื้อเลย", "ดูเพิ่มเติม" |
| ctaUrl | URL หรือ null | null | ปุ่มเชื่อมไปที่ไหน |
| animation | none / fade / slide-up / bounce | none | เอฟเฟกต์ปรากฏ |
| bgColor | สี hex | #ffffff | พื้นหลังแบนเนอร์ (announcement) |
| textColor | สี hex | #0f172a | สีตัวอักษร (announcement) |
| active | boolean | true | แสดง/ซ่อน |
| startsAt / endsAt | วันที่ | null | ช่วงเวลาแสดง |
| slot | number | 0 | ลำดับภายใน placement |

---

## 5. สิ่งที่สร้างในรอบนี้ (รอบแรก)

1. **ตัวจำลองหน้าร้าน (mockup HTML)** — หน้าสินค้าจำลอง มีจุดแทรกแบนเนอร์ชัดเจน กด "+" ที่จุดใดจุดหนึ่ง → เปิด panel ตั้งค่า (ชนิด, ข้อความ, สี, แอนิเมชัน) → เห็นแบนเนอร์โผล่ในหน้าจำลองทันที ลากสลับลำดับ ลบได้
2. **ขยด contract** (`lib/banners.ts`, `announcements.ts`) — รองรับ zone / placement / slot / animation / bgColor / textColor สำหรับหน้าสินค้า + หน้าร้าน
3. **UI velcenter** — แยก tab ตั้งค่าแบนเนอร์หน้าสินค้า / หน้าร้าน (reuse `MarketingBanners` รูปแบบเดิม)
4. **render บน velshop** — อ่านแบนเนอร์ตาม zone/placement แล้ว render ที่จุดแทรกใน `ShopProductDetail` / `ShopDetail`

รอบนี้ขอทำ **1–2** (ตัวจำลอง + ขยด contract) ก่อน แล้วค่อยทำ UI velcenter + render จริงในรอบถัดไป เพื่อให้ผู้ขายเห็นภาพและยืนยันจุดแทรกก่อนลงโค้ดหน้าร้านจริง

---

## 6. การทดสอบ

- Unit test `lib/banners.ts`: normalise รับ zone/placement ใหม่ ไม่พังของเดิม, slot เรียงลำดับถูกต้อง, animation ค่าที่ไม่รู้จักตกเป็น none
- ตัวจำลอง: กด "+" ที่ทุกจุดแทรก → แบนเนอร์ปรากฏตรงจุดนั้น, เปลี่ยนสี/ข้อความแล้วเห็นทันที, ลากสลับลำดับได้

---

## 7. หมายเหตุ

- ไม่สร้างตาราง DB ใหม่ ใช้ `platform_settings` เดิม (key `shop_announcements`) เหมือนหน้าแรก
- VelShop อ่านผ่าน `GET /api/announcements` เดิม (กรอง active + in-schedule) แล้วกรอง zone/placement ที่ฝั่ง frontend
- ภาษาที่ใช้กับผู้ใช้: ไทย (ตามข้อบังคับโปรเจกต์)
