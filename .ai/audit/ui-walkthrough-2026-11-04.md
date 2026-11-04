# UI walkthrough — VelShop · VelSeller · VelCenter

**Date:** 2026-11-04 · **Branch:** `main`
**Method:** local authenticated preview (`dev-session-proxy.mjs`) + cookie store.
No credential was pasted; no database was written; no order/product/shop mutation
was performed (read-only clicking). Screens: in-app WebView, 1 viewport only
(resize unavailable → responsive NOT measured).

Accounts used: `customer` (VelShop) and `seller` (VelSeller/VelCenter) from
`.ai/secrets/browser-cookies.json`. Cookies are live production sessions and
expire 2026-11-08.

---

## 1. VelShop — customer (velshop)

| Page | Works | Notes |
|---|---|---|
| `/` home | ✅ | announcement carousel (4 slides, dots work), popular categories, "สินค้ากำลังมาแรง" card with price/discount/rating/sold count |
| Cookie banner | ✅ | "ยอมรับทั้งหมด" persists (banner gone after accept) |
| `/products` | ✅ | search field, filter button, sort combobox (ใหม่ล่าสุด), "พบ 1 สินค้า" |
| `/products/:id` | ✅ | 9-image gallery, price ฿419.3 / list ฿599 / −30%, stock 18, rating 5.0 (1), tabs แนะนำ/รายละเอียด/รีวิว, shop card, "แชทกับร้านค้า" |
| Add to cart | ✅ | "ตะกร้า" opens a **variant sheet** (สีดำ 18 / สีขาว 8 / Ai Version / Not Ai Version, qty stepper, live total), "ใส่ตะกร้า · ฿419.3" → header badge = 1 |
| `/cart` (empty) | ✅ | correct empty state + "ไปเลือกสินค้า" |
| `/chat` | ✅ | conversation list, tabs ทั้งหมด/ยังไม่อ่าน/ซัพพอร์ต, unread count 3, preview text |
| 404 | ✅ | friendly Thai 404 with back link |

Observations

- Cart add is load-bearing on variant selection; the product page's cart button
  is a *sheet opener*, not a silent add. That is good, but the button label
  "ตะกร้า" does not say "เลือกตัวเลือก" — first-time users may expect a direct add.
- Bottom nav = หน้าแรก / ตลาด / ออเดอร์ / การแจ้งเตือน / โปรไฟล์; cart sits in the
  header with a count badge — consistent.
- Not exercised: checkout, payment (would create a real order), wishlist toggle,
  notifications list, profile edit.

## 2. VelSeller — seller (velseller)

| Page | Works | Notes |
|---|---|---|
| `/seller/shop` | ✅ after fixes | real shop `SUPER GADGET ZENE`, cover band, description, address, `velshop/shop/super-gadget-zene`, verified state, 2 products, 5 filter chips with counts |
| `/seller/orders` | ✅ | 7 status filters (รอตรวจสอบ → ยกเลิก), paginated cards: order no, date, customer, payment state, shipping state, total |
| `/seller/orders/:id` | ✅ | status block with allowed transitions (ยืนยันแล้ว / ยกเลิก), customer + phone, item list, shipping address, tracking empty state, payment method (พร้อมเพย์) + paid state |
| `/seller/income` | ✅ | gross ฿419.3 (1 unit), returns ฿100 = 23.8% with "เกิน 10%" warning, 3% fee −฿12.58, net ฿348.65, per-order list |
| bottom nav | ✅ | เป้าหมาย / ร้านของฉัน / ออเดอร์ / รายได้ / โปรไฟล์ |
| notification bell | ✅ | badge 4 |

Defects found and fixed the same day (`d2695b5`), verified re-rendered:

1. `NaN%` on the fee card — `GET /api/seller/profile` omitted `commissionRate`.
2. Shop shown as **ปิดร้าน (closed)** — payload omitted `status`, badge defaulted.
3. Raw i18n key `sellerDash.shop.togglePublish` — missing in th/en.

Not exercised: publishing/unpublishing a product, deleting, editing the shop,
uploading logo/cover (all mutating; left for a session with disposable data).

## 3. VelCenter — staff (velcenter)

**BLOCKED (account), PASS (gate).** With the seller account the app renders the
intended company-only screen:

> "velcenter เป็นพื้นที่เฉพาะบริษัท — เฉพาะผู้ที่เจ้าของบริษัทกำหนดสิทธิ์ให้เท่านั้น…"

plus "← กลับไปหน้าร้าน". That is the correct behaviour of `RequireRole
role="center"` — no staff UI is exposed to a seller. Every operational screen
(dashboard, orders, sellers, verifications, categories, banners, chat, employees,
audit) therefore remains **NOT VERIFIED**: it needs an owner/admin/staff account,
which does not exist in the local cookie store.

## 4. Architectural finding (not fixed — needs a decision)

Two seller-application UIs exist and both POST `/api/seller/apply`:

- `packages/shared/src/components/RequireRole.tsx` — **4 steps** (store →
  applicant → identity → review), collects `id_card` / `id_card_back` /
  `selfie_id`, sends object keys. This is the complete, pre-existing flow, and it
  is what a non-seller sees on any `/seller/*` route (observed with the customer
  cookie).
- `apps/velseller/src/components/shop/ShopOnboarding.tsx` — **2 steps**, added in
  Part 1.1 for the "profile exists, shop does not" edge case.

Recommendation: keep `RequireRole` as the single application flow and let
MyShop delegate to it (or delete `ShopOnboarding`), because the duplicate is
exactly the kind of second system the rulebook forbids. No change was made in
this pass — it alters MyShop's entry behaviour and needs approval.

## 5. Browser harness notes

- The in-app WebView repeatedly reported the **previous** URL after
  `browser_navigate` until a cache-busting query (`?t=1`) forced a new document.
  Readings taken immediately after a navigation are unreliable; always
  `browser_wait_for` a known string before trusting the DOM.
- No screenshot capability on this surface (viewport hidden), so evidence is DOM
  text, not pixels.
- One viewport only → 360/390/768/1024/1440 still unmeasured.

## 6. Summary

| App | Status |
|---|---|
| VelShop (customer) | Walkthrough PASS for home, catalog, product, cart-add, cart empty, chat, 404 |
| VelSeller | Walkthrough PASS after three defects fixed; orders, order detail, income, shop all live |
| VelCenter | BLOCKED by account — gate verified, operational UI NOT VERIFIED |
| Responsive | NOT VERIFIED (no resize) |
| Impeccable | Still BLOCKED (engine is ET_EXEC arm64; see `.ai/reports/LATEST.md` §2) |
