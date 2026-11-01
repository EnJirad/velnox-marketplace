# VelShop becomes app-style: footer removed, profile will carry เกี่ยวกับ/เงื่อนไข/ติดต่อ

**Starting SHA:** `b32dae7` · **Final:** this commit.

## What the owner asked for (with Thaimart screenshots)

VelShop must feel like an **application**, not a marketing website: no footer at all, and the
legal/contact/"about me" links belong inside the **profile** screen as stacked card sections
(personal data, addresses, payment info; terms & privacy; contact; logout button at the bottom).

## Done in this step

- `apps/velshop/src/components/ShopFooter.tsx` now renders `null` (single central change; the export is
  kept so the ~20 pages that import it need no edit and the change is trivially revertible). No page has a
  footer any more.

Verified: `apps/velshop` typecheck pass · `bun --filter '@velnox/velshop' build` success · `git diff --check`
clean.

## Not done yet (next steps, in order)

1. **Profile restructure** (`apps/velshop/src/pages/ShopProfile.tsx`, 414 lines) into the Thaimart pattern:
   - order-status card (ที่ต้องชำระ / ที่ต้องจัดส่ง / ที่ต้องได้รับ / สำเร็จ) — the same statuses already exist
     in `MyOrders`;
   - optional promo card (use an existing campaign, never invent one);
   - **เกี่ยวกับฉัน**: ข้อมูลส่วนตัว · ที่อยู่ของฉัน · ข้อมูลบัญชีธนาคาร (only if the backend exposes it);
   - **นโยบายและเงื่อนไข**: ข้อกำหนดการใช้บริการ · นโยบายความเป็นส่วนตัว (routes already exist:
     `/terms`, `/privacy`, `CookiePolicy`);
   - **ติดต่อเรา**: LINE/อีเมล/เบอร์ (real values only — ask the owner for the official support channels);
   - **ออกจากระบบ** as a full-width red button at the bottom.
2. Remove now-dead imports of `ShopFooter` lazily (optional; safe to leave).
3. Bottom app navigation (ถ้าต้องการแบบแอปจริง) — separate task.

## Not verified

Browser screenshots of the new profile (not built yet); footer removal was verified by build/typecheck only,
not visually.
